// Database connection and helper functions
// Supports both PostgreSQL (production) and JSON file (local development)

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const {
  cloneDefaultPricingSettings,
  normalizePricingSettings,
  validatePricingSettings
} = require('../lib/bookingRules');

let pool = null;
let usePostgreSQL = false;

function getBookingsFile() {
  return process.env.BOOKINGS_FILE
    ? path.resolve(process.env.BOOKINGS_FILE)
    : path.join(__dirname, '..', 'bookings.json');
}

function getPushSubscriptionsFile() {
  return process.env.PUSH_SUBSCRIPTIONS_FILE
    ? path.resolve(process.env.PUSH_SUBSCRIPTIONS_FILE)
    : path.join(__dirname, '..', 'push-subscriptions.json');
}

function getPricingSettingsFile() {
  return process.env.PRICING_SETTINGS_FILE
    ? path.resolve(process.env.PRICING_SETTINGS_FILE)
    : path.join(__dirname, '..', 'pricing-settings.json');
}

// Initialize database connection
async function initDatabase() {
  if (process.env.DATABASE_URL) {
    // Use PostgreSQL if DATABASE_URL is set (Railway, Render, etc.)
    usePostgreSQL = true;
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // Test connection
    try {
      await pool.query('SELECT NOW()');
      console.log('✅ Connected to PostgreSQL database');
      
      // Create tables if they don't exist
      await createTables();
      
      // Ensure notes column exists (run after table creation)
      await ensureNotesColumn();
      await ensureBoardTypeColumn();
      await ensurePeoplePerBoardColumn();
      await ensureBoardItemsColumn();
      await ensureCheckinNotifiedColumn();
      await ensureStripePaymentColumns();
      await ensurePricingSettingsTable();
    } catch (error) {
      console.error('❌ Database connection error:', error.message);
      usePostgreSQL = false;
      if (pool) {
        await pool.end().catch(() => {});
        pool = null;
      }
      throw error;
    }
  } else {
    // Use JSON file for local development
    console.log('📄 Using JSON file storage (local development)');
    usePostgreSQL = false;
  }
}

function getStorageMode() {
  return usePostgreSQL ? 'PostgreSQL' : 'JSON file';
}

// Create database tables
async function createTables() {
  if (!usePostgreSQL) return;
  
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  
  try {
    await pool.query(schema);
    console.log('✅ Database tables created/verified');
  } catch (error) {
    console.error('❌ Error creating tables:', error.message);
    throw error;
  }
}

