require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Stripe = require('stripe');
const webpush = require('web-push');
const db = require('./database/db');
const {
  clearFailedLogins,
  createAdminSession,
  createClearedSessionCookie,
  createSessionCookie,
  destroyAdminSession,
  getAdminPassword,
  getAdminSession,
  getLoginThrottleState,
  registerFailedLogin,
  secureCompare
} = require('./lib/adminAuth');
const {
  calculatePrice,
  validateBookingRequest,
  validateBookingTimeSelection
} = require('./lib/bookingRules');

const app = express();
const PORT = process.env.PORT || 3000;
const CHECKIN_NOTIFICATION_POLL_MS = Number.parseInt(process.env.CHECKIN_NOTIFICATION_POLL_MS || '15000', 10);
const CHECKIN_NOTIFICATION_GRACE_MS = (Number.parseInt(process.env.CHECKIN_NOTIFICATION_GRACE_MINUTES || '15', 10)) * 60 * 1000;
const BOOKING_TIME_ZONE = process.env.BOOKING_TIME_ZONE || 'Europe/Berlin';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const DEFAULT_STRIPE_PAYMENT_METHOD_TYPES = ['card', 'paypal'];
const stripePaymentMethodTypes = parseStripePaymentMethodTypes(process.env.STRIPE_PAYMENT_METHOD_TYPES);
const configuredVapidKeys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  ? {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    }
  : null;
const vapidKeys = configuredVapidKeys || webpush.generateVAPIDKeys();
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:info@malibu-sup.local';
let httpServer = null;
let checkinNotificationInterval = null;
let isProcessingCheckinNotifications = false;

app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

if (!configuredVapidKeys && process.env.NODE_ENV !== 'test') {
  console.warn('⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set. Using temporary push keys for this server run.');
}

// Middleware
app.use(cors());
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
app.use(express.json({ limit: '20kb' }));
app.use(express.static('public'));

