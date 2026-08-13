const BOOKING_START_HOUR = 8;
const BOOKING_END_HOUR = 20;
const BOOKING_INTERVAL_MINUTES = 15;
const MAX_ONLINE_DURATION_MINUTES = (BOOKING_END_HOUR - BOOKING_START_HOUR) * 60;
const VALID_PAYMENT_METHODS = new Set(['stripe', 'cash', 'paypal']);
const DEFAULT_TWO_PERSON_SURCHARGE_PER_BOARD = 5;
const DEFAULT_PRICE_TIERS = [
  { key: '90', label: '90 Minuten', maxMinutes: 90, pricePerBoard: 15 },
  { key: '120', label: '2h', maxMinutes: 120, pricePerBoard: 20 },
  { key: '180', label: '3h', maxMinutes: 180, pricePerBoard: 30 },
  { key: '240', label: '1/2 Tag', maxMinutes: 240, pricePerBoard: 40 },
  { key: 'day', label: 'Tagesticket', maxMinutes: MAX_ONLINE_DURATION_MINUTES, pricePerBoard: 50, isDayRate: true }
];
const DEFAULT_PRICING_SETTINGS = {
  priceTiers: DEFAULT_PRICE_TIERS,
  twoPersonSurchargePerBoard: DEFAULT_TWO_PERSON_SURCHARGE_PER_BOARD
};
const TWO_PERSON_SURCHARGE_PER_BOARD = DEFAULT_TWO_PERSON_SURCHARGE_PER_BOARD;
const PRICE_TIERS = DEFAULT_PRICE_TIERS;
const BOARD_TYPES = {
  lightweight: {
    label: 'Leichtgewicht',
    weightHint: 'bis ca. 65 kg',
    allowedPeoplePerBoard: [1]
  },
  allround: {
    label: 'Allround Damen',
    weightHint: 'bis ca. 80 kg',
    allowedPeoplePerBoard: [1]
  },
  super_allround: {
    label: 'Super-Allround',
    weightHint: 'bis ca. 120 kg',
    allowedPeoplePerBoard: [1, 2]
  },
  bigboard: {
    label: 'Bigboard',
    weightHint: 'bis ca. 180 kg',
    allowedPeoplePerBoard: [2]
  }
};
const LEGACY_BOARD_TYPE_MAP = {
  single: 'allround',
  partner: 'bigboard'
};
const MAX_BOARD_ITEM_LINES = 8;
const VALID_BOARD_TYPES = new Set(Object.keys(BOARD_TYPES));

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMoneyValue(value) {
  const parsedValue = Number.parseFloat(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 10000) {
    return null;
  }

  return Math.round(parsedValue * 100) / 100;
}

function cloneDefaultPricingSettings() {
  return {
    priceTiers: DEFAULT_PRICE_TIERS.map(tier => ({ ...tier })),
    twoPersonSurchargePerBoard: DEFAULT_TWO_PERSON_SURCHARGE_PER_BOARD
  };
}

function findIncomingPriceTier(priceTiers, defaultTier) {
  return priceTiers.find(tier => (
    tier &&
    typeof tier === 'object' &&
    (
      tier.key === defaultTier.key ||
      Number.parseInt(tier.maxMinutes, 10) === defaultTier.maxMinutes
    )
  ));
}