// Ensure notes column exists (for existing databases)
async function ensureNotesColumn() {
  if (!usePostgreSQL) return;
  
  try {
    const checkColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='bookings' AND column_name='notes'
    `);
    
    if (checkColumn.rows.length === 0) {
      await pool.query('ALTER TABLE bookings ADD COLUMN notes TEXT');
      console.log('✅ Added notes column to existing bookings table');
    }
  } catch (error) {
    // Try alternative method
    try {
      await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT');
      console.log('✅ Notes column verified');
    } catch (err) {
      console.error('⚠️  Could not add notes column (may already exist):', err.message);
    }
  }
}

async function ensureBoardTypeColumn() {
  if (!usePostgreSQL) return;

  try {
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS board_type TEXT NOT NULL DEFAULT 'allround'");
    console.log('✅ Board type column verified');
  } catch (error) {
    console.error('⚠️  Could not add board_type column:', error.message);
  }
}

async function ensurePeoplePerBoardColumn() {
  if (!usePostgreSQL) return;

  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS people_per_board INTEGER NOT NULL DEFAULT 1');
    await pool.query("UPDATE bookings SET people_per_board = 2 WHERE board_type = 'partner'");
    console.log('✅ People per board column verified');
  } catch (error) {
    console.error('⚠️  Could not add people_per_board column:', error.message);
  }
}

async function ensureBoardItemsColumn() {
  if (!usePostgreSQL) return;

  try {
    await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS board_items JSONB NOT NULL DEFAULT '[]'::jsonb");
    await pool.query(`
      UPDATE bookings
      SET board_items = jsonb_build_array(
        jsonb_build_object(
          'boardType', board_type,
          'quantity', number_of_boards,
          'peoplePerBoard', people_per_board
        )
      )
      WHERE board_items = '[]'::jsonb
    `);
    console.log('✅ Board items column verified');
  } catch (error) {
    console.error('⚠️  Could not add board_items column:', error.message);
  }
}

async function ensureCheckinNotifiedColumn() {
  if (!usePostgreSQL) return;

  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_notified_at TIMESTAMP');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_checkin_notified_at ON bookings(checkin_notified_at)');
    console.log('✅ Checkin notification column verified');
  } catch (error) {
    console.error('⚠️  Could not add checkin_notified_at column:', error.message);
  }
}

async function ensureStripePaymentColumns() {
  if (!usePostgreSQL) return;

  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_status TEXT');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_synced_at TIMESTAMP');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_stripe_checkout_session_id ON bookings(stripe_checkout_session_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_stripe_payment_status ON bookings(stripe_payment_status)');
    console.log('✅ Stripe payment columns verified');
  } catch (error) {
    console.error('⚠️  Could not add Stripe payment columns:', error.message);
  }
}

async function ensurePricingSettingsTable() {
  if (!usePostgreSQL) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_settings (
        id TEXT PRIMARY KEY,
        settings JSONB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Pricing settings table verified');
  } catch (error) {
    console.error('⚠️  Could not verify pricing settings table:', error.message);
  }
}

function isValidPushSubscription(subscription) {
  return subscription &&
    typeof subscription === 'object' &&
    typeof subscription.endpoint === 'string' &&
    subscription.endpoint.length > 0 &&
    subscription.keys &&
    typeof subscription.keys.p256dh === 'string' &&
    typeof subscription.keys.auth === 'string';
}

function toPositiveInteger(value, fallback = 1) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function normalizeStoredBoardItem(item = {}, booking = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const boardType = item.boardType || item.board_type || booking.boardType || booking.board_type || 'allround';
  const quantity = toPositiveInteger(
    item.quantity || item.numberOfBoards || item.number_of_boards,
    toPositiveInteger(booking.numberOfBoards || booking.number_of_boards, 1)
  );
  const peoplePerBoard = toPositiveInteger(
    item.peoplePerBoard || item.people_per_board,
    toPositiveInteger(
      booking.peoplePerBoard || booking.people_per_board,
      boardType === 'partner' || boardType === 'bigboard' ? 2 : 1
    )
  );

  return {
    boardType,
    quantity,
    peoplePerBoard
  };
}

function buildLegacyBoardItems(booking = {}) {
  return [normalizeStoredBoardItem({}, booking)];
}

function normalizeStoredBoardItems(value, booking = {}) {
  let boardItems = value;

  if (typeof boardItems === 'string') {
    try {
      boardItems = JSON.parse(boardItems);
    } catch (error) {
      return buildLegacyBoardItems(booking);
    }
  }

  if (Array.isArray(boardItems) && boardItems.length > 0) {
    const normalizedItems = boardItems
      .map(item => normalizeStoredBoardItem(item, booking))
      .filter(Boolean);

    if (normalizedItems.length > 0) {
      return normalizedItems;
    }
  }

  return buildLegacyBoardItems(booking);
}

// Read bookings (works with both PostgreSQL and JSON)
async function readBookings() {
  if (usePostgreSQL) {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        phone,
        board_type as "boardType",
        number_of_boards as "numberOfBoards",
        people_per_board as "peoplePerBoard",
        board_items as "boardItems",
        to_char(start_time, 'YYYY-MM-DD"T"HH24:MI:SS') as "startTime",
        to_char(end_time, 'YYYY-MM-DD"T"HH24:MI:SS') as "endTime",
        duration_hours as "durationHours",
        duration_minutes as "durationMinutes",
        price,
        price_per_board as "pricePerBoard",
        is_day_rate as "isDayRate",
        payment_method as "paymentMethod",
        status,
        paypal_link as "paypalLink",
        paypal_amount as "paypalAmount",
        stripe_checkout_session_id as "stripeCheckoutSessionId",
        stripe_payment_intent_id as "stripePaymentIntentId",
        stripe_payment_status as "stripePaymentStatus",
        to_char(stripe_synced_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "stripeSyncedAt",
        payment_verified as "paymentVerified",
        to_char(verified_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "verifiedAt",
        notes,
        to_char(checkin_notified_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "checkinNotifiedAt",
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "createdAt"
      FROM bookings
      ORDER BY created_at DESC
    `);
    
    return result.rows.map(row => ({
      ...row,
      boardItems: normalizeStoredBoardItems(row.boardItems, row),
      duration: {
        hours: row.durationHours,
        minutes: row.durationMinutes
      }
    }));
  } else {
    // JSON file fallback
    const BOOKINGS_FILE = getBookingsFile();
    try {
      const data = await fs.readFile(BOOKINGS_FILE, 'utf8');
      return JSON.parse(data).map(booking => ({
        ...booking,
        boardItems: normalizeStoredBoardItems(booking.boardItems, booking)
      })).sort((a, b) => {
        const left = new Date(a.createdAt || 0).getTime();
        const right = new Date(b.createdAt || 0).getTime();
        return right - left;
      });
    } catch (error) {
      return [];
    }
  }
}

