const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('../config/db');
const { normalizePhoneDigits, phonesMatch } = require('../utils/phone');

const LINK_STATUSES = ['linked', 'pending', 'conflict', 'manual_review', 'unlinked'];

function learningPlatformBaseUrl() {
    return (process.env.LEARNING_PLATFORM_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

function integrationHeaders() {
    return {
        Authorization: `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`,
        'X-Integration-System': 'crm',
        'Content-Type': 'application/json',
    };
}

async function findCrmStudentByPhone(phone) {
    const digits = normalizePhoneDigits(phone);
    if (!digits) return null;

    const exact = await prisma.student.findFirst({
        where: {
            OR: [
                { phone },
                { phoneDigits: digits },
                { phoneDigits: { endsWith: digits.slice(-10) } },
            ],
        },
    });
    return exact;
}

async function pushLinkToLearningPlatform(payload) {
    const url = `${learningPlatformBaseUrl()}/api/integration/v1/users/link`;
    const response = await axios.post(url, payload, {
        headers: integrationHeaders(),
        timeout: 15000,
    });
    return response.data;
}

async function pushProvisionTeacherToLearningPlatform(payload) {
    const url = `${learningPlatformBaseUrl()}/api/integration/v1/users/provision-teacher`;
    const response = await axios.post(url, payload, {
        headers: integrationHeaders(),
        timeout: 15000,
    });
    return response.data;
}

async function pushProvisionStudentToLearningPlatform(payload) {
    const url = `${learningPlatformBaseUrl()}/api/integration/v1/users/provision-student`;
    const response = await axios.post(url, payload, {
        headers: integrationHeaders(),
        timeout: 15000,
    });
    return response.data;
}

async function getLinkStatus(phone) {
    const digits = normalizePhoneDigits(phone);
    if (digits.length < 10) {
        return { success: false, error: 'Invalid phone number' };
    }

    const crmStudent = await findCrmStudentByPhone(phone);
    let appStatus = null;

    try {
        const response = await axios.get(
            `${learningPlatformBaseUrl()}/api/integration/v1/users/link-status/${encodeURIComponent(digits)}`,
            { headers: integrationHeaders(), timeout: 10000 },
        );
        appStatus = response.data;
    } catch (err) {
        appStatus = {
            success: false,
            error: err.response?.data?.error || err.message,
        };
    }

    const crmLinked = Boolean(crmStudent?.appUserId);
    const appLinked = Boolean(appStatus?.data?.appUserId);
    let status = 'unlinked';

    if (crmStudent?.externalLinkStatus === 'conflict' || appStatus?.data?.status === 'conflict') {
        status = 'conflict';
    } else if (crmLinked && appLinked && crmStudent.appUserId === appStatus?.data?.appUserId) {
        status = 'linked';
    } else if (crmLinked || appLinked) {
        status = 'manual_review';
    } else if (crmStudent && appStatus?.data?.appUser) {
        status = 'pending';
    }

    return {
        success: true,
        data: {
            phone,
            phoneNormalized: digits,
            status,
            crm: crmStudent
                ? {
                      crmStudentId: crmStudent.id,
                      name: `${crmStudent.name} ${crmStudent.lastName}`.trim(),
                      role: crmStudent.role,
                      appUserId: crmStudent.appUserId,
                      externalLinkStatus: crmStudent.externalLinkStatus,
                      linkedAt: crmStudent.linkedAt,
                  }
                : null,
            app: appStatus?.data || null,
        },
    };
}

async function linkUsers({ phone, crmStudentId, appUserId, initiatedBy = 'crm' }) {
    const digits = normalizePhoneDigits(phone);
    if (digits.length < 10) {
        return { success: false, error: 'Invalid phone number' };
    }

    let crmStudent = null;
    if (crmStudentId) {
        crmStudent = await prisma.student.findUnique({ where: { id: crmStudentId } });
    } else if (phone) {
        crmStudent = await findCrmStudentByPhone(phone);
    }

    if (!crmStudent) {
        return { success: false, error: 'CRM user not found for this phone' };
    }

    if (!phonesMatch(crmStudent.phone, phone) && !crmStudentId) {
        return { success: false, error: 'Phone does not match CRM record' };
    }

    if (crmStudent.appUserId && appUserId && crmStudent.appUserId !== appUserId) {
        await prisma.student.update({
            where: { id: crmStudent.id },
            data: { externalLinkStatus: 'conflict' },
        });
        return { success: false, error: 'CRM user already linked to a different App account', status: 'conflict' };
    }

    const lpPayload = {
        phone: crmStudent.phone,
        phoneNormalized: digits,
        crmStudentId: crmStudent.role === 'student' ? crmStudent.id : undefined,
        crmTeacherId: crmStudent.role === 'teacher' ? crmStudent.id : undefined,
        appUserId,
        initiatedBy,
        crmRole: crmStudent.role,
    };

    let lpResult;
    try {
        lpResult = await pushLinkToLearningPlatform(lpPayload);
    } catch (err) {
        const message = err.response?.data?.error || err.message;
        return { success: false, error: `Learning Platform link failed: ${message}` };
    }

    if (!lpResult?.success) {
        return { success: false, error: lpResult?.error || 'Learning Platform rejected link' };
    }

    const resolvedAppUserId = lpResult.data?.appUserId || appUserId;
    const now = new Date();

    const updated = await prisma.student.update({
        where: { id: crmStudent.id },
        data: {
            appUserId: resolvedAppUserId,
            externalLinkStatus: 'linked',
            linkedAt: now,
        },
        select: {
            id: true,
            name: true,
            lastName: true,
            phone: true,
            role: true,
            appUserId: true,
            externalLinkStatus: true,
            linkedAt: true,
        },
    });

    return {
        success: true,
        data: {
            status: 'linked',
            crmStudentId: updated.id,
            appUserId: updated.appUserId,
            crm: updated,
            app: lpResult.data,
        },
    };
}

async function syncFromApp({ appUserId, phone, firstName, lastName, email }) {
    if (!appUserId) {
        return { success: false, error: 'appUserId is required' };
    }

    const digits = normalizePhoneDigits(phone);
    if (digits.length < 10) {
        return { success: false, error: 'Invalid phone number' };
    }
    if (!firstName || !lastName) {
        return { success: false, error: 'firstName and lastName are required' };
    }

    const existingByApp = await prisma.student.findUnique({ where: { appUserId } });
    if (existingByApp) {
        return {
            success: true,
            data: {
                status: 'linked',
                crmStudentId: existingByApp.id,
                appUserId,
                created: false,
                crm: {
                    id: existingByApp.id,
                    name: existingByApp.name,
                    lastName: existingByApp.lastName,
                    phone: existingByApp.phone,
                },
            },
        };
    }

    let crmStudent = await findCrmStudentByPhone(digits);
    let created = false;

    if (!crmStudent) {
        const hashedPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
        crmStudent = await prisma.student.create({
            data: {
                name: firstName.trim(),
                lastName: lastName.trim(),
                phone: digits,
                phoneDigits: digits,
                email: email || null,
                password: hashedPassword,
                role: 'student',
                notes: 'Автоматически создан из Learning Platform',
                appUserId,
                externalLinkStatus: 'linked',
                linkedAt: new Date(),
            },
        });
        created = true;
    } else {
        if (crmStudent.appUserId && crmStudent.appUserId !== appUserId) {
            await prisma.student.update({
                where: { id: crmStudent.id },
                data: { externalLinkStatus: 'conflict' },
            });
            return {
                success: false,
                error: 'Phone already linked to another App account',
                status: 'conflict',
            };
        }

        crmStudent = await prisma.student.update({
            where: { id: crmStudent.id },
            data: {
                appUserId,
                externalLinkStatus: 'linked',
                linkedAt: new Date(),
                email: crmStudent.email || email || null,
            },
        });
    }

    try {
        await pushLinkToLearningPlatform({
            phone: digits,
            phoneNormalized: digits,
            crmStudentId: crmStudent.id,
            appUserId,
            initiatedBy: 'learning-platform',
            crmRole: 'student',
        });
    } catch (err) {
        console.error('[integration] LP link after sync failed:', err.response?.data?.error || err.message);
    }

    return {
        success: true,
        data: {
            status: 'linked',
            crmStudentId: crmStudent.id,
            appUserId,
            created,
            crm: {
                id: crmStudent.id,
                name: crmStudent.name,
                lastName: crmStudent.lastName,
                phone: crmStudent.phone,
                appUserId: crmStudent.appUserId,
                externalLinkStatus: crmStudent.externalLinkStatus,
            },
        },
    };
}

async function createSsoToken(crmStudentId) {
    const secret = process.env.INTEGRATION_SSO_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        return { success: false, error: 'SSO secret is not configured' };
    }

    const student = await prisma.student.findUnique({ where: { id: crmStudentId } });
    if (!student) {
        return { success: false, error: 'CRM user not found' };
    }
    if (!student.appUserId || student.externalLinkStatus !== 'linked') {
        return { success: false, error: 'User is not linked to Learning Platform' };
    }

    const expiresInSec = 300;
    const token = jwt.sign(
        {
            purpose: 'sso-bridge',
            crmStudentId: student.id,
            appUserId: student.appUserId,
            role: student.role,
        },
        secret,
        { expiresIn: expiresInSec },
    );

    const appBase = (process.env.LEARNING_PLATFORM_URL || 'https://maestro-school.duckdns.org').replace(/\/$/, '');
    const nextPath = student.role === 'teacher' ? '/admin/offline-lessons' : '/school-lessons';

    return {
        success: true,
        data: {
            token,
            expiresIn: expiresInSec,
            expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
            redirectUrl: `${appBase}/login`,
            next: nextPath,
            role: student.role,
            crmStudentId: student.id,
            appUserId: student.appUserId,
        },
    };
}

async function provisionCrmTeacher(crmTeacherId, options = {}) {
    const teacher = await prisma.student.findUnique({ where: { id: crmTeacherId } });
    if (!teacher) {
        return { success: false, error: 'CRM user not found' };
    }
    if (teacher.role !== 'teacher') {
        return { success: false, error: 'CRM user is not a teacher' };
    }
    if (teacher.appUserId && teacher.externalLinkStatus === 'linked' && !options.force) {
        return {
            success: true,
            data: {
                alreadyLinked: true,
                appUserId: teacher.appUserId,
                crmTeacherId: teacher.id,
            },
        };
    }

    let lpResult;
    try {
        lpResult = await pushProvisionTeacherToLearningPlatform({
            crmTeacherId: teacher.id,
            phone: teacher.phone,
            firstName: teacher.name,
            lastName: teacher.lastName || '',
            email: teacher.email,
            password: options.password || undefined,
            bio: teacher.teacherBio || undefined,
        });
    } catch (err) {
        const message = err.response?.data?.error?.message
            || err.response?.data?.error
            || err.message;
        return { success: false, error: `Learning Platform provision failed: ${message}` };
    }

    if (!lpResult?.success) {
        return { success: false, error: lpResult?.error || 'Learning Platform rejected teacher provision' };
    }

    const appUserId = lpResult.data?.appUserId;
    if (!appUserId) {
        return { success: false, error: 'Learning Platform did not return appUserId' };
    }

    const updated = await prisma.student.update({
        where: { id: teacher.id },
        data: {
            appUserId,
            externalLinkStatus: 'linked',
            linkedAt: new Date(),
        },
        select: {
            id: true,
            name: true,
            lastName: true,
            phone: true,
            role: true,
            appUserId: true,
            externalLinkStatus: true,
            linkedAt: true,
        },
    });

    return {
        success: true,
        data: {
            ...lpResult.data,
            crmTeacherId: updated.id,
            crm: updated,
        },
    };
}

async function provisionCrmStudent(crmStudentId, options = {}) {
    const student = await prisma.student.findUnique({ where: { id: crmStudentId } });
    if (!student) {
        return { success: false, error: 'CRM user not found' };
    }
    if (student.role !== 'student') {
        return { success: false, error: 'CRM user is not a student' };
    }
    if (student.appUserId && student.externalLinkStatus === 'linked' && !options.force) {
        return {
            success: true,
            data: {
                alreadyLinked: true,
                appUserId: student.appUserId,
                crmStudentId: student.id,
            },
        };
    }

    let lpResult;
    try {
        lpResult = await pushProvisionStudentToLearningPlatform({
            crmStudentId: student.id,
            phone: student.phone,
            firstName: student.name,
            lastName: student.lastName || '',
            email: student.email,
            password: options.password || undefined,
        });
    } catch (err) {
        const message = err.response?.data?.error?.message
            || err.response?.data?.error
            || err.message;
        return { success: false, error: `Learning Platform provision failed: ${message}` };
    }

    if (!lpResult?.success) {
        return { success: false, error: lpResult?.error || 'Learning Platform rejected student provision' };
    }

    const appUserId = lpResult.data?.appUserId;
    if (!appUserId) {
        return { success: false, error: 'Learning Platform did not return appUserId' };
    }

    const updated = await prisma.student.update({
        where: { id: student.id },
        data: {
            appUserId,
            externalLinkStatus: 'linked',
            linkedAt: new Date(),
        },
        select: {
            id: true,
            name: true,
            lastName: true,
            phone: true,
            role: true,
            appUserId: true,
            externalLinkStatus: true,
            linkedAt: true,
        },
    });

    return {
        success: true,
        data: {
            ...lpResult.data,
            crmStudentId: updated.id,
            crm: updated,
        },
    };
}

async function getCrmProfileByPhone(phone) {
    const digits = normalizePhoneDigits(phone);
    if (digits.length < 10) {
        return { success: false, error: 'Invalid phone number' };
    }

    const crmUser = await findCrmStudentByPhone(phone);
    if (!crmUser) {
        return {
            success: true,
            data: { found: false, phoneNormalized: digits },
        };
    }

    return {
        success: true,
        data: {
            found: true,
            phoneNormalized: digits,
            crmUserId: crmUser.id,
            role: crmUser.role,
            name: `${crmUser.name} ${crmUser.lastName || ''}`.trim(),
            phone: crmUser.phone,
            appUserId: crmUser.appUserId,
            externalLinkStatus: crmUser.externalLinkStatus,
            linkedAt: crmUser.linkedAt,
        },
    };
}

module.exports = {
    LINK_STATUSES,
    getLinkStatus,
    linkUsers,
    syncFromApp,
    createSsoToken,
    provisionCrmTeacher,
    provisionCrmStudent,
    findCrmStudentByPhone,
    getCrmProfileByPhone,
};
