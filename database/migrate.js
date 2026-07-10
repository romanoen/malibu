// Migration script: JSON file → PostgreSQL
// Run this once to migrate existing bookings.json to PostgreSQL

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const db = require('./db');

async function migrate() {
  try {
    console.log('🔄 Starting migration from JSON to PostgreSQL...\n');
    
    // Initialize database
    await db.initDatabase();
    
    // Read existing JSON file
    const BOOKINGS_FILE = path.join(__dirname, '..', 'bookings.json');
    let bookings = [];
    
    try {
      const data = await fs.readFile(BOOKINGS_FILE, 'utf8');
      bookings = JSON.parse(data);
      console.log(`📄 Found ${bookings.length} bookings in JSON file\n`);
    } catch (error) {
      console.log('⚠️  No bookings.json file found or empty. Nothing to migrate.\n');
      return;
    }
    
    if (bookings.length === 0) {
      console.log('✅ No bookings to migrate.\n');
      return;
    }
    
    // Migrate each booking
    let migrated = 0;
    let errors = 0;
    
    for (const booking of bookings) {
      try {
        // Check if booking already exists
        const existing = await db.findBookingById(booking.id);
        
        if (existing) {
          console.log(`⏭️  Skipping booking ${booking.id} (already exists)`);
          continue;
        }
        
        // Ensure booking has all required fields
        const bookingToSave = {
          id: booking.id,
          name: booking.name,
          phone: booking.phone,
          boardType: booking.boardType || booking.board_type || 'allround',
          numberOfBoards: booking.numberOfBoards || booking.number_of_boards,
          peoplePerBoard: booking.peoplePerBoard || booking.people_per_board || (booking.boardType === 'partner' || booking.board_type === 'partner' ? 2 : 1),
          startTime: booking.startTime,
          endTime: booking.endTime,
          duration: booking.duration || { hours: 0, minutes: 0 },
          price: booking.price,
          pricePerBoard: booking.pricePerBoard || booking.price_per_board || 0,
          isDayRate: booking.isDayRate || booking.is_day_rate || false,
          paymentMethod: booking.paymentMethod || booking.payment_method,
          status: booking.status || 'pending',
          paypalLink: booking.paypalLink || booking.paypal_link,
          paypalAmount: booking.paypalAmount || booking.paypal_amount,
          paymentVerified: booking.paymentVerified || booking.payment_verified || false,
          verifiedAt: booking.verifiedAt || booking.verified_at,
          notes: booking.notes,
          createdAt: booking.createdAt || booking.created_at || new Date().toISOString()
        };
        
        await db.saveBooking(bookingToSave);
        migrated++;
        console.log(`✅ Migrated booking ${booking.id} (${booking.name})`);
      } catch (error) {
        errors++;
        console.error(`❌ Error migrating booking ${booking.id}:`, error.message);
      }
    }
    
    console.log(`\n📊 Migration complete!`);
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📝 Total: ${bookings.length}\n`);
    
    // Close database connection
    await db.closeDatabase();
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate();
