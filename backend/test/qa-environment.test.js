const test = require('node:test');
const assert = require('node:assert/strict');

const {
    EXPECTED_QA_DATABASE,
    EXPECTED_QA_MARKER,
    inspectQaEnvironment,
    inspectLocalDatabaseTarget,
    assertQaEnvironment,
} = require('../src/services/qaEnvironment');
const { secretsMatch } = require('../src/middleware/qaControllerAuth');
const {
    qaClassId,
    assertDynamicClassId,
    parseSchedule,
} = require('../src/services/qaFixtureController');

const validEnvironment = {
    NODE_ENV: 'development',
    MAESTRO_QA_LOCAL: 'true',
    MAESTRO_QA_DB_MARKER: EXPECTED_QA_MARKER,
    DATABASE_URL: `postgresql://qa:qa@db:5432/${EXPECTED_QA_DATABASE}?schema=public`,
};

test('QA controller accepts only the dedicated local regression database', () => {
    const result = inspectQaEnvironment(validEnvironment);
    assert.equal(result.ok, true);
    assert.equal(result.database, EXPECTED_QA_DATABASE);
    assert.equal(result.hostname, 'db');
});

test('QA controller rejects the regular local CRM database', () => {
    const result = inspectQaEnvironment({
        ...validEnvironment,
        DATABASE_URL: 'postgresql://maestro:secret@db:5432/maestro_crm?schema=public',
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /maestro_crm_regression/);
});

test('QA controller rejects remote and production-like targets', () => {
    const remote = inspectQaEnvironment({
        ...validEnvironment,
        DATABASE_URL: `postgresql://qa:qa@production.example.com:5432/${EXPECTED_QA_DATABASE}`,
    });
    assert.equal(remote.ok, false);
    assert.match(remote.errors.join(' '), /not local|production-like/);
    assert.throws(() => assertQaEnvironment({ ...validEnvironment, NODE_ENV: 'production' }), /blocked/);
});

test('QA guard rejects driver query overrides and alternate schema representations', () => {
    for (const query of ['host=remote.invalid', 'host=%2Ftmp%2Fpg-socket', '%68ost=remote.invalid',
        'sslkey=/tmp/secret', 'database=production', 'schema=private', 'schema=public&schema=private', 'options=-csearch_path=other']) {
        assert.equal(inspectQaEnvironment({ ...validEnvironment,
            DATABASE_URL: `postgresql://qa:qa@localhost/${EXPECTED_QA_DATABASE}?${query}` }).ok, false, query);
    }
});

test('QA and administrative test guards reject representations reinterpreted by pg', () => {
    for (const value of [' postgresql://qa:qa@localhost/maestro_crm_regression',
        'postgresql://qa:qa@localhost/maestro_crm_regression ',
        'postgresql://qa:p ass@localhost/maestro%5fcrm%5fregression',
        'postgresql://qa:p%xx@localhost/maestro_crm_regression',
        'postgresql://qa:qa@local\thost/maestro_crm_regression',
        'postgresql://qa:qa@localhost/maestro_p0_test?host=remote.invalid',
        'postgresql://qa:qa@localhost/maestro_p0_test?%68ost=%2Ftmp%2Fother-pg']) {
        assert.equal(inspectLocalDatabaseTarget(value).ok, false, value);
        assert.equal(inspectQaEnvironment({ ...validEnvironment, DATABASE_URL: value }).ok, false, value);
    }
    for (const value of ['postgresql://qa:p%20ass@localhost/maestro_crm_regression?schema=public',
        'postgresql://qa:p%25ss@127.0.0.1:5432/maestro_crm_regression']) {
        assert.equal(inspectQaEnvironment({ ...validEnvironment, DATABASE_URL: value }).ok, true, value);
    }
});

test('QA controller secret uses exact constant-time-compatible matching', () => {
    assert.equal(secretsMatch('local-maestro-qa-controller-2026', 'local-maestro-qa-controller-2026'), true);
    assert.equal(secretsMatch('local-maestro-qa-controller-2025', 'local-maestro-qa-controller-2026'), false);
    assert.equal(secretsMatch('short', 'local-maestro-qa-controller-2026'), false);
});

test('dynamic lesson IDs are constrained to the QA run prefix', () => {
    assert.equal(qaClassId('individual-01'), 'QA-RUN-CLASS-INDIVIDUAL-01');
    assert.equal(assertDynamicClassId('qa-run-class-individual-01'), 'QA-RUN-CLASS-INDIVIDUAL-01');
    assert.throws(() => assertDynamicClassId('REAL-CLASS-1'), /Only QA-RUN-CLASS/);
    assert.throws(() => qaClassId('../production'), /scenarioId/);
});

test('lesson schedule accepts a bounded same-day interval', () => {
    const schedule = parseSchedule({ date: '2026-09-07', startTime: '10:00', endTime: '11:00' });
    assert.equal(schedule.duration, 60);
    assert.equal(schedule.startTime, '10:00');
    assert.throws(
        () => parseSchedule({ date: '2026-09-07', startTime: '11:00', endTime: '10:00' }),
        /duration/,
    );
});
