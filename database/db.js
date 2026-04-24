// Database connection and helper functions
// Supports both PostgreSQL (production) and JSON file (local development)

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

let pool = null;
let usePostgreSQL = false;

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

// Read bookings (works with both PostgreSQL and JSON)
async function readBookings() {
  if (usePostgreSQL) {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        phone,
        number_of_boards as "numberOfBoards",
        start_time as "startTime",
        end_time as "endTime",
        duration_hours as "durationHours",
        duration_minutes as "durationMinutes",
        price,
        price_per_board as "pricePerBoard",
        is_day_rate as "isDayRate",
        payment_method as "paymentMethod",
        status,
        paypal_link as "paypalLink",
        paypal_amount as "paypalAmount",
        payment_verified as "paymentVerified",
        verified_at as "verifiedAt",
        notes,
        created_at as "createdAt"
      FROM bookings
      ORDER BY created_at DESC
    `);
    
    return result.rows.map(row => ({
      ...row,
      duration: {
        hours: row.durationHours,
        minutes: row.durationMinutes
      }
    }));
  } else {
    // JSON file fallback
    const BOOKINGS_FILE = path.join(__dirname, '..', 'bookings.json');
    try {
      const data = await fs.readFile(BOOKINGS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }
}

// Save a booking (works with both PostgreSQL and JSON)
async function saveBooking(booking) {
  if (usePostgreSQL) {
    await pool.query(`
      INSERT INTO bookings (
        id, name, phone, number_of_boards, start_time, end_time,
        duration_hours, duration_minutes, price, price_per_board,
        is_day_rate, payment_method, status, paypal_link, paypal_amount,
        payment_verified, verified_at, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `, [
      booking.id,
      booking.name,
      booking.phone,
      booking.numberOfBoards,
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
      booking.paymentVerified || false,
      booking.verifiedAt || null,
      booking.notes || null,
      booking.createdAt
    ]);
  } else {
    // JSON file fallback
    const BOOKINGS_FILE = path.join(__dirname, '..', 'bookings.json');
    const bookings = await readBookings();
    bookings.push(booking);
    await fs.writeFile(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
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
    const BOOKINGS_FILE = path.join(__dirname, '..', 'bookings.json');
    const bookings = await readBookings();
    const index = bookings.findIndex(b => b.id === bookingId);
    
    if (index !== -1) {
      bookings[index] = { ...bookings[index], ...updates };
      await fs.writeFile(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
    }
  }
}

// Find booking by ID
async function findBookingById(bookingId) {
  if (usePostgreSQL) {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        phone,
        number_of_boards as "numberOfBoards",
        start_time as "startTime",
        end_time as "endTime",
        duration_hours as "durationHours",
        duration_minutes as "durationMinutes",
        price,
        price_per_board as "pricePerBoard",
        is_day_rate as "isDayRate",
        payment_method as "paymentMethod",
        status,
        paypal_link as "paypalLink",
        paypal_amount as "paypalAmount",
        payment_verified as "paymentVerified",
        verified_at as "verifiedAt",
        notes,
        created_at as "createdAt"
      FROM bookings
      WHERE id = $1
    `, [bookingId]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      ...row,
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
  readBookings,
  saveBooking,
  updateBooking,
  findBookingById,
  closeDatabase
};
