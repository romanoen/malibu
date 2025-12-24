require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Simple session storage (in production, use proper session store)
const sessions = new Map();

// Initialize database on startup
let dbInitialized = false;
async function initializeApp() {
  try {
    await db.initDatabase();
    dbInitialized = true;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    // Continue with JSON fallback
    dbInitialized = false;
  }
}

// Calculate price based on duration
function calculatePrice(duration, numberOfBoards) {
  const hours = duration.hours || 0;
  const minutes = duration.minutes || 0;
  const totalMinutes = hours * 60 + minutes;
  
  // Day rate: 50€ per board
  const dayRate = 50;
  
  // Day rate: 50€
  if (totalMinutes >= 24 * 60) {
    return {
      price: dayRate * numberOfBoards,
      isDayRate: true,
      pricePerBoard: dayRate
    };
  }
  
  // First hour: 15€
  let pricePerBoard = 15;
  let remainingMinutes = totalMinutes - 60;
  
  // Additional 15-minute intervals: 5€ each (every 15 minutes = 5€)
  if (remainingMinutes > 0) {
    const additionalIntervals = Math.ceil(remainingMinutes / 15);
    pricePerBoard += additionalIntervals * 5;
  }
  
  // If price per board exceeds day rate, use day rate instead
  if (pricePerBoard > dayRate) {
    return {
      price: dayRate * numberOfBoards,
      isDayRate: true,
      pricePerBoard: dayRate
    };
  }
  
  return {
    price: pricePerBoard * numberOfBoards,
    isDayRate: false,
    pricePerBoard: pricePerBoard
  };
}

// Serve Stripe publishable key
app.get('/api/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_your_key_here'
  });
});

// Validate booking time (8:00 - 20:00)
function validateBookingHours(dateTimeString) {
  const date = new Date(dateTimeString);
  const hour = date.getHours();
  return hour >= 8 && hour < 20;
}

// API Routes
app.post('/api/bookings', async (req, res) => {
  try {
    const { name, phone, numberOfBoards, startTime, endTime, paymentMethod } = req.body;
    
    // Validate booking hours (8:00 - 20:00)
    if (!validateBookingHours(startTime)) {
      return res.status(400).json({ 
        error: 'Buchungen sind nur zwischen 8:00 und 20:00 Uhr möglich.' 
      });
    }
    
    if (!validateBookingHours(endTime)) {
      return res.status(400).json({ 
        error: 'Buchungen sind nur zwischen 8:00 und 20:00 Uhr möglich.' 
      });
    }
    
    // Calculate duration
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end - start;
    const durationMinutes = Math.floor(durationMs / 60000);
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    
    const priceResult = calculatePrice({ hours, minutes }, numberOfBoards);
    const price = priceResult.price;
    
    const booking = {
      id: Date.now().toString(),
      name,
      phone,
      numberOfBoards,
      startTime,
      endTime,
      duration: { hours, minutes },
      price,
      pricePerBoard: priceResult.pricePerBoard,
      isDayRate: priceResult.isDayRate,
      paymentMethod,
      status: paymentMethod === 'cash' ? 'pending' : (paymentMethod === 'paypal' ? 'payment_pending' : 'pending'),
      createdAt: new Date().toISOString()
    };
    
    // For PayPal, generate payment link
    if (paymentMethod === 'paypal') {
      // Get PayPal link from env or use default
      let paypalLink = process.env.PAYPAL_LINK || 'https://paypal.me/romaniscool';
      // Ensure link starts with https://
      if (!paypalLink.startsWith('http://') && !paypalLink.startsWith('https://')) {
        paypalLink = 'https://' + paypalLink;
      }
      booking.paypalLink = paypalLink;
      booking.paypalAmount = price;
      booking.paymentVerified = false;
    }
    
    // Save booking
    await db.saveBooking(booking);
    
    res.json({
      success: true,
      booking: {
        id: booking.id,
        name: booking.name,
        price: booking.price,
        paymentMethod: booking.paymentMethod,
        status: booking.status,
        paypalLink: booking.paypalLink,
        paypalAmount: booking.paypalAmount,
        paymentVerified: booking.paymentVerified || false
      }
    });
  } catch (error) {
    console.error('Booking error:', error);
    res.status(500).json({ error: 'Failed to create booking', details: error.message });
  }
});

// Public bookings endpoint (for normal booking page - not used currently)
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await db.readBookings();
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Admin bookings endpoint (protected)
app.get('/api/admin/bookings', checkAdminSession, async (req, res) => {
  try {
    const bookings = await db.readBookings();
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password === adminPassword) {
      const sessionId = Date.now().toString() + Math.random().toString(36);
      sessions.set(sessionId, { loggedIn: true, expires: Date.now() + 24 * 60 * 60 * 1000 }); // 24 hours
      res.json({ success: true, sessionId });
    } else {
      res.status(401).json({ error: 'Falsches Passwort' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Login fehlgeschlagen' });
  }
});

// Check admin session
function checkAdminSession(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const session = sessions.get(sessionId);
  
  if (session && session.loggedIn && session.expires > Date.now()) {
    next();
  } else {
    res.status(401).json({ error: 'Nicht autorisiert' });
  }
}

// Get statistics
app.get('/api/admin/statistics', checkAdminSession, async (req, res) => {
  try {
    const { period } = req.query; // 'week', 'month', 'year'
    const bookings = await db.readBookings();
    
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate = new Date(0); // All time
    }
    
    const filteredBookings = bookings.filter(b => {
      const bookingDate = new Date(b.createdAt);
      return bookingDate >= startDate && b.status === 'confirmed';
    });
    
    const totalRevenue = filteredBookings.reduce((sum, b) => sum + parseFloat(b.price || 0), 0);
    const totalBookings = filteredBookings.length;
    
    res.json({
      totalRevenue: totalRevenue.toFixed(2),
      totalBookings,
      period
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

// Verify payment (PayPal or Cash)
app.post('/api/bookings/:id/verify', checkAdminSession, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await db.findBookingById(id);
    
    if (!booking) {
      return res.status(404).json({ error: 'Buchung nicht gefunden' });
    }
    
    await db.updateBooking(id, {
      status: 'confirmed',
      paymentVerified: true,
      verifiedAt: new Date().toISOString()
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
    
    await db.updateBooking(id, { notes });
    const updatedBooking = await db.findBookingById(id);
    res.json({ success: true, booking: updatedBooking });
  } catch (error) {
    console.error('Error updating notes:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Notizen' });
  }
});

app.post('/api/calculate-price', (req, res) => {
  try {
    const { startTime, endTime, numberOfBoards } = req.body;
    
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end - start;
    const durationMinutes = Math.floor(durationMs / 60000);
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    
    const priceResult = calculatePrice({ hours, minutes }, numberOfBoards);
    
    res.json({ 
      price: priceResult.price,
      isDayRate: priceResult.isDayRate,
      pricePerBoard: priceResult.pricePerBoard
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

// Start server
initializeApp().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
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
    console.log(`\n💾 Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON file (local)'}`);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await db.closeDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  await db.closeDatabase();
  process.exit(0);
});

