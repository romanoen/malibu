const BOOKING_START_HOUR = 8;
const BOOKING_END_HOUR = 20;
const BOOKING_INTERVAL_MINUTES = 15;
const MAX_ONLINE_DURATION_MINUTES = 4 * 60;
const VALID_PAYMENT_METHODS = new Set(['cash', 'paypal']);
const BOARD_PRICING = {
  single: {
    label: 'Singleboard',
    tiers: [
      { maxMinutes: 90, pricePerBoard: 15 },
      { maxMinutes: 120, pricePerBoard: 20 },
      { maxMinutes: 180, pricePerBoard: 25 },
      { maxMinutes: 240, pricePerBoard: 35 }
    ]
  },
  partner: {
    label: 'Partnerboard',
    tiers: [
      { maxMinutes: 90, pricePerBoard: 25 },
      { maxMinutes: 120, pricePerBoard: 35 },
      { maxMinutes: 180, pricePerBoard: 40 },
      { maxMinutes: 240, pricePerBoard: 50 }
    ]
  }
};
const VALID_BOARD_TYPES = new Set(Object.keys(BOARD_PRICING));

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDateTime(value) {
  const dateTime = trimString(value);
  if (!dateTime) return null;

  const date = new Date(dateTime);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNumberOfBoards(value) {
  const numberOfBoards = Number(value);
  if (!Number.isInteger(numberOfBoards) || numberOfBoards < 1) {
    return null;
  }

  return numberOfBoards;
}

function normalizeBoardType(value) {
  const boardType = trimString(value) || 'single';
  return VALID_BOARD_TYPES.has(boardType) ? boardType : null;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinBookingWindow(date, { allowClosingTime = false } = {}) {
  const minutes = minutesSinceMidnight(date);
  const opening = BOOKING_START_HOUR * 60;
  const closing = BOOKING_END_HOUR * 60;

  if (allowClosingTime) {
    return minutes >= opening && minutes <= closing;
  }

  return minutes >= opening && minutes < closing;
}

function isOnBookingInterval(date) {
  return (
    date.getMinutes() % BOOKING_INTERVAL_MINUTES === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

function formatDuration(durationMinutes) {
  return {
    hours: Math.floor(durationMinutes / 60),
    minutes: durationMinutes % 60,
    totalMinutes: durationMinutes
  };
}

function durationToMinutes(duration) {
  if (Number.isFinite(duration?.totalMinutes)) {
    return duration.totalMinutes;
  }

  const hours = Number(duration?.hours || 0);
  const minutes = Number(duration?.minutes || 0);
  return hours * 60 + minutes;
}

function calculatePrice(duration, numberOfBoards, boardTypeValue = 'single') {
  const boards = normalizeNumberOfBoards(numberOfBoards);
  if (boards === null) {
    throw new TypeError('numberOfBoards must be a positive integer');
  }

  const boardType = normalizeBoardType(boardTypeValue);
  if (boardType === null) {
    throw new TypeError('boardType must be single or partner');
  }

  const totalMinutes = durationToMinutes(duration);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    throw new TypeError('duration must be greater than zero');
  }

  if (totalMinutes > MAX_ONLINE_DURATION_MINUTES) {
    throw new TypeError('duration exceeds online booking limit');
  }

  const tier = BOARD_PRICING[boardType].tiers.find(({ maxMinutes }) => totalMinutes <= maxMinutes);
  const pricePerBoard = tier.pricePerBoard;

  return {
    price: pricePerBoard * boards,
    isDayRate: false,
    pricePerBoard,
    boardType
  };
}

function validateBookingTimeSelection(payload = {}) {
  const errors = [];
  const startTime = trimString(payload.startTime);
  const endTime = trimString(payload.endTime);
  const start = parseDateTime(startTime);
  const end = parseDateTime(endTime);
  const numberOfBoards = normalizeNumberOfBoards(payload.numberOfBoards);
  const boardType = normalizeBoardType(payload.boardType);

  if (numberOfBoards === null) {
    errors.push('Bitte gib eine gültige Anzahl an SUP-Boards ein.');
  }

  if (boardType === null) {
    errors.push('Bitte wähle einen gültigen Board-Typ.');
  }

  if (!start) {
    errors.push('Bitte wähle eine gültige Startzeit.');
  }

  if (!end) {
    errors.push('Bitte wähle eine gültige Endzeit.');
  }

  if (start && !isWithinBookingWindow(start)) {
    errors.push('Buchungen müssen zwischen 8:00 und vor 20:00 Uhr starten.');
  }

  if (end && !isWithinBookingWindow(end, { allowClosingTime: true })) {
    errors.push('Buchungen müssen bis spätestens 20:00 Uhr enden.');
  }

  if ((start && !isOnBookingInterval(start)) || (end && !isOnBookingInterval(end))) {
    errors.push('Buchungen sind nur in 15-Minuten-Schritten möglich.');
  }

  let durationMinutes = null;
  if (start && end) {
    durationMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);

    if (durationMinutes <= 0) {
      errors.push('Die Endzeit muss nach der Startzeit liegen.');
    } else if (durationMinutes < BOOKING_INTERVAL_MINUTES) {
      errors.push('Die Buchung muss mindestens 15 Minuten dauern.');
    } else if (durationMinutes % BOOKING_INTERVAL_MINUTES !== 0) {
      errors.push('Buchungen sind nur in 15-Minuten-Schritten möglich.');
    } else if (durationMinutes > MAX_ONLINE_DURATION_MINUTES) {
      errors.push('Online buchbar sind Zeiträume bis maximal 4 Stunden. Tages-, 10er- und Weekend-Karten stellen wir nur persönlich aus.');
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    booking: {
      startTime,
      endTime,
      boardType,
      numberOfBoards,
      duration: formatDuration(durationMinutes)
    }
  };
}

function validateBookingRequest(payload = {}) {
  const timeSelection = validateBookingTimeSelection(payload);
  const errors = [...timeSelection.errors];
  const name = trimString(payload.name);
  const phone = trimString(payload.phone);
  const paymentMethod = trimString(payload.paymentMethod);

  if (!name) {
    errors.push('Bitte gib deinen Namen ein.');
  } else if (name.length > 100) {
    errors.push('Der Name darf maximal 100 Zeichen lang sein.');
  }

  if (!phone) {
    errors.push('Bitte gib deine Telefonnummer ein.');
  } else if (phone.length > 40) {
    errors.push('Die Telefonnummer darf maximal 40 Zeichen lang sein.');
  }

  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) {
    errors.push('Bitte wähle PayPal oder Barzahlung als Zahlungsmethode.');
  }

  if (errors.length > 0 || !timeSelection.valid) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    booking: {
      ...timeSelection.booking,
      name,
      phone,
      paymentMethod
    }
  };
}

module.exports = {
  BOOKING_START_HOUR,
  BOOKING_END_HOUR,
  BOOKING_INTERVAL_MINUTES,
  MAX_ONLINE_DURATION_MINUTES,
  calculatePrice,
  normalizeBoardType,
  normalizeNumberOfBoards,
  validateBookingRequest,
  validateBookingTimeSelection
};
