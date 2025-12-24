-- Migration: Add notes column to bookings table
-- Run this if you have existing bookings and want to add notes support

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT;