function validatePricingSettings(input = {}, options = {}) {
  const { requireComplete = false } = options;
  const source = input && typeof input === 'object' ? input : {};
  const incomingTiers = Array.isArray(source.priceTiers) ? source.priceTiers : [];
  const errors = [];

  const priceTiers = DEFAULT_PRICE_TIERS.map(defaultTier => {
    const incomingTier = findIncomingPriceTier(incomingTiers, defaultTier);

    if (!incomingTier) {
      if (requireComplete) {
        errors.push(`${defaultTier.label}: Preis fehlt.`);
      }
      return { ...defaultTier };
    }

    const pricePerBoard = normalizeMoneyValue(incomingTier.pricePerBoard);
    if (pricePerBoard === null) {
      errors.push(`${defaultTier.label}: Bitte einen gültigen Preis zwischen 0 und 10.000 Euro eingeben.`);
      return { ...defaultTier };
    }

    return {
      ...defaultTier,
      pricePerBoard
    };
  });

  const hasSurcharge = Object.prototype.hasOwnProperty.call(source, 'twoPersonSurchargePerBoard');
  if (requireComplete && !hasSurcharge) {
    errors.push('Zuschlag für 2 Personen fehlt.');
  }

  const twoPersonSurchargePerBoard = hasSurcharge
    ? normalizeMoneyValue(source.twoPersonSurchargePerBoard)
    : DEFAULT_TWO_PERSON_SURCHARGE_PER_BOARD;

  if (twoPersonSurchargePerBoard === null) {
    errors.push('Zuschlag für 2 Personen muss zwischen 0 und 10.000 Euro liegen.');
  }

  return {
    valid: errors.length === 0,
    errors,
    settings: {
      priceTiers,
      twoPersonSurchargePerBoard: twoPersonSurchargePerBoard ?? DEFAULT_TWO_PERSON_SURCHARGE_PER_BOARD
    }
  };
}

function normalizePricingSettings(input) {
  const result = validatePricingSettings(input);
  if (!result.valid) {
    throw new TypeError(result.errors[0] || 'pricing settings must be valid');
  }

  return result.settings;
}

function getEffectivePricingSettings(input) {
  return input === undefined || input === null
    ? cloneDefaultPricingSettings()
    : normalizePricingSettings(input);
}

function isPricingSettingsShape(value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    (
      Array.isArray(value.priceTiers) ||
      Object.prototype.hasOwnProperty.call(value, 'twoPersonSurchargePerBoard')
    );
}

function parseDateTime(value) {
  const dateTime = trimString(value);
  if (!dateTime) return null;

  const localDateTimeMatch = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  const date = localDateTimeMatch
    ? new Date(
      Number(localDateTimeMatch[1]),
      Number(localDateTimeMatch[2]) - 1,
      Number(localDateTimeMatch[3]),
      Number(localDateTimeMatch[4]),
      Number(localDateTimeMatch[5]),
      Number(localDateTimeMatch[6] || 0)
    )
    : new Date(dateTime);
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
  const boardType = trimString(value) || 'allround';
  if (LEGACY_BOARD_TYPE_MAP[boardType]) {
    return LEGACY_BOARD_TYPE_MAP[boardType];
  }

  return VALID_BOARD_TYPES.has(boardType) ? boardType : null;
}

function normalizePeoplePerBoard(value, boardType) {
  const isBlank = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  if (isBlank) {
    return boardType === 'bigboard' ? 2 : 1;
  }

  const peoplePerBoard = Number(value);
  if (!Number.isInteger(peoplePerBoard) || ![1, 2].includes(peoplePerBoard)) {
    return null;
  }

  return peoplePerBoard;
}

function getBoardOccupancyError(boardType, peoplePerBoard) {
  const boardConfig = BOARD_TYPES[boardType];
  if (!boardConfig || peoplePerBoard === null) {
    return null;
  }

  if (boardConfig.allowedPeoplePerBoard.includes(peoplePerBoard)) {
    return null;
  }

  if (boardType === 'bigboard') {
    return 'Bigboards sind ausschließlich für 2 Erwachsene geeignet. Bitte wähle 2 Personen pro Board.';
  }

  return `${boardConfig.label}-Boards können nur mit 1 Person belegt werden. Bitte wähle für 2 Personen ein Super-Allround-Board oder Bigboard.`;
}

