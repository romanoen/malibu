require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
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
let httpServer = null;

app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

// Middleware
app.use(cors());
app.use(express.json({ limit: '20kb' }));
app.use(express.static('public'));

async function initializeApp() {
  try {
    await db.initDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
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
      boardType,
      numberOfBoards,
      startTime,
      endTime,
      paymentMethod,
      duration
    } = validation.booking;

    const priceResult = calculatePrice(duration, numberOfBoards, boardType);
    const price = priceResult.price;
    
    const booking = {
      id: crypto.randomUUID(),
      name,
      phone,
      boardType,
      numberOfBoards,
      startTime,
      endTime,
      duration,
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
      let paypalLink = process.env.PAYPAL_LINK || 'https://paypal.me/KlausOelfken';
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
        boardType: booking.boardType,
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

// Keep customer data behind admin auth; POST /api/bookings remains public.
app.get('/api/bookings', checkAdminSession, async (req, res) => {
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
    
    // Get all bookings in the period (both confirmed and unconfirmed)
    const allBookingsInPeriod = bookings.filter(b => {
      const bookingDate = new Date(b.createdAt);
      return bookingDate >= startDate;
    });
    
    // Get unconfirmed bookings (pending or payment_pending)
    const unconfirmedBookings = allBookingsInPeriod.filter(b => 
      b.status === 'pending' || b.status === 'payment_pending'
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

app.post('/api/calculate-price', (req, res) => {
  try {
    const validation = validateBookingTimeSelection(req.body);

    if (!validation.valid) {
      return res.status(400).json({
        error: validation.errors[0],
        errors: validation.errors
      });
    }

    const priceResult = calculatePrice(
      validation.booking.duration,
      validation.booking.numberOfBoards,
      validation.booking.boardType
    );
    
    res.json({ 
      price: priceResult.price,
      isDayRate: priceResult.isDayRate,
      pricePerBoard: priceResult.pricePerBoard,
      boardType: priceResult.boardType
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

async function startServer() {
  await initializeApp();

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
    console.log(`\n💾 Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON file (local)'}`);
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
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  await db.closeDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  await db.closeDatabase();
  process.exit(0);
});

module.exports = {
  app,
  initializeApp,
  startServer
};
