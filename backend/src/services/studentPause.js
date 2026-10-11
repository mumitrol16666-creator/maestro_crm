// Compatibility entry point for old callers. Only an administrator may resume a student.
async function restoreExpiredStudentPauses() {
    return { restored: 0 };
}
module.exports = { restoreExpiredStudentPauses };
