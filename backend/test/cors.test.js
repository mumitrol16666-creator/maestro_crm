const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';

const app = require('../src/server');

let baseUrl;
let server;

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

test('allows booking preflight requests from the public Maestro website', async () => {
    const origin = 'https://maestro.com.kz';
    const response = await fetch(`${baseUrl}/api/bookings`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
    assert.match(response.headers.get('access-control-allow-headers') || '', /Content-Type/i);
});
