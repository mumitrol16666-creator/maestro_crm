const EXPECTED_QA_MARKER = 'maestro-crm-regression';
const EXPECTED_QA_DATABASE = 'maestro_crm_regression';
const LOCAL_DATABASE_HOSTS = new Set(['db', 'localhost', '127.0.0.1']);

function inspectLocalDatabaseTarget(value) {
    const errors = [];
    const databaseUrl = String(value || '');
    let parsed = null;
    // pg pre-encodes raw spaces and malformed escapes before parsing. Do not
    // trim or normalize a URL that the driver will later consume unchanged.
    if (/[\s\u0000-\u001f\u007f]|%(?![a-f\d]{2})/i.test(databaseUrl)) {
        errors.push('database URL must use valid percent encoding and contain no raw whitespace');
    }

    try {
        parsed = new URL(databaseUrl);
    } catch (_error) {
        errors.push('DATABASE_URL must be a valid PostgreSQL URL');
    }

    // The dedicated database name is ASCII; encoded aliases are unnecessary.
    const database = parsed ? parsed.pathname.replace(/^\//, '') : '';
    const hostname = parsed?.hostname || '';
    if (parsed && !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        errors.push('DATABASE_URL must use PostgreSQL');
    }
    if (parsed && !LOCAL_DATABASE_HOSTS.has(hostname)) {
        errors.push(`database host ${hostname || '<empty>'} is not local`);
    }
    // pg accepts connection overrides in the query, including host/socket and
    // SSL file paths. Validate that representation before loading the driver.
    if (parsed && [...parsed.searchParams.keys()].some(key => key !== 'schema')) {
        errors.push('database URL query may contain only schema=public');
    }
    if (parsed && (parsed.searchParams.getAll('schema').length > 1
        || (parsed.searchParams.has('schema') && parsed.searchParams.get('schema') !== 'public'))) {
        errors.push('database schema must be public');
    }
    if (/prod|production|neon|supabase|render/i.test(`${hostname}/${database}`)) {
        errors.push('production-like database target is forbidden');
    }
    return { ok: errors.length === 0, errors, database, hostname };
}

function inspectQaEnvironment(env = process.env) {
    const { errors, database, hostname } = inspectLocalDatabaseTarget(env.DATABASE_URL);
    if (env.MAESTRO_QA_LOCAL !== 'true') errors.push('MAESTRO_QA_LOCAL must be true');
    if (env.MAESTRO_QA_DB_MARKER !== EXPECTED_QA_MARKER) errors.push(`MAESTRO_QA_DB_MARKER must be ${EXPECTED_QA_MARKER}`);
    if (env.NODE_ENV === 'production') errors.push('NODE_ENV=production is forbidden for the QA controller');
    if (database !== EXPECTED_QA_DATABASE) errors.push(`database must be exactly ${EXPECTED_QA_DATABASE}`);

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
    inspectLocalDatabaseTarget,
    inspectQaEnvironment,
    assertQaEnvironment,
};
