function buildUserDirectoryWhere(role) {
    if (role === 'departed') {
        return {
            role: 'student',
            status: 'inactive',
        };
    }

    if (role === 'student') {
        return {
            role: 'student',
            status: 'active',
        };
    }

    if (role) {
        return {
            role,
            status: { not: 'inactive' },
        };
    }

    return {
        role: { not: 'student' },
        status: { not: 'inactive' },
    };
}

module.exports = {
    buildUserDirectoryWhere,
};
