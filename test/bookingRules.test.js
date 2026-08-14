const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePrice,
  validatePricingSettings,
  validateBookingRequest,
  validateBookingTimeSelection
} = require('../lib/bookingRules');

test('allows bookings to end exactly at closing time', () => {
  const result = validateBookingTimeSelection({
    startTime: '2026-07-01T21:45:00',
    endTime: '2026-07-01T22:00:00',
    numberOfBoards: 1
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.booking.duration, {
    hours: 0,
    minutes: 15,
    totalMinutes: 15
  });
});

test('treats ISO-like booking timestamps as local booking times', () => {
  const result = validateBookingTimeSelection({
    startTime: '2026-07-01T21:45:00.000Z',
    endTime: '2026-07-01T22:00:00.000Z',
    numberOfBoards: 1
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.duration.totalMinutes, 15);
});

test('rejects starts at closing time and backwards durations', () => {
  const closingStart = validateBookingTimeSelection({
    startTime: '2026-07-01T22:00:00',
    endTime: '2026-07-01T22:15:00',
    numberOfBoards: 1
  });
  assert.equal(closingStart.valid, false);
  assert.match(closingStart.errors.join(' '), /vor 22:00 Uhr/);

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
  assert.equal(calculatePrice({ hours: 1, minutes: 30 }, 4, 'lightweight', 1).price, 60);
  assert.equal(calculatePrice({ hours: 2, minutes: 0 }, 2, 'allround', 1).price, 40);
  assert.equal(calculatePrice({ hours: 3, minutes: 0 }, 2, 'allround', 1).price, 60);
  assert.equal(calculatePrice({ hours: 4, minutes: 0 }, 1, 'allround', 1).price, 40);

  const dayTicket = calculatePrice({ hours: 5, minutes: 0 }, 1, 'allround', 1);
  assert.equal(dayTicket.price, 50);
  assert.equal(dayTicket.isDayRate, true);
});

test('adds the two-person surcharge for eligible board categories', () => {
  const superAllround = calculatePrice({ hours: 1, minutes: 30 }, 1, 'super_allround', 2);
  assert.equal(superAllround.price, 20);
  assert.equal(superAllround.pricePerBoard, 20);
  assert.equal(superAllround.boardItems[0].occupancySurchargePerBoard, 5);

  const bigboard = calculatePrice({ hours: 4, minutes: 0 }, 2, 'bigboard', 2);
  assert.equal(bigboard.price, 90);
  assert.equal(bigboard.pricePerBoard, 45);
});

test('calculates mixed board item bookings', () => {
  const result = calculatePrice({ hours: 2, minutes: 0 }, [
    { boardType: 'allround', quantity: 1, peoplePerBoard: 1 },
    { boardType: 'super_allround', quantity: 1, peoplePerBoard: 2 },
    { boardType: 'bigboard', quantity: 2, peoplePerBoard: 2 }
  ]);

  assert.equal(result.price, 95);
  assert.equal(result.numberOfBoards, 4);
  assert.equal(result.pricePerBoard, 0);
  assert.deepEqual(result.boardItems.map(item => ({
    boardType: item.boardType,
    quantity: item.quantity,
    peoplePerBoard: item.peoplePerBoard,
    price: item.price
  })), [
    { boardType: 'allround', quantity: 1, peoplePerBoard: 1, price: 20 },
    { boardType: 'super_allround', quantity: 1, peoplePerBoard: 2, price: 25 },
    { boardType: 'bigboard', quantity: 2, peoplePerBoard: 2, price: 50 }
  ]);
});

test('calculates bookings with custom pricing settings', () => {
  const customPricing = {
    priceTiers: [
      { key: '90', pricePerBoard: 18 },
      { key: '120', pricePerBoard: 24 },
      { key: '180', pricePerBoard: 35 },
      { key: '240', pricePerBoard: 44 },
      { key: 'day', pricePerBoard: 55 }
    ],
    twoPersonSurchargePerBoard: 7
  };

  const result = calculatePrice({ hours: 2, minutes: 0 }, [
    { boardType: 'allround', quantity: 1, peoplePerBoard: 1 },
    { boardType: 'super_allround', quantity: 1, peoplePerBoard: 2 }
  ], customPricing);

  assert.equal(result.price, 55);
  assert.equal(result.basePricePerBoard, 24);
  assert.equal(result.boardItems[1].occupancySurchargePerBoard, 7);
  assert.equal(result.boardItems[1].price, 31);
});

test('validates editable pricing settings', () => {
  const validPricing = validatePricingSettings({
    priceTiers: [
      { key: '90', pricePerBoard: '15.50' },
      { key: '120', pricePerBoard: '20' },
      { key: '180', pricePerBoard: '30' },
      { key: '240', pricePerBoard: '40' },
      { key: 'day', pricePerBoard: '50' }
    ],
    twoPersonSurchargePerBoard: '5'
  }, { requireComplete: true });

  assert.equal(validPricing.valid, true);
  assert.equal(validPricing.settings.priceTiers[0].pricePerBoard, 15.5);

  const invalidPricing = validatePricingSettings({
    priceTiers: [
      { key: '90', pricePerBoard: -1 },
      { key: '120', pricePerBoard: 20 },
      { key: '180', pricePerBoard: 30 },
      { key: '240', pricePerBoard: 40 },
      { key: 'day', pricePerBoard: 50 }
    ],
    twoPersonSurchargePerBoard: 5
  }, { requireComplete: true });

  assert.equal(invalidPricing.valid, false);
  assert.match(invalidPricing.errors.join(' '), /90 Minuten/);
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
    endTime: '2026-07-01T22:15:00',
    numberOfBoards: 1
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /22:00 Uhr/);

  assert.throws(
    () => calculatePrice({ hours: 14, minutes: 15 }, 1),
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
    paymentMethod: 'stripe'
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.name, 'Mara Muster');
  assert.equal(result.booking.phone, '+49 152 123456');
  assert.equal(result.booking.boardType, 'super_allround');
  assert.equal(result.booking.numberOfBoards, 2);
  assert.equal(result.booking.peoplePerBoard, 2);
  assert.deepEqual(result.booking.boardItems, [
    { boardType: 'super_allround', quantity: 2, peoplePerBoard: 2 }
  ]);
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

test('defaults new booking requests to Stripe payments', () => {
  const result = validateBookingRequest({
    name: 'Mara Muster',
    phone: '+49 152 123456',
    boardType: 'allround',
    numberOfBoards: '1',
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00'
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.paymentMethod, 'stripe');
});

test('normalizes mixed booking requests', () => {
  const result = validateBookingRequest({
    name: 'Mara Muster',
    phone: '+49 152 123456',
    boardItems: [
      { boardType: 'allround', quantity: '1', peoplePerBoard: '1' },
      { boardType: 'allround', quantity: '2', peoplePerBoard: '1' },
      { boardType: 'super_allround', quantity: '1', peoplePerBoard: '2' }
    ],
    startTime: '2026-07-01T10:00:00',
    endTime: '2026-07-01T12:00:00',
    paymentMethod: 'stripe'
  });

  assert.equal(result.valid, true);
  assert.equal(result.booking.numberOfBoards, 4);
  assert.deepEqual(result.booking.boardItems, [
    { boardType: 'allround', quantity: 3, peoplePerBoard: 1 },
    { boardType: 'super_allround', quantity: 1, peoplePerBoard: 2 }
  ]);
});
