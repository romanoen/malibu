-- PostgreSQL Schema for SUP Rental Bookings

CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    board_type TEXT NOT NULL DEFAULT 'allround',
    number_of_boards INTEGER NOT NULL,
    people_per_board INTEGER NOT NULL DEFAULT 1,
    board_items JSONB NOT NULL DEFAULT '[]'::jsonb,
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
    stripe_checkout_session_id TEXT,
    stripe_payment_intent_id TEXT,
    stripe_payment_status TEXT,
    stripe_synced_at TIMESTAMP,
    payment_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP,
    notes TEXT,
    checkin_notified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    subscription JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_created_at ON push_subscriptions(created_at);

CREATE TABLE IF NOT EXISTS pricing_settings (
    id TEXT PRIMARY KEY,
    settings JSONB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
