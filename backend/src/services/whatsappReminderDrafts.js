const HOMEWORK_DRAFT_OPERATION = 'whatsapp.homework-drafts.generate';

function mapGeneratedHomeworkDrafts(logs) {
    const drafts = new Map();

    for (const log of logs) {
        const classId = String(log.entityId || log.requestBody?.crmClassId || '').trim();
        const generated = Array.isArray(log.responseBody?.data?.drafts)
            ? log.responseBody.data.drafts
            : [];
        if (!classId) continue;

        for (const draft of generated) {
            const studentId = String(draft?.crmStudentId || '').trim();
            if (!studentId) continue;
            const id = `homework:${classId}:${studentId}`;
            if (drafts.has(id)) continue;

            drafts.set(id, {
                id,
                classId,
                studentId,
                studentName: draft.studentName || 'Ученик',
                phone: draft.recipient?.phone || null,
                recipientLabel: draft.recipient?.label || null,
                recipientAudience: draft.recipient?.audience || null,
                message: draft.message || null,
                messageSource: draft.source || 'template',
                messageModel: draft.model || null,
                messageNote: draft.note || null,
                generatedAt: log.completedAt || log.createdAt,
            });
        }
    }

    return drafts;
}

module.exports = { HOMEWORK_DRAFT_OPERATION, mapGeneratedHomeworkDrafts };