async function initializeApp() {
  try {
    await db.initDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

function formatRetryMessage(retryAfterSeconds) {
  const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Zu viele Login-Versuche. Bitte in ${retryAfterMinutes} Minute${retryAfterMinutes === 1 ? '' : 'n'} erneut versuchen.`;
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', createClearedSessionCookie());
}

function sendUnauthorized(res) {
  clearAdminCookie(res);
  return res.status(401).json({ error: 'Nicht autorisiert' });
}

function parseStripePaymentMethodTypes(value) {
  const configuredTypes = String(value || '')
    .split(',')
    .map(type => type.trim())
    .filter(Boolean);

  return configuredTypes.length > 0 ? configuredTypes : DEFAULT_STRIPE_PAYMENT_METHOD_TYPES;
}

function transliterateForPdf(value) {
  return String(value ?? '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/€/g, 'EUR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfText(value) {
  return transliterateForPdf(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function formatCurrency(amount) {
  return Number.parseFloat(amount || 0).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' EUR';
}

function formatPushCurrency(amount) {
  return Number.parseFloat(amount || 0).toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR'
  });
}

function formatPdfTime(value) {
  return formatBookingClockTime(value);
}

function parseBookingDateTimeParts(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds()
    };
  }

  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    return null;
  }

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
    second: Number.parseInt(match[6] || '0', 10)
  };
}

function getTimeZoneDateTimeParts(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BOOKING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((memo, part) => {
    if (part.type !== 'literal') {
      memo[part.type] = part.value;
    }
    return memo;
  }, {});
}

function formatPartsAsLocalDateTime(parts) {
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function createBookingTimestamp(date = new Date()) {
  return formatPartsAsLocalDateTime(getTimeZoneDateTimeParts(date));
}

function formatBookingDate(value, options = {}) {
  const parts = parseBookingDateTimeParts(value);
  if (!parts) {
    return '';
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleDateString('de-DE', {
    ...options,
    timeZone: 'UTC'
  });
}

function getBookingSortValue(value) {
  const parts = parseBookingDateTimeParts(value);
  if (!parts) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((memo, part) => {
    if (part.type !== 'literal') {
      memo[part.type] = Number.parseInt(part.value, 10);
    }
    return memo;
  }, {});

  const localTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return localTimeAsUtc - date.getTime();
}

function bookingDateTimeToEpochMs(value) {
  const parts = parseBookingDateTimeParts(value);
  if (!parts) {
    return null;
  }

  const localTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const firstOffset = getTimeZoneOffsetMs(new Date(localTimeAsUtc), BOOKING_TIME_ZONE);
  const firstGuess = localTimeAsUtc - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(firstGuess), BOOKING_TIME_ZONE);

  return localTimeAsUtc - secondOffset;
}

function formatBookingClockTime(value) {
  const parts = parseBookingDateTimeParts(value);
  if (!parts) {
    return '--:--';
  }

  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function formatBookingShortDate(value) {
  const parts = parseBookingDateTimeParts(value);
  if (!parts) {
    return '';
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
  });
}

function formatPushDateTimeRange(booking = {}) {
  const date = formatBookingShortDate(booking.startTime);
  const startTime = formatBookingClockTime(booking.startTime);
  const endTime = formatBookingClockTime(booking.endTime);

  return `${date}, ${startTime}-${endTime}`;
}

function getBookingStartMs(booking = {}) {
  return bookingDateTimeToEpochMs(booking.startTime);
}

function getBoardTypeLabel(boardType) {
  const labels = {
    lightweight: '1 Leichtgewicht',
    allround: '2 Allround Damen',
    super_allround: '3 Super-Allround',
    bigboard: '4 Bigboard',
    single: 'Singleboard',
    partner: 'Partnerboard'
  };

  return labels[boardType] || 'Board';
}

function getBookingBoardItems(booking = {}) {
  if (Array.isArray(booking.boardItems) && booking.boardItems.length > 0) {
    return booking.boardItems;
  }

  return [{
    boardType: booking.boardType,
    quantity: Number.parseInt(booking.numberOfBoards, 10) || 0,
    peoplePerBoard: Number.parseInt(booking.peoplePerBoard, 10) || (booking.boardType === 'partner' ? 2 : 1)
  }];
}

function formatBoardItems(booking = {}) {
  return getBookingBoardItems(booking).map(item => {
    const quantity = Number.parseInt(item.quantity || item.numberOfBoards, 10) || 0;
    const peoplePerBoard = Number.parseInt(item.peoplePerBoard, 10) || (item.boardType === 'partner' ? 2 : 1);
    return `${quantity}x ${getBoardTypeLabel(item.boardType)}, ${peoplePerBoard} Pers./Board`;
  }).join(' / ');
}

function createCheckinPushPayload(booking = {}) {
  const name = booking.name || 'Ohne Namen';
  const amount = formatPushCurrency(booking.price || 0);
  const timeRange = formatPushDateTimeRange(booking);
  const paymentLabel = getPaymentLabel(booking.paymentMethod);

  return {
    title: `Checkin: ${name}`,
    body: `${amount} · ${paymentLabel}\n${timeRange}`,
    tag: `checkin-${booking.id || Date.now()}`,
    url: '/admin.html',
    bookingId: booking.id
  };
}

function createTestPushPayload() {
  return {
    title: 'Malibu SUP Test',
    body: `Push-Benachrichtigung funktioniert. ${new Date().toLocaleTimeString('de-DE')}`,
    tag: `push-test-${Date.now()}`,
    url: '/admin.html'
  };
}

function shouldRemovePushSubscription(error) {
  return [400, 401, 403, 404, 410].includes(error?.statusCode);
}

async function sendPushPayload(payload) {
  if (process.env.NODE_ENV === 'test') {
    return {
      total: 0,
      sent: 0,
      removed: 0,
      failed: 0
    };
  }

  const subscriptions = await db.readPushSubscriptions();

  if (subscriptions.length === 0) {
    return {
      total: 0,
      sent: 0,
      removed: 0,
      failed: 0
    };
  }

  const message = JSON.stringify(payload);
  const results = await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification(subscription, message, {
        TTL: 60,
        urgency: 'high'
      });
      return 'sent';
    } catch (error) {
      if (shouldRemovePushSubscription(error)) {
        await db.deletePushSubscription(subscription.endpoint);
        return 'removed';
      }

      throw error;
    }
  }));

  const failedResults = results.filter(result => result.status === 'rejected');
  if (failedResults.length > 0) {
    console.error(`Push notification failed for ${failedResults.length} subscription(s)`);
    failedResults.forEach(result => {
      const reason = result.reason;
      console.error({
        message: reason?.message || String(reason),
        statusCode: reason?.statusCode,
        body: reason?.body
      });
    });
  }

  return {
    total: subscriptions.length,
    sent: results.filter(result => result.status === 'fulfilled' && result.value === 'sent').length,
    removed: results.filter(result => result.status === 'fulfilled' && result.value === 'removed').length,
    failed: failedResults.length
  };
}

function getPaymentLabel(paymentMethod) {
  if (paymentMethod === 'stripe') {
    return 'Stripe';
  }

  return paymentMethod === 'paypal' ? 'PayPal' : 'Barzahlung';
}

function getDefaultSchemeForBaseUrl(baseUrl, fallbackScheme = 'https') {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(baseUrl)
    ? 'http'
    : fallbackScheme;
}

function normalizePublicBaseUrl(value, fallbackScheme = 'https') {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return '';
  }

  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }

  const normalizedHost = baseUrl.replace(/^\/+/, '');
  const scheme = getDefaultSchemeForBaseUrl(normalizedHost, fallbackScheme);
  return `${scheme}://${normalizedHost}`;
}

function getRequestOrigin(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return normalizePublicBaseUrl(configuredBaseUrl);
  }

  return normalizePublicBaseUrl(`${req.protocol}://${req.get('host')}`, req.protocol || 'https');
}

function toStripeAmount(amount) {
  const cents = Math.round(Number.parseFloat(amount || 0) * 100);
  if (!Number.isInteger(cents) || cents < 50) {
    throw new Error('Invalid Stripe amount');
  }

  return cents;
}

function getStripeSessionBookingId(session = {}) {
  return session.client_reference_id || session.metadata?.bookingId || null;
}

function getStripePaymentIntentId(session = {}) {
  const paymentIntent = session.payment_intent;
  if (!paymentIntent) {
    return null;
  }

  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id || null;
}

function encodeStripeBoardItems(boardItems = []) {
  return boardItems
    .map(item => [
      item.boardType || 'allround',
      Number.parseInt(item.quantity, 10) || 1,
      Number.parseInt(item.peoplePerBoard, 10) || 1
    ].join(':'))
    .join(';');
}

function decodeStripeBoardItems(value) {
  return String(value || '')
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [boardType, quantity, peoplePerBoard] = item.split(':');
      return {
        boardType: boardType || 'allround',
        quantity: Number.parseInt(quantity, 10) || 1,
        peoplePerBoard: Number.parseInt(peoplePerBoard, 10) || 1
      };
    });
}

function createStripeBookingMetadata(booking = {}) {
  return {
    bookingId: String(booking.id || ''),
    bookingName: String(booking.name || ''),
    bookingPhone: String(booking.phone || ''),
    bookingStartTime: String(booking.startTime || ''),
    bookingEndTime: String(booking.endTime || ''),
    bookingBoardItems: encodeStripeBoardItems(booking.boardItems),
    bookingBoardType: String(booking.boardType || 'allround'),
    bookingNumberOfBoards: String(booking.numberOfBoards || 1),
    bookingPeoplePerBoard: String(booking.peoplePerBoard || 1),
    bookingDurationHours: String(booking.duration?.hours || 0),
    bookingDurationMinutes: String(booking.duration?.minutes || 0),
    bookingPrice: String(booking.price || 0),
    bookingPricePerBoard: String(booking.pricePerBoard || 0),
    bookingIsDayRate: booking.isDayRate ? 'true' : 'false'
  };
}

