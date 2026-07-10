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
  assert.deepEqual(calculatePrice({ hours: 1, minutes: 30 }, 4, 'lightweight', 1), {
    price: 60,
    isDayRate: false,
    pricePerBoard: 15,
    basePricePerBoard: 15,
    occupancySurchargePerBoard: 0,
    boardType: 'lightweight',
    peoplePerBoard: 1
  });

  assert.deepEqual(calculatePrice({ hours: 2, minutes: 0 }, 2, 'allround', 1), {
    price: 40,
    isDayRate: false,
    pricePerBoard: 20,
    basePricePerBoard: 20,
    occupancySurchargePerBoard: 0,
    boardType: 'allround',
    peoplePerBoard: 1
  });

  assert.deepEqual(calculatePrice({ hours: 3, minutes: 0 }, 2, 'allround', 1), {
    price: 60,
    isDayRate: false,
    pricePerBoard: 30,
    basePricePerBoard: 30,
    occupancySurchargePerBoard: 0,
    boardType: 'allround',
    peoplePerBoard: 1
  });

  assert.deepEqual(calculatePrice({ hours: 4, minutes: 0 }, 1, 'allround', 1), {
    price: 40,
    isDayRate: false,
    pricePerBoard: 40,
    basePricePerBoard: 40,
    occupancySurchargePerBoard: 0,
    boardType: 'allround',
    peoplePerBoard: 1
  });

  assert.deepEqual(calculatePrice({ hours: 5, minutes: 0 }, 1, 'allround', 1), {
    price: 50,
    isDayRate: true,
    pricePerBoard: 50,
    basePricePerBoard: 50,
    occupancySurchargePerBoard: 0,
    boardType: 'allround',
    peoplePerBoard: 1
  });
});

test('adds the two-person surcharge for eligible board categories', () => {
  assert.deepEqual(calculatePrice({ hours: 1, minutes: 30 }, 1, 'super_allround', 2), {
    price: 20,
    isDayRate: false,
    pricePerBoard: 20,
    basePricePerBoard: 15,
    occupancySurchargePerBoard: 5,
    boardType: 'super_allround',
    peoplePerBoard: 2
  });

  assert.deepEqual(calculatePrice({ hours: 4, minutes: 0 }, 2, 'bigboard', 2), {
    price: 90,
    isDayRate: false,
    pricePerBoard: 45,
    basePricePerBoard: 40,
    occupancySurchargePerBoard: 5,
    boardType: 'bigboard',
    peoplePerBoard: 2
  });
});

test('rejects invalid board occupancy combinations', () => {
  const result = validateBookingTimeSelection({
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00',
    boardType: 'lightweight',
    numberOfBoards: 1,
    peoplePerBoard: 2
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Leichtgewicht/);

  const bigboard = validateBookingTimeSelection({
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00',
    boardType: 'bigboard',
    numberOfBoards: 1,
    peoplePerBoard: 1
  });

  assert.equal(bigboard.valid, false);
  assert.match(bigboard.errors.join(' '), /ausschließlich für 2 Erwachsene/);

  assert.throws(
    () => calculatePrice({ hours: 2, minutes: 0 }, 1, 'allround', 2),
    /Allround Damen/
  );
});

test('rejects durations outside the daily online window', () => {
  const result = validateBookingTimeSelection({
    startTime: '2026-07-01T08:00:00',
    endTime: '2026-07-01T20:15:00',
    numberOfBoards: 1
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /20:00 Uhr/);

  assert.throws(
    () => calculatePrice({ hours: 12, minutes: 15 }, 1),
    /duration exceeds online booking limit/
  );
});

test('normalizes complete booking requests', () => {
  const result = validateBookingRequest({
    name: '  Mara Muster  ',
    phone: '  +49 152 123456  ',
    boardType: 'super_allround',
    numberOfBoards: '2',
    peoplePerBoard: '2',
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00',
    paymentMethod: 'paypal'
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.name, 'Mara Muster');
  assert.equal(result.booking.phone, '+49 152 123456');
  assert.equal(result.booking.boardType, 'super_allround');
  assert.equal(result.booking.numberOfBoards, 2);
  assert.equal(result.booking.peoplePerBoard, 2);
});

test('normalizes legacy board types', () => {
  const result = validateBookingRequest({
    name: 'Mara Muster',
    phone: '+49 152 123456',
    boardType: 'partner',
    numberOfBoards: '1',
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00',
    paymentMethod: 'cash'
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.boardType, 'bigboard');
  assert.equal(result.booking.peoplePerBoard, 2);
});
