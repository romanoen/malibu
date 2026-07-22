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
const originalPricingSettingsFile = process.env.PRICING_SETTINGS_FILE;

function extractCookieValue(setCookieHeader) {
  return setCookieHeader.split(';', 1)[0];
}

async function createTempBookingsFile(initialBookings = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'malibu-bookings-'));
  const bookingsFile = path.join(directory, 'bookings.json');
  await fs.writeFile(bookingsFile, JSON.stringify(initialBookings, null, 2));

  return { directory, bookingsFile };
}

async function createTempPricingSettingsFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'malibu-pricing-'));
  const pricingSettingsFile = path.join(directory, 'pricing-settings.json');

  return { directory, pricingSettingsFile };
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

  if (originalPricingSettingsFile === undefined) {
    delete process.env.PRICING_SETTINGS_FILE;
  } else {
    process.env.PRICING_SETTINGS_FILE = originalPricingSettingsFile;
  }
});

test.afterEach(async () => {
  if (originalBookingsFile === undefined) {
    delete process.env.BOOKINGS_FILE;
  } else {
    process.env.BOOKINGS_FILE = originalBookingsFile;
  }

  if (originalPricingSettingsFile === undefined) {
    delete process.env.PRICING_SETTINGS_FILE;
  } else {
    process.env.PRICING_SETTINGS_FILE = originalPricingSettingsFile;
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
      paymentMethod: 'cash'
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

test('admin can export bookings as a protected JSON backup', async () => {
  const tempFileState = await createTempBookingsFile([{
    id: 'booking-export-test',
    name: 'Export Test',
    phone: '0170 7654321',
    boardType: 'allround',
    numberOfBoards: 1,
    peoplePerBoard: 1,
    startTime: '2026-04-25T10:00:00',
    endTime: '2026-04-25T11:30:00',
    price: 15,
    paymentMethod: 'cash',
    status: 'pending',
    createdAt: '2026-04-20T08:00:00.000Z'
  }]);
  tempDirectory = tempFileState.directory;
  process.env.BOOKINGS_FILE = tempFileState.bookingsFile;

  const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/database-export`);
  assert.equal(unauthorizedResponse.status, 401);

  const sessionCookie = await loginAsAdmin();
  const exportResponse = await fetch(`${baseUrl}/api/admin/database-export`, {
    headers: { Cookie: sessionCookie }
  });

  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /application\/json/);
  assert.match(exportResponse.headers.get('content-disposition') || '', /malibu-datenbank-export-/);

  const exportData = await exportResponse.json();
  assert.equal(exportData.recordCounts.bookings, 1);
  assert.equal(exportData.bookings[0].id, 'booking-export-test');
});

test('admin can edit pricing settings and public price calculations use them', async () => {
  const tempPricingState = await createTempPricingSettingsFile();
  tempDirectory = tempPricingState.directory;
  process.env.PRICING_SETTINGS_FILE = tempPricingState.pricingSettingsFile;

  const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/pricing`);
  assert.equal(unauthorizedResponse.status, 401);

  const publicPricingResponse = await fetch(`${baseUrl}/api/pricing`);
  assert.equal(publicPricingResponse.status, 200);
  const publicPricing = await publicPricingResponse.json();
  assert.equal(publicPricing.priceTiers[0].pricePerBoard, 15);

  const sessionCookie = await loginAsAdmin();
  const pricingResponse = await fetch(`${baseUrl}/api/admin/pricing`, {
    headers: { Cookie: sessionCookie }
  });

  assert.equal(pricingResponse.status, 200);
  const pricing = await pricingResponse.json();

  const updateResponse = await fetch(`${baseUrl}/api/admin/pricing`, {
    method: 'PUT',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      priceTiers: pricing.priceTiers.map(tier => ({
        key: tier.key,
        maxMinutes: tier.maxMinutes,
        pricePerBoard: tier.key === '90' ? '18.50' : tier.pricePerBoard
      })),
      twoPersonSurchargePerBoard: '6.50'
    })
  });

  assert.equal(updateResponse.status, 200);
  const updateData = await updateResponse.json();
  assert.equal(updateData.success, true);
  assert.equal(updateData.pricing.priceTiers[0].pricePerBoard, 18.5);
  assert.equal(updateData.pricing.twoPersonSurchargePerBoard, 6.5);

  const priceResponse = await fetch(`${baseUrl}/api/calculate-price`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startTime: '2026-04-25T10:00:00',
      endTime: '2026-04-25T11:30:00',
      boardItems: [
        { boardType: 'allround', quantity: 1, peoplePerBoard: 1 }
      ]
    })
  });

  assert.equal(priceResponse.status, 200);
  assert.equal((await priceResponse.json()).price, 18.5);

  const invalidResponse = await fetch(`${baseUrl}/api/admin/pricing`, {
    method: 'PUT',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      priceTiers: pricing.priceTiers.map(tier => ({
        key: tier.key,
        maxMinutes: tier.maxMinutes,
        pricePerBoard: tier.key === '90' ? -1 : tier.pricePerBoard
      })),
      twoPersonSurchargePerBoard: '6.50'
    })
  });

  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /90 Minuten/);
});