async function readPushSubscriptions() {
  if (usePostgreSQL) {
    const result = await pool.query(`
      SELECT subscription
      FROM push_subscriptions
      ORDER BY created_at DESC
    `);

    return result.rows
      .map(row => row.subscription)
      .filter(isValidPushSubscription);
  }

  const PUSH_SUBSCRIPTIONS_FILE = getPushSubscriptionsFile();
  try {
    const data = await fs.readFile(PUSH_SUBSCRIPTIONS_FILE, 'utf8');
    const subscriptions = JSON.parse(data);
    return Array.isArray(subscriptions)
      ? subscriptions.filter(isValidPushSubscription)
      : [];
  } catch (error) {
    return [];
  }
}

async function savePushSubscription(subscription) {
  if (!isValidPushSubscription(subscription)) {
    throw new Error('Invalid push subscription');
  }

  if (usePostgreSQL) {
    await pool.query(`
      INSERT INTO push_subscriptions (endpoint, subscription, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (endpoint)
      DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = CURRENT_TIMESTAMP
    `, [subscription.endpoint, JSON.stringify(subscription)]);
    return subscription;
  }

  const PUSH_SUBSCRIPTIONS_FILE = getPushSubscriptionsFile();
  const subscriptions = await readPushSubscriptions();
  const nextSubscriptions = [
    subscription,
    ...subscriptions.filter(item => item.endpoint !== subscription.endpoint)
  ];

  await fs.mkdir(path.dirname(PUSH_SUBSCRIPTIONS_FILE), { recursive: true });
  await fs.writeFile(PUSH_SUBSCRIPTIONS_FILE, JSON.stringify(nextSubscriptions, null, 2));
  return subscription;
}

async function deletePushSubscription(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    return false;
  }

  if (usePostgreSQL) {
    const result = await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    return result.rowCount > 0;
  }

  const PUSH_SUBSCRIPTIONS_FILE = getPushSubscriptionsFile();
  const subscriptions = await readPushSubscriptions();
  const nextSubscriptions = subscriptions.filter(item => item.endpoint !== endpoint);

  if (nextSubscriptions.length === subscriptions.length) {
    return false;
  }

  await fs.mkdir(path.dirname(PUSH_SUBSCRIPTIONS_FILE), { recursive: true });
  await fs.writeFile(PUSH_SUBSCRIPTIONS_FILE, JSON.stringify(nextSubscriptions, null, 2));
  return true;
}

function withPricingMetadata(settings, updatedAt = null) {
  return {
    ...settings,
    updatedAt
  };
}

