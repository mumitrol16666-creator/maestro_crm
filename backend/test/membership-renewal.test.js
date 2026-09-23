const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const routePath = require.resolve('../src/routes/memberships');
const routeRequire = createRequire(routePath);

// Old cached clients must not recreate counted/dated packages after the migration.
function harness() {
    const handlers = new Map();
    let mutations = 0;
    const router = { use() {} };
    for (const method of ['get', 'post', 'patch', 'delete']) router[method] = (path, ...callbacks) => handlers.set(method + ' ' + path, callbacks.at(-1));
    const middleware = (req, res, next) => next();
    const requireMock = id => {
        if (id === 'express') return { Router: () => router };
        if (id === './rateCards') return {};
        if (id === '../config/db') return { prisma: { $transaction: () => { mutations++; throw new Error('Unexpected mutation'); } } };
        if (id === '../middleware/auth') return { authenticate: middleware, requireAdmin: middleware };
        return routeRequire(id);
    };
    vm.runInNewContext(fs.readFileSync(routePath, 'utf8'), { require: requireMock, module: { exports: {} }, console });
    return {
        async request(body) {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
            await handlers.get('post /')({ body, user: { id: 'admin' } }, res);
            assert.equal(mutations, 0);
            return res;
        },
    };
}

for (const lessonFormat of ['program', 'individual', 'group', 'mixed']) {
    test('legacy ' + lessonFormat + ' creation and renewal are rejected without changing history or wallet', async () => {
        for (const renewal of [false, true]) {
            const response = await harness().request({ studentId: 'student', directionId: 'direction', lessonFormat,
                ...(renewal ? { renewMembershipId: 'old-purchase' } : { forceNew: true }) });
            assert.equal(response.statusCode, 400);
            assert.match(response.body.error, /тариф с расценками/);
        }
    });
}