function formatBookingDateTimeParts(parts) {
  return [
    String(parts.year).padStart(4, '0'),
    '-',
    String(parts.month).padStart(2, '0'),
    '-',
    String(parts.day).padStart(2, '0'),
    'T',
    String(parts.hour).padStart(2, '0'),
    ':',
    String(parts.minute).padStart(2, '0'),
    ':',
    String(parts.second || 0).padStart(2, '0')
  ].join('');
}

function addMinutesToBookingDateTime(value, minutes) {
  const parts = parseBookingDateTimeParts(value);
  if (!parts) {
    return null;
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  date.setUTCMinutes(date.getUTCMinutes() + minutes);

  return formatBookingDateTimeParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  });
}

function getStripeSessionLineItemDescription(session = {}) {
  return session.line_items?.data?.[0]?.description || '';
}

function inferStripeEndTime(session = {}, startTime = '') {
  const startParts = parseBookingDateTimeParts(startTime);
  if (!startParts) {
    return null;
  }

  const description = getStripeSessionLineItemDescription(session);
  const timeRangeMatch = description.match(/(\d{2}:\d{2})-(\d{2}:\d{2})\s*Uhr/);
  if (!timeRangeMatch) {
    return addMinutesToBookingDateTime(startTime, 90);
  }

  const [hour, minute] = timeRangeMatch[2].split(':').map(Number);
  return formatBookingDateTimeParts({
    ...startParts,
    hour,
    minute,
    second: 0
  });
}

function getDurationBetweenBookingTimes(startTime, endTime) {
  const durationMinutes = Math.max(0, Math.round((getBookingSortValue(endTime) - getBookingSortValue(startTime)) / 60000));
  return {
    hours: Math.floor(durationMinutes / 60),
    minutes: durationMinutes % 60
  };
}

function createRecoveredBookingFromStripeSession(session = {}) {
  const metadata = session.metadata || {};
  const bookingId = getStripeSessionBookingId(session);
  const startTime = metadata.bookingStartTime || null;
  const endTime = metadata.bookingEndTime || inferStripeEndTime(session, startTime);

  if (!bookingId || !startTime || !endTime) {
    return null;
  }

  const duration = getDurationBetweenBookingTimes(startTime, endTime);
  const boardItems = decodeStripeBoardItems(metadata.bookingBoardItems);
  const numberOfBoards = Number.parseInt(metadata.bookingNumberOfBoards, 10) || boardItems.reduce((sum, item) => sum + item.quantity, 0) || 1;
  const peoplePerBoard = Number.parseInt(metadata.bookingPeoplePerBoard, 10) || boardItems[0]?.peoplePerBoard || 1;
  const paymentStatus = session.payment_status || 'unpaid';
  const isPaid = paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
  const now = createBookingTimestamp();

  return {
    id: bookingId,
    name: metadata.bookingName || 'Stripe Zahlung',
    phone: metadata.bookingPhone || '-',
    boardItems: boardItems.length > 0 ? boardItems : [{
      boardType: metadata.bookingBoardType || 'allround',
      quantity: numberOfBoards,
      peoplePerBoard
    }],
    boardType: metadata.bookingBoardType || boardItems[0]?.boardType || 'allround',
    numberOfBoards,
    peoplePerBoard,
    startTime,
    endTime,
    duration: {
      hours: Number.parseInt(metadata.bookingDurationHours, 10) || duration.hours,
      minutes: Number.parseInt(metadata.bookingDurationMinutes, 10) || duration.minutes
    },
    price: Number.parseFloat(metadata.bookingPrice || 0) || Number.parseFloat(session.amount_total || 0) / 100 || 0,
    pricePerBoard: Number.parseFloat(metadata.bookingPricePerBoard || 0) || 0,
    isDayRate: metadata.bookingIsDayRate === 'true',
    paymentMethod: 'stripe',
    status: isPaid ? 'confirmed' : 'payment_pending',
    paymentVerified: isPaid,
    verifiedAt: isPaid ? now : null,
    stripeCheckoutSessionId: session.id || null,
    stripePaymentIntentId: getStripePaymentIntentId(session),
    stripePaymentStatus: paymentStatus,
    stripeSyncedAt: now,
    createdAt: now
  };
}

async function findOrRecoverStripeBooking(session = {}) {
  const bookingId = getStripeSessionBookingId(session);
  if (!bookingId) {
    return null;
  }

  const existingBooking = await db.findBookingById(bookingId);
  if (existingBooking) {
    return existingBooking;
  }

  const recoveredBooking = createRecoveredBookingFromStripeSession(session);
  if (!recoveredBooking) {
    return null;
  }

  try {
    await db.saveBooking(recoveredBooking);
    console.warn('Recovered missing Stripe booking from checkout session metadata:', bookingId);
  } catch (error) {
    console.error('Could not recover missing Stripe booking:', {
      bookingId,
      message: error.message
    });
  }

  return db.findBookingById(bookingId);
}