function normalizeBoardItem(item = {}) {
  const boardType = normalizeBoardType(item.boardType);
  const quantity = normalizeNumberOfBoards(item.quantity ?? item.numberOfBoards);
  const peoplePerBoard = normalizePeoplePerBoard(item.peoplePerBoard, boardType);
  const errors = [];

  if (boardType === null) {
    errors.push('Bitte wähle einen gültigen Board-Typ.');
  }

  if (quantity === null) {
    errors.push('Bitte gib eine gültige Anzahl an SUP-Boards ein.');
  }

  if (peoplePerBoard === null) {
    errors.push('Bitte wähle, ob 1 oder 2 Personen pro Board fahren.');
  }

  const occupancyError = getBoardOccupancyError(boardType, peoplePerBoard);
  if (occupancyError) {
    errors.push(occupancyError);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    item: {
      boardType,
      quantity,
      peoplePerBoard
    }
  };
}

function mergeBoardItems(boardItems) {
  const mergedItems = [];
  const itemByKey = new Map();

  boardItems.forEach(item => {
    const key = `${item.boardType}:${item.peoplePerBoard}`;
    const existing = itemByKey.get(key);

    if (existing) {
      existing.quantity += item.quantity;
      return;
    }

    const nextItem = { ...item };
    mergedItems.push(nextItem);
    itemByKey.set(key, nextItem);
  });

  return mergedItems;
}

function normalizeBoardItems(payload = {}) {
  const rawItems = Array.isArray(payload.boardItems)
    ? payload.boardItems
    : [{
        boardType: payload.boardType,
        quantity: payload.numberOfBoards,
        peoplePerBoard: payload.peoplePerBoard
      }];
  const errors = [];

  if (rawItems.length === 0) {
    errors.push('Bitte füge mindestens ein Board hinzu.');
  }

  if (rawItems.length > MAX_BOARD_ITEM_LINES) {
    errors.push(`Bitte nutze maximal ${MAX_BOARD_ITEM_LINES} verschiedene Board-Zeilen.`);
  }

  const normalizedItems = [];
  rawItems.slice(0, MAX_BOARD_ITEM_LINES).forEach((item, index) => {
    const result = normalizeBoardItem(item);
    if (!result.valid) {
      result.errors.forEach(error => {
        errors.push(rawItems.length > 1 ? `Board ${index + 1}: ${error}` : error);
      });
      return;
    }

    normalizedItems.push(result.item);
  });

  if (errors.length > 0) {
    return { valid: false, errors, boardItems: [] };
  }

  const boardItems = mergeBoardItems(normalizedItems);
  const totalBoards = boardItems.reduce((sum, item) => sum + item.quantity, 0);

  return {
    valid: true,
    errors: [],
    boardItems,
    totalBoards,
    primaryBoardItem: boardItems[0] || null
  };
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

function getPriceTier(duration, pricingSettings) {
  const settings = getEffectivePricingSettings(pricingSettings);
  const totalMinutes = durationToMinutes(duration);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    throw new TypeError('duration must be greater than zero');
  }

  if (totalMinutes > MAX_ONLINE_DURATION_MINUTES) {
    throw new TypeError('duration exceeds online booking limit');
  }

  return settings.priceTiers.find(({ maxMinutes }) => totalMinutes <= maxMinutes);
}

function calculateBoardItemPrice(item, tier, pricingSettings) {
  const basePricePerBoard = tier.pricePerBoard;
  const occupancySurchargePerBoard = item.peoplePerBoard === 2
    ? pricingSettings.twoPersonSurchargePerBoard
    : 0;
  const pricePerBoard = basePricePerBoard + occupancySurchargePerBoard;

  return {
    ...item,
    price: pricePerBoard * item.quantity,
    pricePerBoard,
    basePricePerBoard,
    occupancySurchargePerBoard
  };
}

