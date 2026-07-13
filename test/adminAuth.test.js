const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.ADMIN_PASSWORD = 'super-secret-test-password';
process.env.NODE_ENV = 'test';

const { app } = require('../server');
const { resetAdminAuthState } = require('../lib/adminAuth');

let server;
let baseUrl;
let tempDirectory = null;
const originalBookingsFile = process.env.BOOKINGS_FILE;

function extractCookieValue(setCookieHeader) {
  return setCookieHeader.split(';', 1)[0];
}

async function createTempBookingsFile(initialBookings = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'malibu-bookings-'));
  const bookingsFile = path.join(directory, 'bookings.json');
  await fs.writeFile(bookingsFile, JSON.stringify(initialBookings, null, 2));

  return { directory, bookingsFile };
}

async function loginAsAdmin() {
  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });

  assert.equal(loginResponse.status, 200);
  return extractCookieValue(loginResponse.headers.get('set-cookie') || '');
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
  if (originalBookingsFile === undefined) {
    delete process.env.BOOKINGS_FILE;
  } else {
    process.env.BOOKINGS_FILE = originalBookingsFile;
  }
});

test.afterEach(async () => {
  if (originalBookingsFile === undefined) {
    delete process.env.BOOKINGS_FILE;
  } else {
    process.env.BOOKINGS_FILE = originalBookingsFile;
  }

  if (tempDirectory) {
    await fs.rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = null;
  }
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

  resetAdminAuthState();
  const sessionAfterRestartResponse = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: sessionCookie }
  });

  assert.equal(sessionAfterRestartResponse.status, 200);
  assert.deepEqual(await sessionAfterRestartResponse.json(), { authenticated: true });

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

test('admin can delete a booking through the protected admin API', async () => {
  const tempFileState = await createTempBookingsFile();
  tempDirectory = tempFileState.directory;
  process.env.BOOKINGS_FILE = tempFileState.bookingsFile;

  const createResponse = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Max Mustermann',
      phone: '0170 1234567',
      numberOfBoards: 2,
      startTime: '2026-04-25T10:00:00',
      endTime: '2026-04-25T11:30:00',
      paymentMethod: 'paypal'
    })
  });

  assert.equal(createResponse.status, 200);
  const createData = await createResponse.json();
  const bookingId = createData.booking.id;
  assert.ok(bookingId);

  const sessionCookie = await loginAsAdmin();

  const deleteResponse = await fetch(`${baseUrl}/api/bookings/${bookingId}`, {
    method: 'DELETE',
    headers: { Cookie: sessionCookie }
  });

  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), {
    success: true,
    deletedId: bookingId
  });

  const bookingsResponse = await fetch(`${baseUrl}/api/admin/bookings`, {
    headers: { Cookie: sessionCookie }
  });

  assert.equal(bookingsResponse.status, 200);
  const bookings = await bookingsResponse.json();
  assert.equal(bookings.some(booking => booking.id === bookingId), false);

  const secondDeleteResponse = await fetch(`${baseUrl}/api/bookings/${bookingId}`, {
    method: 'DELETE',
    headers: { Cookie: sessionCookie }
  });

  assert.equal(secondDeleteResponse.status, 404);
  assert.match((await secondDeleteResponse.json()).error, /Buchung nicht gefunden/);
});
