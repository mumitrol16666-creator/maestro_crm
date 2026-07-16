const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STAFF_ROLES,
    ensureStudentContactPhoneAvailable
} = require('../src/services/studentPhonePolicy');

test('student contact phone policy allows a phone shared only by students', async () => {
    let capturedWhere = null;
    const fakePrisma = {
        student: {
            findFirst: async (query) => {
                capturedWhere = query.where;
                return null;
            }
        }
    };

    await ensureStudentContactPhoneAvailable(fakePrisma, '+7 777 111 22 33');

    assert.equal(capturedWhere.phone, '+7 777 111 22 33');
    assert.deepEqual(capturedWhere.role.in, STAFF_ROLES);
});

test('student contact phone policy blocks staff phone reuse', async () => {
    const fakePrisma = {
        student: {
            findFirst: async () => ({ id: 'staff-1', role: 'admin' })
        }
    };

    await assert.rejects(
        () => ensureStudentContactPhoneAvailable(fakePrisma, '+7 777 111 22 33'),
        (error) => error.code === 'STAFF_PHONE_CONFLICT'
            && error.statusCode === 400
            && error.message === 'Этот номер уже используется сотрудником школы'
    );
});