function getPublicBookingErrorMessage(error = {}) {
  if (error.statusCode === 503) {
    return error.message;
  }

  if (error.type === 'StripeInvalidRequestError' && error.param === 'success_url') {
    return 'Stripe-Rücksprung-URL ist ungültig. Bitte PUBLIC_BASE_URL mit https:// setzen.';
  }

  if (error.type === 'StripeInvalidRequestError' && error.param === 'cancel_url') {
    return 'Stripe-Abbruch-URL ist ungültig. Bitte PUBLIC_BASE_URL mit https:// setzen.';
  }

  if (error.type === 'StripeInvalidRequestError') {
    return error.message || 'Stripe Checkout konnte nicht erstellt werden.';
  }

  return 'Failed to create booking';
}

function getStripePublicBooking(booking = {}) {
  return {
    id: booking.id,
    name: booking.name,
    phone: booking.phone,
    boardItems: booking.boardItems,
    boardType: booking.boardType,
    peoplePerBoard: booking.peoplePerBoard,
    startTime: booking.startTime,
    endTime: booking.endTime,
    duration: booking.duration,
    price: booking.price,
    paymentMethod: booking.paymentMethod,
    status: booking.status,
    paymentVerified: Boolean(booking.paymentVerified),
    verifiedAt: booking.verifiedAt || null,
    stripePaymentStatus: booking.stripePaymentStatus || null
  };
}

async function applyStripeSessionToBooking(session = {}, options = {}) {
  const bookingId = getStripeSessionBookingId(session);
  if (!bookingId) {
    return null;
  }

  const booking = await findOrRecoverStripeBooking(session);
  if (!booking) {
    return null;
  }

  const paymentStatus = session.payment_status || 'unpaid';
  const isPaid = paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
  const now = createBookingTimestamp();
  const updates = {
    stripeCheckoutSessionId: session.id || null,
    stripePaymentIntentId: getStripePaymentIntentId(session),
    stripePaymentStatus: paymentStatus,
    stripeSyncedAt: now
  };

  if (isPaid) {
    updates.status = 'confirmed';
    updates.paymentVerified = true;
    updates.verifiedAt = now;
  } else if (options.paymentFailed || session.status === 'expired') {
    updates.status = 'payment_failed';
  }

  await db.updateBooking(bookingId, updates);
  return db.findBookingById(bookingId);
}

async function createStripeCheckoutSession(req, booking) {
  if (!stripe) {
    const error = new Error('Stripe ist noch nicht konfiguriert.');
    error.statusCode = 503;
    throw error;
  }

  const origin = getRequestOrigin(req);
  const amountInCents = toStripeAmount(booking.price);
  const timeRange = `${formatBookingShortDate(booking.startTime)}, ${formatBookingClockTime(booking.startTime)}-${formatBookingClockTime(booking.endTime)} Uhr`;
  const boardSummary = formatBoardItems(booking);
  const metadata = createStripeBookingMetadata(booking);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'de',
    submit_type: 'pay',
    payment_method_types: stripePaymentMethodTypes,
    wallet_options: {
      link: {
        display: 'never'
      }
    },
    success_url: `${origin}/?stripe_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?payment_cancelled=1&booking_id=${encodeURIComponent(booking.id)}`,
    client_reference_id: booking.id,
    metadata,
    payment_intent_data: {
      metadata
    },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: amountInCents,
        product_data: {
          name: 'SUP Reservierung',
          description: `${timeRange} · ${boardSummary}`
        }
      }
    }]
  });

  if (!session.url) {
    throw new Error('Stripe Checkout konnte nicht gestartet werden.');
  }

  return session;
}

async function syncStripePaymentForBooking(booking = {}) {
  if (!stripe || booking.paymentMethod !== 'stripe' || booking.paymentVerified || !booking.stripeCheckoutSessionId) {
    return booking;
  }

  const session = await stripe.checkout.sessions.retrieve(booking.stripeCheckoutSessionId);
  return applyStripeSessionToBooking(session);
}

async function syncStripePaymentsForPendingBookings(bookings = []) {
  if (!stripe) {
    return bookings;
  }

  const stripePendingBookings = bookings.filter(booking => (
    booking.paymentMethod === 'stripe' &&
    !booking.paymentVerified &&
    booking.stripeCheckoutSessionId
  ));

  if (stripePendingBookings.length === 0) {
    return bookings;
  }

  let syncedAnyBooking = false;
  for (const booking of stripePendingBookings) {
    try {
      const syncedBooking = await syncStripePaymentForBooking(booking);
      syncedAnyBooking = syncedAnyBooking || Boolean(syncedBooking);
    } catch (error) {
      console.error('Stripe payment sync failed:', {
        bookingId: booking.id,
        message: error.message
      });
    }
  }

  return syncedAnyBooking ? db.readBookings() : bookings;
}

