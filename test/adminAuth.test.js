const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_PASSWORD = 'super-secret-test-password';
process.env.NODE_ENV = 'test';

const { app } = require('../server');
const { resetAdminAuthState } = require('../lib/adminAuth');

let server;
let baseUrl;

function extractCookieValue(setCookieHeader) {
  return setCookieHeader.split(';', 1)[0];
}

test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!server) {
    return;
  }

  await new Promise(resolve => server.close(resolve));
});

test.beforeEach(() => {
  resetAdminAuthState();
});

test('admin login sets an HttpOnly session cookie and logout invalidates it', async () => {
  const beforeLogin = await fetch(`${baseUrl}/api/admin/session`);
  assert.equal(beforeLogin.status, 401);

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });

  assert.equal(loginResponse.status, 200);
  assert.deepEqual(await loginResponse.json(), { success: true });

  const setCookieHeader = loginResponse.headers.get('set-cookie');
  assert.ok(setCookieHeader);
  assert.match(setCookieHeader, /admin_session=/);
  assert.match(setCookieHeader, /HttpOnly/i);
  assert.match(setCookieHeader, /SameSite=Lax/i);

  const sessionCookie = extractCookieValue(setCookieHeader);
  const sessionResponse = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: sessionCookie }
  });

  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), { authenticated: true });

  const logoutResponse = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: { Cookie: sessionCookie }
  });

  assert.equal(logoutResponse.status, 200);
  assert.deepEqual(await logoutResponse.json(), { success: true });
  assert.match(logoutResponse.headers.get('set-cookie') || '', /Max-Age=0/);

  const afterLogout = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: sessionCookie }
  });

  assert.equal(afterLogout.status, 401);
});

test('login attempts are rate-limited after repeated bad passwords', async () => {
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.match(body.error, /Falsches Passwort/);
  }

  const blockedResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' })
  });

  assert.equal(blockedResponse.status, 429);
  assert.ok(Number(blockedResponse.headers.get('retry-after')) > 0);
  assert.match((await blockedResponse.json()).error, /Zu viele Login-Versuche/);

  const stillBlockedResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });

  assert.equal(stillBlockedResponse.status, 429);
});
