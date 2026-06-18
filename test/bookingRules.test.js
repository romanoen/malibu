const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePrice,
  validateBookingRequest,
  validateBookingTimeSelection
} = require('../lib/bookingRules');

test('allows bookings to end exactly at closing time', () => {
  const result = validateBookingTimeSelection({
    startTime: '2026-07-01T19:45:00',
    endTime: '2026-07-01T20:00:00',
    numberOfBoards: 1
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.booking.duration, {
    hours: 0,
    minutes: 15,
    totalMinutes: 15
  });
});

test('rejects starts at closing time and backwards durations', () => {
  const closingStart = validateBookingTimeSelection({
    startTime: '2026-07-01T20:00:00',
    endTime: '2026-07-01T20:15:00',
    numberOfBoards: 1
  });
  assert.equal(closingStart.valid, false);
  assert.match(closingStart.errors.join(' '), /vor 20:00 Uhr/);

  const backwards = validateBookingTimeSelection({
    startTime: '2026-07-01T12:00:00',
    endTime: '2026-07-01T11:45:00',
    numberOfBoards: 1
  });
  assert.equal(backwards.valid, false);
  assert.match(backwards.errors.join(' '), /nach der Startzeit/);
});

test('rejects invalid board counts and non-interval times', () => {
  const result = validateBookingTimeSelection({
    startTime: '2026-07-01T10:10:00',
    endTime: '2026-07-01T11:00:00',
    numberOfBoards: 0
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Anzahl/);
  assert.match(result.errors.join(' '), /15-Minuten/);
});

test('calculates current price tiers', () => {
  assert.deepEqual(calculatePrice({ hours: 1, minutes: 30 }, 4), {
    price: 60,
    isDayRate: false,
    pricePerBoard: 15,
    boardType: 'single'
  });

  assert.deepEqual(calculatePrice({ hours: 2, minutes: 0 }, 2), {
    price: 40,
    isDayRate: false,
    pricePerBoard: 20,
    boardType: 'single'
  });

  assert.deepEqual(calculatePrice({ hours: 3, minutes: 0 }, 2), {
    price: 50,
    isDayRate: false,
    pricePerBoard: 25,
    boardType: 'single'
  });

  assert.deepEqual(calculatePrice({ hours: 4, minutes: 0 }, 1), {
    price: 35,
    isDayRate: false,
    pricePerBoard: 35,
    boardType: 'single'
  });
});

test('calculates partnerboard price tiers', () => {
  assert.deepEqual(calculatePrice({ hours: 1, minutes: 30 }, 1, 'partner'), {
    price: 25,
    isDayRate: false,
    pricePerBoard: 25,
    boardType: 'partner'
  });

  assert.deepEqual(calculatePrice({ hours: 4, minutes: 0 }, 2, 'partner'), {
    price: 100,
    isDayRate: false,
    pricePerBoard: 50,
    boardType: 'partner'
  });
});

test('rejects durations that are not online bookable', () => {
  const result = validateBookingTimeSelection({
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T14:15:00',
    numberOfBoards: 1
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /maximal 4 Stunden/);

  assert.throws(
    () => calculatePrice({ hours: 4, minutes: 15 }, 1),
    /duration exceeds online booking limit/
  );
});

test('normalizes complete booking requests', () => {
  const result = validateBookingRequest({
    name: '  Mara Muster  ',
    phone: '  +49 152 123456  ',
    boardType: 'partner',
    numberOfBoards: '2',
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00',
    paymentMethod: 'paypal'
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.name, 'Mara Muster');
  assert.equal(result.booking.phone, '+49 152 123456');
  assert.equal(result.booking.boardType, 'partner');
  assert.equal(result.booking.numberOfBoards, 2);
});