async function handleStripeWebhook(req, res) {
  if (!stripe || !stripeWebhookSecret) {
    return res.status(503).json({ error: 'Stripe Webhook ist nicht konfiguriert' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      stripeWebhookSecret
    );
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if ([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired'
    ].includes(event.type)) {
      await applyStripeSessionToBooking(event.data.object, {
        paymentFailed: event.type === 'checkout.session.async_payment_failed'
      });
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handling failed:', error);
    res.status(500).json({ error: 'Stripe Webhook konnte nicht verarbeitet werden' });
  }
}

function isCheckinNotificationDue(booking = {}, nowMs = Date.now()) {
  if (booking.checkinNotifiedAt) {
    return false;
  }

  const startMs = getBookingStartMs(booking);
  if (startMs === null) {
    return false;
  }

  return startMs <= nowMs && startMs >= nowMs - CHECKIN_NOTIFICATION_GRACE_MS;
}

async function processDueCheckinNotifications() {
  if (isProcessingCheckinNotifications) {
    return;
  }

  isProcessingCheckinNotifications = true;

  try {
    const nowMs = Date.now();
    const bookings = await db.readBookings();
    const dueBookings = bookings
      .filter(booking => isCheckinNotificationDue(booking, nowMs))
      .sort((left, right) => getBookingStartMs(left) - getBookingStartMs(right));

    for (const booking of dueBookings) {
      const result = await sendPushPayload(createCheckinPushPayload(booking));

      if (result.total === 0 || result.sent > 0 || result.removed > 0) {
        await db.updateBooking(booking.id, {
          checkinNotifiedAt: createBookingTimestamp()
        });
      }
    }
  } catch (error) {
    console.error('Error processing checkin push notifications:', error);
  } finally {
    isProcessingCheckinNotifications = false;
  }
}

function startCheckinNotificationScheduler() {
  if (process.env.NODE_ENV === 'test' || checkinNotificationInterval) {
    return;
  }

  setTimeout(() => {
    processDueCheckinNotifications().catch(error => {
      console.error('Error starting checkin push notifications:', error);
    });
  }, 1000);

  checkinNotificationInterval = setInterval(() => {
    processDueCheckinNotifications().catch(error => {
      console.error('Error running checkin push notifications:', error);
    });
  }, CHECKIN_NOTIFICATION_POLL_MS);
}

function stopCheckinNotificationScheduler() {
  if (!checkinNotificationInterval) {
    return;
  }

  clearInterval(checkinNotificationInterval);
  checkinNotificationInterval = null;
}

function wrapPdfText(text, maxLength = 92) {
  const words = transliterateForPdf(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach(word => {
    const nextLine = line ? `${line} ${word}` : word;
    if (nextLine.length > maxLength && line) {
      lines.push(line);
      line = word;
      return;
    }

    line = nextLine;
  });

  if (line) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : [''];
}

function buildPdfDocument(pages) {
  const objects = [];
  const addObject = content => {
    objects.push(content);
    return objects.length;
  };

  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject('');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const pageObjectIds = [];
  pages.forEach(pageContent => {
    const content = pageContent.join('\n');
    const contentObjectId = objects.length + 2;
    const pageObjectId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    addObject(`<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`);
    pageObjectIds.push(pageObjectId);
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'ascii');
}

function createRevenuePdf(bookings = []) {
  const pageWidth = 595;
  const margin = 42;
  const bottomMargin = 50;
  const pages = [];
  let commands = [];
  let y = 800;
  let pageNumber = 0;

  const addPage = () => {
    commands = [];
    pages.push(commands);
    pageNumber += 1;
    y = 800;

    commands.push('0.11 0.16 0.15 rg');
    commands.push(`BT /F2 16 Tf ${margin} ${y} Td (${escapePdfText('Malibu SUP Umsatzaufstellung')}) Tj ET`);
    commands.push('0.36 0.42 0.39 rg');
    commands.push(`BT /F1 9 Tf ${pageWidth - 120} ${y} Td (${escapePdfText(`Seite ${pageNumber}`)}) Tj ET`);
    y -= 22;
    commands.push('0.82 0.82 0.78 RG');
    commands.push(`${margin} ${y} m ${pageWidth - margin} ${y} l S`);
    y -= 24;
  };

  const ensureSpace = neededHeight => {
    if (y - neededHeight < bottomMargin) {
      addPage();
    }
  };

  const addText = (x, text, { size = 10, bold = false, color = '0.11 0.16 0.15' } = {}) => {
    commands.push(`${color} rg`);
    commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`);
  };

  const addWrappedText = (x, text, maxLength, options = {}) => {
    const lines = wrapPdfText(text, maxLength);
    lines.forEach(line => {
      ensureSpace(14);
      addText(x, line, options);
      y -= options.lineHeight || 13;
    });
  };

  const sortedBookings = [...bookings].sort((left, right) => getBookingSortValue(left.startTime) - getBookingSortValue(right.startTime));
  const totalRevenue = sortedBookings.reduce((sum, booking) => sum + Number.parseFloat(booking.price || 0), 0);

  addPage();
  addText(margin, `Erstellt am ${new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: BOOKING_TIME_ZONE
  }).format(new Date())}`, { size: 9, color: '0.36 0.42 0.39' });
  y -= 20;
  addText(margin, `Gesamtumsatz: ${formatCurrency(totalRevenue)}`, { size: 12, bold: true });
  y -= 16;
  addText(margin, `Buchungen: ${sortedBookings.length}`, { size: 10 });
  y -= 22;

  let currentMonth = '';
  sortedBookings.forEach(booking => {
    const monthLabel = formatBookingDate(booking.startTime, {
      year: 'numeric',
      month: 'long'
    });

    if (monthLabel !== currentMonth) {
      ensureSpace(34);
      currentMonth = monthLabel;
      y -= 6;
      addText(margin, monthLabel, { size: 12, bold: true });
      y -= 16;
      commands.push('0.82 0.82 0.78 RG');
      commands.push(`${margin} ${y} m ${pageWidth - margin} ${y} l S`);
      y -= 12;
    }

    ensureSpace(62);
    const timeRange = `${formatPdfTime(booking.startTime)}-${formatPdfTime(booking.endTime)}`;
    const bookingDate = formatBookingDate(booking.startTime);
    const amount = formatCurrency(booking.price);
    addText(margin, `${bookingDate}  ${timeRange}  ${booking.name || 'Ohne Namen'}`, { size: 10, bold: true });
    addText(pageWidth - 122, amount, { size: 10, bold: true });
    y -= 14;
    addWrappedText(margin + 12, `Boards: ${formatBoardItems(booking)}`, 95, { size: 9, color: '0.20 0.25 0.24' });
    addWrappedText(
      margin + 12,
      `Zahlung: ${getPaymentLabel(booking.paymentMethod)} | Telefon: ${booking.phone || '-'}`,
      95,
      { size: 9, color: '0.36 0.42 0.39' }
    );
    y -= 6;
  });

  if (sortedBookings.length === 0) {
    addText(margin, 'Keine Buchungen vorhanden.', { size: 11 });
  }

  return buildPdfDocument(pages);
}

function getPeriodStartDate(period) {
  const now = new Date();
  const startDate = new Date();

  switch (period) {
    case 'week':
      startDate.setDate(now.getDate() - 7);
      return startDate;
    case 'month':
      startDate.setMonth(now.getMonth() - 1);
      return startDate;
    case 'year':
      startDate.setFullYear(now.getFullYear() - 1);
      return startDate;
    default:
      return new Date(0);
  }
}

function filterBookingsByPeriod(bookings, period) {
  const startDate = getPeriodStartDate(period);

  return bookings.filter(booking => {
    const bookingDate = new Date(booking.createdAt);
    return bookingDate >= startDate;
  });
}

// API Routes
app.post('/api/bookings', async (req, res) => {
  try {
    const validation = validateBookingRequest(req.body);

    if (!validation.valid) {
      return res.status(400).json({
        error: validation.errors[0],
        errors: validation.errors
      });
    }

    const {
      name,
      phone,
      boardItems,
      startTime,
      endTime,
      paymentMethod,
      duration
    } = validation.booking;

    const pricingSettings = await db.readPricingSettings();
    const priceResult = calculatePrice(duration, boardItems, pricingSettings);
    const price = priceResult.price;
    
    const booking = {
      id: crypto.randomUUID(),
      name,
      phone,
      boardItems: priceResult.boardItems,
      boardType: priceResult.boardType,
      numberOfBoards: priceResult.numberOfBoards,
      peoplePerBoard: priceResult.peoplePerBoard,
      startTime,
      endTime,
      duration,
      price,
      pricePerBoard: priceResult.pricePerBoard,
      isDayRate: priceResult.isDayRate,
      paymentMethod,
      status: paymentMethod === 'cash' ? 'pending' : 'payment_pending',
      paymentVerified: false,
      createdAt: createBookingTimestamp()
    };
    
    // For PayPal, generate payment link
    if (paymentMethod === 'paypal') {
      // Get PayPal link from env or use default
      let paypalLink = process.env.PAYPAL_LINK || 'https://paypal.me/KlausOelfken';
      // Ensure link starts with https://
      if (!paypalLink.startsWith('http://') && !paypalLink.startsWith('https://')) {
        paypalLink = 'https://' + paypalLink;
      }
      booking.paypalLink = paypalLink;
      booking.paypalAmount = price;
      booking.paymentVerified = false;
    }

    await db.saveBooking(booking);

    if (paymentMethod === 'stripe') {
      try {
        const stripeSession = await createStripeCheckoutSession(req, booking);
        booking.stripeCheckoutSessionId = stripeSession.id;
        booking.stripePaymentIntentId = getStripePaymentIntentId(stripeSession);
        booking.stripePaymentStatus = stripeSession.payment_status || 'unpaid';
        booking.stripeSyncedAt = createBookingTimestamp();
        booking.stripeCheckoutUrl = stripeSession.url;

        await db.updateBooking(booking.id, {
          stripeCheckoutSessionId: booking.stripeCheckoutSessionId,
          stripePaymentIntentId: booking.stripePaymentIntentId,
          stripePaymentStatus: booking.stripePaymentStatus,
          stripeSyncedAt: booking.stripeSyncedAt
        });
      } catch (error) {
        await db.deleteBooking(booking.id).catch(deleteError => {
          console.error('Could not remove booking after Stripe checkout failure:', {
            bookingId: booking.id,
            message: deleteError.message
          });
        });
        throw error;
      }
    }
    
    res.json({
      success: true,
      booking: {
        id: booking.id,
        name: booking.name,
        boardItems: booking.boardItems,
        boardType: booking.boardType,
        peoplePerBoard: booking.peoplePerBoard,
        startTime: booking.startTime,
        endTime: booking.endTime,
        duration: booking.duration,
        price: booking.price,
        paymentMethod: booking.paymentMethod,
        status: booking.status,
        paypalLink: booking.paypalLink,
        paypalAmount: booking.paypalAmount,
        paymentVerified: booking.paymentVerified || false,
        stripeCheckoutSessionId: booking.stripeCheckoutSessionId || null,
        stripePaymentStatus: booking.stripePaymentStatus || null,
        stripeCheckoutUrl: booking.stripeCheckoutUrl || null
      }
    });
  } catch (error) {
    console.error('Booking error:', error);
    const statusCode = error.statusCode || 500;
    const errorMessage = getPublicBookingErrorMessage(error);
    res.status(statusCode).json({ error: errorMessage, details: error.message });
  }
});

app.get('/api/stripe/checkout-session/:sessionId', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe ist noch nicht konfiguriert.' });
    }

    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId.startsWith('cs_')) {
      return res.status(400).json({ error: 'Ungültige Stripe-Session.' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items']
    });
    const bookingId = getStripeSessionBookingId(session);
    if (!bookingId) {
      return res.status(404).json({ error: 'Buchung zur Stripe-Zahlung nicht gefunden.' });
    }

    let booking = await applyStripeSessionToBooking(session);
    if (!booking) {
      booking = await db.findBookingById(bookingId);
    }

    if (!booking || booking.stripeCheckoutSessionId !== session.id) {
      return res.status(404).json({ error: 'Buchung zur Stripe-Zahlung nicht gefunden.' });
    }

    res.json({
      success: true,
      paymentStatus: session.payment_status || 'unpaid',
      checkoutStatus: session.status || null,
      checkoutUrl: session.url || null,
      booking: getStripePublicBooking(booking)
    });
  } catch (error) {
    console.error('Error fetching Stripe checkout session:', error);
    res.status(500).json({ error: 'Stripe-Zahlung konnte nicht geprüft werden' });
  }
});

app.get('/api/pricing', async (req, res) => {
  try {
    const pricingSettings = await db.readPricingSettings();
    res.json(pricingSettings);
  } catch (error) {
    console.error('Error fetching pricing settings:', error);
    res.status(500).json({ error: 'Preise konnten nicht geladen werden' });
  }
});

// Keep customer data behind admin auth; POST /api/bookings remains public.
app.get('/api/bookings', checkAdminSession, async (req, res) => {
  try {
    let bookings = await db.readBookings();
    bookings = await syncStripePaymentsForPendingBookings(bookings);
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Admin bookings endpoint (protected)
app.get('/api/admin/bookings', checkAdminSession, async (req, res) => {
  try {
    let bookings = await db.readBookings();
    bookings = await syncStripePaymentsForPendingBookings(bookings);
    res.setHeader('X-Malibu-Storage', db.getStorageMode());
    res.setHeader('X-Malibu-Booking-Count', String(bookings.length));
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

app.get('/api/admin/push-public-key', checkAdminSession, (req, res) => {
  res.json({
    publicKey: vapidKeys.publicKey
  });
});

app.get('/api/admin/pricing', checkAdminSession, async (req, res) => {
  try {
    const pricingSettings = await db.readPricingSettings();
    res.json(pricingSettings);
  } catch (error) {
    console.error('Error fetching admin pricing settings:', error);
    res.status(500).json({ error: 'Preise konnten nicht geladen werden' });
  }
});

app.put('/api/admin/pricing', checkAdminSession, async (req, res) => {
  try {
    const pricingSettings = await db.savePricingSettings(req.body);
    res.json({
      success: true,
      pricing: pricingSettings
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Error saving pricing settings:', error);
    }

    res.status(statusCode).json({
      error: error.message || 'Preise konnten nicht gespeichert werden',
      errors: error.errors || undefined
    });
  }
});

app.post('/api/admin/push-subscriptions', checkAdminSession, async (req, res) => {
  try {
    const { subscription } = req.body || {};

    if (!subscription || typeof subscription.endpoint !== 'string') {
      return res.status(400).json({ error: 'Push-Subscription fehlt' });
    }

    await db.savePushSubscription(subscription);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    res.status(500).json({ error: 'Push-Benachrichtigung konnte nicht aktiviert werden' });
  }
});

app.delete('/api/admin/push-subscriptions', checkAdminSession, async (req, res) => {
  try {
    const { endpoint } = req.body || {};

    if (typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'Push-Endpoint fehlt' });
    }

    await db.deletePushSubscription(endpoint);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting push subscription:', error);
    res.status(500).json({ error: 'Push-Subscription konnte nicht entfernt werden' });
  }
});

app.post('/api/admin/push-test', checkAdminSession, async (req, res) => {
  try {
    const result = await sendPushPayload(createTestPushPayload());

    if (result.total === 0) {
      return res.status(400).json({
        error: 'Kein Gerät für Push-Benachrichtigungen registriert',
        ...result,
        temporaryKeys: !configuredVapidKeys
      });
    }

    if (result.sent === 0) {
      return res.status(502).json({
        error: 'Test-Push konnte nicht zugestellt werden',
        ...result,
        temporaryKeys: !configuredVapidKeys
      });
    }

    res.json({
      success: true,
      ...result,
      temporaryKeys: !configuredVapidKeys
    });
  } catch (error) {
    console.error('Error sending test push notification:', error);
    res.status(500).json({
      error: 'Test-Push konnte nicht gesendet werden',
      temporaryKeys: !configuredVapidKeys
    });
  }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const throttleState = getLoginThrottleState(req);
    if (!throttleState.allowed) {
      res.setHeader('Retry-After', String(throttleState.retryAfterSeconds));
      return res.status(429).json({
        error: formatRetryMessage(throttleState.retryAfterSeconds)
      });
    }

    const { password } = req.body;
    const adminPassword = getAdminPassword();

    if (!adminPassword) {
      return res.status(503).json({ error: 'Admin-Passwort ist nicht konfiguriert' });
    }

    if (secureCompare(password, adminPassword)) {
      clearFailedLogins(req);
      const sessionId = createAdminSession();
      res.setHeader('Set-Cookie', createSessionCookie(sessionId));
      return res.json({ success: true });
    }

    const failedState = registerFailedLogin(req);
    if (!failedState.allowed) {
      res.setHeader('Retry-After', String(failedState.retryAfterSeconds));
      return res.status(429).json({
        error: formatRetryMessage(failedState.retryAfterSeconds)
      });
    }

    res.status(401).json({ error: 'Falsches Passwort' });
  } catch (error) {
    res.status(500).json({ error: 'Login fehlgeschlagen' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  destroyAdminSession(req);
  clearAdminCookie(res);
  res.json({ success: true });
});

app.get('/api/admin/session', checkAdminSession, (req, res) => {
  res.json({ authenticated: true });
});

// Check admin session
function checkAdminSession(req, res, next) {
  const sessionState = getAdminSession(req);

  if (sessionState) {
    req.adminSession = sessionState.session;
    next();
    return;
  }

  sendUnauthorized(res);
}

// Get statistics
app.get('/api/admin/statistics', checkAdminSession, async (req, res) => {
  try {
    const { period } = req.query; // 'week', 'month', 'year'
    let bookings = await db.readBookings();
    bookings = await syncStripePaymentsForPendingBookings(bookings);
    const allBookingsInPeriod = filterBookingsByPeriod(bookings, period);
    
    // Get unconfirmed bookings (manual legacy payments or pending Stripe payments)
    const unconfirmedBookings = allBookingsInPeriod.filter(b => 
      b.status === 'pending' || b.status === 'payment_pending' || b.status === 'payment_failed'
    );
    
    // Calculate revenues
    const totalRevenue = allBookingsInPeriod.reduce((sum, b) => sum + parseFloat(b.price || 0), 0);
    const unconfirmedRevenue = unconfirmedBookings.reduce((sum, b) => sum + parseFloat(b.price || 0), 0);
    const totalBookings = allBookingsInPeriod.length;
    
    res.json({
      totalRevenue: totalRevenue.toFixed(2),
      unconfirmedRevenue: unconfirmedRevenue.toFixed(2),
      totalBookings,
      period
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

app.get('/api/admin/revenue-pdf', checkAdminSession, async (req, res) => {
  try {
    let bookings = await db.readBookings();
    bookings = await syncStripePaymentsForPendingBookings(bookings);
    const pdf = createRevenuePdf(filterBookingsByPeriod(bookings, 'year'));
    const fileDate = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="malibu-umsatzaufstellung-jahr-${fileDate}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (error) {
    console.error('Error creating revenue PDF:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Umsatzaufstellung' });
  }
});

app.get('/api/admin/database-export', checkAdminSession, async (req, res) => {
  try {
    let bookings = await db.readBookings();
    bookings = await syncStripePaymentsForPendingBookings(bookings);
    const exportedAt = new Date().toISOString();
    const fileDate = exportedAt.slice(0, 10);
    const pricingSettings = await db.readPricingSettings();
    const exportData = {
      exportedAt,
      storage: db.getStorageMode(),
      recordCounts: {
        bookings: bookings.length,
        pricingSettings: 1
      },
      pricingSettings,
      bookings
    };
    const json = JSON.stringify(exportData, null, 2);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="malibu-datenbank-export-${fileDate}.json"`);
    res.setHeader('Content-Length', Buffer.byteLength(json, 'utf8'));
    res.send(json);
  } catch (error) {
    console.error('Error exporting database:', error);
    res.status(500).json({ error: 'Fehler beim Exportieren der Datenbank' });
  }
});

