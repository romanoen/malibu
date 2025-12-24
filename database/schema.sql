-- PostgreSQL Schema for SUP Rental Bookings

CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    number_of_boards INTEGER NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration_hours INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    price_per_board DECIMAL(10, 2) NOT NULL,
    is_day_rate BOOLEAN DEFAULT FALSE,
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    paypal_link TEXT,
    paypal_amount DECIMAL(10, 2),
    payment_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);

