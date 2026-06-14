const { prisma } = require('../config/db');
const { notify } = require('./notifications');
const { mapClassDetail } = require('./integrationRead');
const { isClassEnded } = require('./automation');

async function loadClassForTeacher(crmClassId, crmTeacherId) {
    if (!crmTeacherId) {
        return { success: false, error: 'crmTeacherId is required', status: 400 };
    }

    const cls = await prisma.class.findUnique({
        where: { id: crmClassId },
        include: {
            teacher: { select: { id: true, name: true, lastName: true, role: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    if (!cls) {
        return { success: false, error: 'Class not found', status: 404 };
    }
    if (cls.teacherId !== crmTeacherId) {
        return { success: false, error: 'Teacher is not assigned to this class', status: 403 };
    }
    if (cls.isPractice) {
        return { success: false, error: 'Practice classes are not available via integration', status: 400 };
    }

    return { success: true, cls };
}

function appendMaterials(homeworkDraft, materials) {
    if (!Array.isArray(materials) || materials.length === 0) {
        return homeworkDraft ?? null;
    }

    const block = materials
        .map((item) => `- ${item.title || item.type || 'file'}: ${item.url || ''}`.trim())
        .join('\n');

    if (!homeworkDraft) {
        return `Материалы:\n${block}`;
    }
    return `${homeworkDraft}\n\nМатериалы:\n${block}`;
}

async function teacherStart(crmClassId, { crmTeacherId }) {
    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (cls.status === 'started') {
        return {
            success: true,
            data: {
                crmClassId,
                status: cls.status,
                class: mapClassDetail(cls),
                idempotent: true,
            },
        };
    }

    if (cls.status !== 'scheduled') {
        return { success: false, error: 'Class cannot be started in current status', status: 400 };
    }

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: { status: 'started' },
        include: {
            teacher: { select: { id: true, name: true, lastName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            startedAt: new Date().toISOString(),
            class: mapClassDetail(updated),
        },
    };
}

async function teacherFinish(crmClassId, { crmTeacherId, comment }) {
    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (!['started', 'scheduled'].includes(cls.status)) {
        return { success: false, error: 'Class is already closed or awaiting review', status: 400 };
    }

    const updateData = {};
    if (comment) {
        updateData.teacherComment = cls.teacherComment
            ? `${cls.teacherComment}\n${comment}`
            : comment;
    }

    if (cls.status === 'scheduled') {
        updateData.status = 'started';
    }

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: updateData,
        include: {
            teacher: { select: { id: true, name: true, lastName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            finishedAt: new Date().toISOString(),
            class: mapClassDetail(updated),
        },
    };
}

async function teacherSubmit(crmClassId, payload) {
    const {
        crmTeacherId,
        topic,
        homeworkDraft,
        materials,
        teacherOutcomeHint,
        comment,
    } = payload;

    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (['completed', 'cancelled'].includes(cls.status)) {
        return { success: false, error: 'Class is already closed', status: 400 };
    }

    if (cls.status === 'pending_admin_review') {
        return {
            success: true,
            data: {
                crmClassId,
                status: cls.status,
                class: mapClassDetail(cls),
                idempotent: true,
            },
        };
    }

    const mergedHomework = appendMaterials(
        homeworkDraft ?? cls.homeworkDraft,
        materials,
    );

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: {
            topic: topic ?? cls.topic,
            homeworkDraft: mergedHomework,
            teacherComment: comment ?? cls.teacherComment,
            teacherOutcomeHint: teacherOutcomeHint ?? cls.teacherOutcomeHint ?? 'held',
            submittedAt: new Date(),
            submittedById: crmTeacherId,
            status: 'pending_admin_review',
        },
        include: {
            teacher: { select: { id: true, name: true, lastName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    notify('lesson.pending_review', { classRecord: updated }).catch(() => {});

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            submittedAt: updated.submittedAt,
            class: mapClassDetail(updated),
        },
    };
}

async function teacherMarkNotHeld(crmClassId, { crmTeacherId, comment }) {
    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (['completed', 'cancelled'].includes(cls.status)) {
        return { success: false, error: 'Class is already closed', status: 400 };
    }

    if (cls.status === 'pending_admin_review' && cls.teacherOutcomeHint === 'not_held') {
        return {
            success: true,
            data: {
                crmClassId,
                status: cls.status,
                class: mapClassDetail(cls),
                idempotent: true,
            },
        };
    }

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: {
            teacherOutcomeHint: 'not_held',
            teacherComment: comment ?? cls.teacherComment,
            status: 'pending_admin_review',
            submittedAt: new Date(),
            submittedById: crmTeacherId,
        },
        include: {
            teacher: { select: { id: true, name: true, lastName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    notify('lesson.pending_review', { classRecord: updated }).catch(() => {});

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            teacherOutcomeHint: updated.teacherOutcomeHint,
            class: mapClassDetail(updated),
        },
    };
}

async function teacherSetAttendance(crmClassId, { crmTeacherId, studentId, attended }) {
    if (!studentId) {
        return { success: false, error: 'studentId is required', status: 400 };
    }

    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (['completed', 'cancelled'].includes(cls.status)) {
        return { success: false, error: 'Class is already closed', status: 400 };
    }

    const existing = await prisma.classAttendee.findFirst({
        where: { classId: crmClassId, studentId },
    });

    let attendee = null;

    if (!attended) {
        if (existing) {
            await prisma.classAttendee.delete({ where: { id: existing.id } });
        }
    } else if (existing) {
        attendee = await prisma.classAttendee.update({
            where: { id: existing.id },
            data: { attended: true, markedAt: new Date() },
        });
    } else {
        attendee = await prisma.classAttendee.create({
            data: {
                classId: crmClassId,
                studentId,
                attended: true,
                autoDeducted: false,
                markedAt: new Date(),
            },
        });
    }

    const updateData = {};
    if (cls.noOneAttended) {
        updateData.noOneAttended = false;
    }

    if (isClassEnded(cls) && !cls.isPractice) {
        if (['scheduled', 'started', 'not_filled'].includes(cls.status)) {
            updateData.status = 'pending_admin_review';
        }
    }

    const updated = Object.keys(updateData).length
        ? await prisma.class.update({
              where: { id: crmClassId },
              data: updateData,
              include: {
                  teacher: { select: { id: true, name: true, lastName: true } },
                  group: { select: { id: true, name: true } },
                  room: { select: { id: true, name: true } },
              },
          })
        : cls;

    return {
        success: true,
        data: {
            crmClassId,
            studentId,
            attended: Boolean(attended),
            attendeeId: attendee?.id ?? null,
            status: updated.status,
            class: mapClassDetail(updated),
        },
    };
}

module.exports = {
    teacherStart,
    teacherFinish,
    teacherSubmit,
    teacherMarkNotHeld,
    teacherSetAttendance,
};