// Manual verification for legacy cash/PayPal bookings.
app.post('/api/bookings/:id/verify', checkAdminSession, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await db.findBookingById(id);
    
    if (!booking) {
      return res.status(404).json({ error: 'Buchung nicht gefunden' });
    }

    if (booking.paymentMethod === 'stripe') {
      return res.status(409).json({ error: 'Stripe-Zahlungen werden automatisch geprüft.' });
    }
    
    await db.updateBooking(id, {
      status: 'confirmed',
      paymentVerified: true,
      verifiedAt: createBookingTimestamp()
    });
    
    const updatedBooking = await db.findBookingById(id);
    res.json({ success: true, booking: updatedBooking });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Update booking notes
app.post('/api/bookings/:id/notes', checkAdminSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (typeof notes !== 'string') {
      return res.status(400).json({ error: 'Notizen müssen Text sein' });
    }

    if (notes.length > 2000) {
      return res.status(400).json({ error: 'Notizen dürfen maximal 2000 Zeichen lang sein' });
    }

    const booking = await db.findBookingById(id);

    if (!booking) {
      return res.status(404).json({ error: 'Buchung nicht gefunden' });
    }
    
    await db.updateBooking(id, { notes });
    const updatedBooking = await db.findBookingById(id);
    res.json({ success: true, booking: updatedBooking });
  } catch (error) {
    console.error('Error updating notes:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Notizen' });
  }
});

