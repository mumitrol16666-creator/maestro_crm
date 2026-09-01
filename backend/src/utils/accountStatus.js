function isActiveCrmAccount(user) {
    return user?.status === 'active';
}

module.exports = { isActiveCrmAccount };
