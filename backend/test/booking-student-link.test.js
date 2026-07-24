const test = require('node:test');
const assert = require('node:assert/strict');
const {
    bookingQueueWhere,
    isSamePerson,
    linkOpenBookingsForStudent,
    linkBookingToExistingStudent,
} = require('../src/services/bookingStudentLink');

test('общая очередь содержит только незакрытые и несвязанные заявки', () => {
    assert.deepEqual(bookingQueueWhere(), {
        isTest: false,
        convertedToStudentId: null,
        status: { notIn: ['sold', 'rejected'] },
    });
    assert.deepEqual(bookingQueueWhere('rejected'), {
        isTest: false,
        convertedToStudentId: null,
        status: 'rejected',
    });
});

test('заявка совпадает с учеником только по телефону, имени и фамилии', () => {
    const booking = {
        name: ' Асем ',
        lastName: 'Айтжанова',
        phone: '+7 (747) 110-06-57',
    };
    assert.equal(isSamePerson(booking, {
        name: 'асем',
        lastName: 'АЙТЖАНОВА',
        phoneDigits: '77471100657',
    }), true);
    assert.equal(isSamePerson(booking, {
        name: 'Максим',
        lastName: 'Акимов',
        phoneDigits: '77471100657',
    }), false);
});

test('при создании ученика закрываются только совпавшие открытые заявки', async () => {
    let updateArgs = null;
    const prisma = {
        booking: {
            findMany: async () => [
                { id: 'booking-1', name: 'Асем', lastName: 'Айтжанова', phoneDigits: '77471100657' },
                { id: 'booking-2', name: 'Максим', lastName: 'Акимов', phoneDigits: '77471100657' },
            ],
            updateMany: async args => {
                updateArgs = args;
                return { count: 1 };
            },
        },
    };
    const result = await linkOpenBookingsForStudent(prisma, {
        id: 'student-1',
        name: 'Асем',
        lastName: 'Айтжанова',
        phoneDigits: '77471100657',
    }, 'admin-1');

    assert.equal(result.count, 1);
    assert.deepEqual(updateArgs.where.id.in, ['booking-1']);
    assert.equal(updateArgs.data.convertedToStudentId, 'student-1');
    assert.equal(updateArgs.data.status, 'sold');
    assert.equal(updateArgs.data.convertedById, 'admin-1');
});

test('новая заявка существующего ученика сразу связывается с его карточкой', async () => {
    let updateArgs = null;
    const prisma = {
        student: {
            findMany: async () => [
                { id: 'student-1', name: 'Асем', lastName: 'Айтжанова', phoneDigits: '77471100657' },
            ],
        },
        booking: {
            update: async args => {
                updateArgs = args;
                return { id: args.where.id, ...args.data };
            },
        },
    };
    const result = await linkBookingToExistingStudent(prisma, {
        id: 'booking-1',
        name: 'Асем',
        lastName: 'Айтжанова',
        phoneDigits: '77471100657',
    });

    assert.equal(result.linked, true);
    assert.equal(updateArgs.data.convertedToStudentId, 'student-1');
    assert.equal(updateArgs.data.status, 'sold');
});
