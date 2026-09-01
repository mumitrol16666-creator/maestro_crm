const EXPECTED_QA_MARKER = 'maestro-crm-regression';
const EXPECTED_QA_DATABASE = 'maestro_crm_regression';
const LOCAL_DATABASE_HOSTS = new Set(['db', 'localhost', '127.0.0.1']);

function inspectQaEnvironment(env = process.env) {
    const errors = [];
    const databaseUrl = String(env.DATABASE_URL || '').trim();
    let parsed = null;

    if (env.MAESTRO_QA_LOCAL !== 'true') {
        errors.push('MAESTRO_QA_LOCAL must be true');
    }
    if (env.MAESTRO_QA_DB_MARKER !== EXPECTED_QA_MARKER) {
        errors.push(`MAESTRO_QA_DB_MARKER must be ${EXPECTED_QA_MARKER}`);
    }
    if (env.NODE_ENV === 'production') {
        errors.push('NODE_ENV=production is forbidden for the QA controller');
    }

    try {
        parsed = new URL(databaseUrl);
    } catch (_error) {
        errors.push('DATABASE_URL must be a valid PostgreSQL URL');
    }

    const database = parsed ? decodeURIComponent(parsed.pathname.replace(/^\//, '')) : '';
    const hostname = parsed?.hostname || '';
    if (parsed && !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        errors.push('DATABASE_URL must use PostgreSQL');
    }
    if (parsed && !LOCAL_DATABASE_HOSTS.has(hostname)) {
        errors.push(`database host ${hostname || '<empty>'} is not local`);
    }
    if (database !== EXPECTED_QA_DATABASE) {
        errors.push(`database must be exactly ${EXPECTED_QA_DATABASE}`);
    }
    if (/prod|production|neon|supabase|render/i.test(`${hostname}/${database}`)) {
        errors.push('production-like database target is forbidden');
    }

    return {
        ok: errors.length === 0,
        errors,
        database,
        hostname,
        marker: env.MAESTRO_QA_DB_MARKER || null,
    };
}

function assertQaEnvironment(env = process.env) {
    const result = inspectQaEnvironment(env);
    if (!result.ok) {
        throw new Error(`QA operation blocked: ${result.errors.join('; ')}`);
    }
    return result;
}

module.exports = {
    EXPECTED_QA_DATABASE,
    EXPECTED_QA_MARKER,
    inspectQaEnvironment,
    assertQaEnvironment,
};