app.delete('/api/bookings/:id', checkAdminSession, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await db.findBookingById(id);

    if (!booking) {
      return res.status(404).json({ error: 'Buchung nicht gefunden' });
    }

    const deleted = await db.deleteBooking(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Buchung nicht gefunden' });
    }

    res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Buchung' });
  }
});

app.post('/api/calculate-price', async (req, res) => {
  try {
    const validation = validateBookingTimeSelection(req.body);

    if (!validation.valid) {
      return res.status(400).json({
        error: validation.errors[0],
        errors: validation.errors
      });
    }

    const pricingSettings = await db.readPricingSettings();
    const priceResult = calculatePrice(
      validation.booking.duration,
      validation.booking.boardItems,
      pricingSettings
    );
    
    res.json({ 
      price: priceResult.price,
      isDayRate: priceResult.isDayRate,
      pricePerBoard: priceResult.pricePerBoard,
      basePricePerBoard: priceResult.basePricePerBoard,
      occupancySurchargePerBoard: priceResult.occupancySurchargePerBoard,
      boardItems: priceResult.boardItems,
      boardType: priceResult.boardType,
      numberOfBoards: priceResult.numberOfBoards,
      peoplePerBoard: priceResult.peoplePerBoard
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

async function startServer() {
  await initializeApp();
  startCheckinNotificationScheduler();

  httpServer = app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    let localIP = 'localhost';

    // Find local IP address
    for (const interfaceName in networkInterfaces) {
      const addresses = networkInterfaces[interfaceName];
      for (const address of addresses) {
        if (address.family === 'IPv4' && !address.internal) {
          localIP = address.address;
          break;
        }
      }
      if (localIP !== 'localhost') break;
    }

    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Network access: http://${localIP}:${PORT}`);
    console.log(`\n📱 To access from your phone:`);
    console.log(`   1. Make sure your phone is on the same WiFi network`);
    console.log(`   2. Open browser and go to: http://${localIP}:${PORT}`);
    console.log(`\n💾 Database: ${db.getStorageMode()}`);
  });

  return httpServer;
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  stopCheckinNotificationScheduler();
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  await db.closeDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  stopCheckinNotificationScheduler();
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  await db.closeDatabase();
  process.exit(0);
});

module.exports = {
  app,
  initializeApp,
  normalizePublicBaseUrl,
  parseStripePaymentMethodTypes,
  startServer
};