function calculatePrice(duration, boardItemsOrNumberOfBoards, boardTypeValue = 'allround', peoplePerBoardValue, pricingSettingsValue) {
  const usesBoardItemsArray = Array.isArray(boardItemsOrNumberOfBoards);
  const pricingSettingsInput = usesBoardItemsArray && isPricingSettingsShape(boardTypeValue)
    ? boardTypeValue
    : (isPricingSettingsShape(peoplePerBoardValue) ? peoplePerBoardValue : pricingSettingsValue);
  const pricingSettings = getEffectivePricingSettings(pricingSettingsInput);
  const normalizedPeoplePerBoardValue = isPricingSettingsShape(peoplePerBoardValue)
    ? undefined
    : peoplePerBoardValue;
  const boardItemsResult = Array.isArray(boardItemsOrNumberOfBoards)
    ? normalizeBoardItems({ boardItems: boardItemsOrNumberOfBoards })
    : normalizeBoardItems({
        boardType: boardTypeValue,
        numberOfBoards: boardItemsOrNumberOfBoards,
        peoplePerBoard: normalizedPeoplePerBoardValue
      });

  if (!boardItemsResult.valid) {
    throw new TypeError(boardItemsResult.errors[0] || 'boardItems must be valid');
  }

  const tier = getPriceTier(duration, pricingSettings);
  const pricedBoardItems = boardItemsResult.boardItems.map(item => calculateBoardItemPrice(item, tier, pricingSettings));
  const uniquePricePerBoard = new Set(pricedBoardItems.map(item => item.pricePerBoard));
  const primaryBoardItem = pricedBoardItems[0] || {};

  return {
    price: pricedBoardItems.reduce((sum, item) => sum + item.price, 0),
    isDayRate: Boolean(tier.isDayRate),
    pricePerBoard: uniquePricePerBoard.size === 1 ? pricedBoardItems[0].pricePerBoard : 0,
    basePricePerBoard: tier.pricePerBoard,
    occupancySurchargePerBoard: uniquePricePerBoard.size === 1 ? pricedBoardItems[0].occupancySurchargePerBoard : 0,
    boardType: primaryBoardItem.boardType,
    numberOfBoards: boardItemsResult.totalBoards,
    peoplePerBoard: primaryBoardItem.peoplePerBoard,
    boardItems: pricedBoardItems
  };
}

function validateBookingTimeSelection(payload = {}) {
  const errors = [];
  const startTime = trimString(payload.startTime);
  const endTime = trimString(payload.endTime);
  const start = parseDateTime(startTime);
  const end = parseDateTime(endTime);
  const boardItemsResult = normalizeBoardItems(payload);

  if (!boardItemsResult.valid) {
    errors.push(...boardItemsResult.errors);
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
      errors.push('Online buchbar sind nur Zeiträume innerhalb der täglichen Öffnungszeiten.');
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
      boardItems: boardItemsResult.boardItems,
      boardType: boardItemsResult.primaryBoardItem.boardType,
      numberOfBoards: boardItemsResult.totalBoards,
      peoplePerBoard: boardItemsResult.primaryBoardItem.peoplePerBoard,
      duration: formatDuration(durationMinutes)
    }
  };
}

function validateBookingRequest(payload = {}) {
  const timeSelection = validateBookingTimeSelection(payload);
  const errors = [...timeSelection.errors];
  const name = trimString(payload.name);
  const phone = trimString(payload.phone);
  const paymentMethod = trimString(payload.paymentMethod) || 'stripe';

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
    errors.push('Bitte wähle eine gültige Zahlungsmethode.');
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
  BOARD_TYPES,
  DEFAULT_PRICING_SETTINGS,
  DEFAULT_PRICE_TIERS,
  TWO_PERSON_SURCHARGE_PER_BOARD,
  calculatePrice,
  cloneDefaultPricingSettings,
  getBoardOccupancyError,
  normalizeBoardType,
  normalizeBoardItems,
  normalizeNumberOfBoards,
  normalizePeoplePerBoard,
  normalizePricingSettings,
  validatePricingSettings,
  validateBookingRequest,
  validateBookingTimeSelection
};