async function readPricingSettings() {
  if (usePostgreSQL) {
    const result = await pool.query(`
      SELECT settings, updated_at as "updatedAt"
      FROM pricing_settings
      WHERE id = 'active'
    `);

    if (result.rows.length === 0) {
      return withPricingMetadata(cloneDefaultPricingSettings(), null);
    }

    try {
      return withPricingMetadata(
        normalizePricingSettings(result.rows[0].settings),
        result.rows[0].updatedAt
      );
    } catch (error) {
      console.error('⚠️  Stored pricing settings are invalid, using defaults:', error.message);
      return withPricingMetadata(cloneDefaultPricingSettings(), null);
    }
  }

  const PRICING_SETTINGS_FILE = getPricingSettingsFile();
  try {
    const data = await fs.readFile(PRICING_SETTINGS_FILE, 'utf8');
    const parsedSettings = JSON.parse(data);

    return withPricingMetadata(
      normalizePricingSettings(parsedSettings),
      parsedSettings.updatedAt || null
    );
  } catch (error) {
    return withPricingMetadata(cloneDefaultPricingSettings(), null);
  }
}

async function savePricingSettings(input) {
  const validation = validatePricingSettings(input, { requireComplete: true });
  if (!validation.valid) {
    const error = new Error(validation.errors[0] || 'Ungültige Preise');
    error.statusCode = 400;
    error.errors = validation.errors;
    throw error;
  }

  const updatedAt = new Date().toISOString();
  const settings = validation.settings;

  if (usePostgreSQL) {
    await pool.query(`
      INSERT INTO pricing_settings (id, settings, updated_at)
      VALUES ('active', $1, CURRENT_TIMESTAMP)
      ON CONFLICT (id)
      DO UPDATE SET settings = EXCLUDED.settings, updated_at = CURRENT_TIMESTAMP
    `, [JSON.stringify(settings)]);

    return readPricingSettings();
  }

  const PRICING_SETTINGS_FILE = getPricingSettingsFile();
  const persistedSettings = withPricingMetadata(settings, updatedAt);
  await fs.mkdir(path.dirname(PRICING_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(PRICING_SETTINGS_FILE, JSON.stringify(persistedSettings, null, 2));

  return persistedSettings;
}

// Save a booking (works with both PostgreSQL and JSON)
async function saveBooking(booking) {
  if (usePostgreSQL) {
    await pool.query(`
      INSERT INTO bookings (
        id, name, phone, board_type, number_of_boards, people_per_board, board_items, start_time, end_time,
        duration_hours, duration_minutes, price, price_per_board,
        is_day_rate, payment_method, status, paypal_link, paypal_amount,
        stripe_checkout_session_id, stripe_payment_intent_id, stripe_payment_status, stripe_synced_at,
        payment_verified, verified_at, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    `, [
      booking.id,
      booking.name,
      booking.phone,
      booking.boardType || 'allround',
      booking.numberOfBoards,
      booking.peoplePerBoard || 1,
      JSON.stringify(booking.boardItems || buildLegacyBoardItems(booking)),
      booking.startTime,
      booking.endTime,
      booking.duration.hours,
      booking.duration.minutes,
      booking.price,
      booking.pricePerBoard,
      booking.isDayRate || false,
      booking.paymentMethod,
      booking.status,
      booking.paypalLink || null,
      booking.paypalAmount || null,
      booking.stripeCheckoutSessionId || null,
      booking.stripePaymentIntentId || null,
      booking.stripePaymentStatus || null,
      booking.stripeSyncedAt || null,
      booking.paymentVerified || false,
      booking.verifiedAt || null,
      booking.notes || null,
      booking.createdAt
    ]);
  } else {
    // JSON file fallback
    const BOOKINGS_FILE = getBookingsFile();
    const bookings = await readBookings();
    const nextBookings = [...bookings, booking].sort((a, b) => {
      const left = new Date(a.createdAt || 0).getTime();
      const right = new Date(b.createdAt || 0).getTime();
      return right - left;
    });

    await fs.writeFile(BOOKINGS_FILE, JSON.stringify(nextBookings, null, 2));
  }
}

// Update a booking (for payment verification)
async function updateBooking(bookingId, updates) {
  if (usePostgreSQL) {
    const setClause = [];
    const values = [];
    let paramIndex = 1;
    
    if (updates.status !== undefined) {
      setClause.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.paymentVerified !== undefined) {
      setClause.push(`payment_verified = $${paramIndex++}`);
      values.push(updates.paymentVerified);
    }
    if (updates.verifiedAt !== undefined) {
      setClause.push(`verified_at = $${paramIndex++}`);
      values.push(updates.verifiedAt);
    }
    if (updates.notes !== undefined) {
      setClause.push(`notes = $${paramIndex++}`);
      values.push(updates.notes);
    }
    if (updates.checkinNotifiedAt !== undefined) {
      setClause.push(`checkin_notified_at = $${paramIndex++}`);
      values.push(updates.checkinNotifiedAt);
    }
    if (updates.stripeCheckoutSessionId !== undefined) {
      setClause.push(`stripe_checkout_session_id = $${paramIndex++}`);
      values.push(updates.stripeCheckoutSessionId);
    }
    if (updates.stripePaymentIntentId !== undefined) {
      setClause.push(`stripe_payment_intent_id = $${paramIndex++}`);
      values.push(updates.stripePaymentIntentId);
    }
    if (updates.stripePaymentStatus !== undefined) {
      setClause.push(`stripe_payment_status = $${paramIndex++}`);
      values.push(updates.stripePaymentStatus);
    }
    if (updates.stripeSyncedAt !== undefined) {
      setClause.push(`stripe_synced_at = $${paramIndex++}`);
      values.push(updates.stripeSyncedAt);
    }

    if (setClause.length === 0) {
      return;
    }
    
    values.push(bookingId);
    
    await pool.query(
      `UPDATE bookings SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  } else {
    // JSON file fallback
    const BOOKINGS_FILE = getBookingsFile();
    const bookings = await readBookings();
    const index = bookings.findIndex(b => b.id === bookingId);
    
    if (index !== -1) {
      bookings[index] = { ...bookings[index], ...updates };
      await fs.writeFile(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
    }
  }
}

async function deleteBooking(bookingId) {
  if (usePostgreSQL) {
    const result = await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
    return result.rowCount > 0;
  }

  const BOOKINGS_FILE = getBookingsFile();
  const bookings = await readBookings();
  const remainingBookings = bookings.filter(booking => booking.id !== bookingId);

  if (remainingBookings.length === bookings.length) {
    return false;
  }

  await fs.writeFile(BOOKINGS_FILE, JSON.stringify(remainingBookings, null, 2));
  return true;
}

// Find booking by ID
async function findBookingById(bookingId) {
  if (usePostgreSQL) {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        phone,
        board_type as "boardType",
        number_of_boards as "numberOfBoards",
        people_per_board as "peoplePerBoard",
        board_items as "boardItems",
        to_char(start_time, 'YYYY-MM-DD"T"HH24:MI:SS') as "startTime",
        to_char(end_time, 'YYYY-MM-DD"T"HH24:MI:SS') as "endTime",
        duration_hours as "durationHours",
        duration_minutes as "durationMinutes",
        price,
        price_per_board as "pricePerBoard",
        is_day_rate as "isDayRate",
        payment_method as "paymentMethod",
        status,
        paypal_link as "paypalLink",
        paypal_amount as "paypalAmount",
        stripe_checkout_session_id as "stripeCheckoutSessionId",
        stripe_payment_intent_id as "stripePaymentIntentId",
        stripe_payment_status as "stripePaymentStatus",
        to_char(stripe_synced_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "stripeSyncedAt",
        payment_verified as "paymentVerified",
        to_char(verified_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "verifiedAt",
        notes,
        to_char(checkin_notified_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "checkinNotifiedAt",
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as "createdAt"
      FROM bookings
      WHERE id = $1
    `, [bookingId]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      ...row,
      boardItems: normalizeStoredBoardItems(row.boardItems, row),
      duration: {
        hours: row.durationHours,
        minutes: row.durationMinutes
      }
    };
  } else {
    // JSON file fallback
    const bookings = await readBookings();
    return bookings.find(b => b.id === bookingId) || null;
  }
}

// Close database connection
async function closeDatabase() {
  if (pool) {
    await pool.end();
    console.log('Database connection closed');
  }
}

module.exports = {
  initDatabase,
  getStorageMode,
  readBookings,
  saveBooking,
  updateBooking,
  deleteBooking,
  findBookingById,
  readPricingSettings,
  savePricingSettings,
  readPushSubscriptions,
  savePushSubscription,
  deletePushSubscription,
  closeDatabase
};
