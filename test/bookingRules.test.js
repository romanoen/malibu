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
    price: 50,
    isDayRate: false,
    pricePerBoard: 12.5,
    isGroupSpecial: true
  });

  assert.deepEqual(calculatePrice({ hours: 2, minutes: 0 }, 2), {
    price: 40,
    isDayRate: false,
    pricePerBoard: 20
  });

  assert.deepEqual(calculatePrice({ hours: 24, minutes: 0 }, 2), {
    price: 100,
    isDayRate: true,
    pricePerBoard: 50
  });
});

test('normalizes complete booking requests', () => {
  const result = validateBookingRequest({
    name: '  Mara Muster  ',
    phone: '  +49 152 123456  ',
    numberOfBoards: '2',
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00',
    paymentMethod: 'paypal'
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.name, 'Mara Muster');
  assert.equal(result.booking.phone, '+49 152 123456');
  assert.equal(result.booking.numberOfBoards, 2);
});
