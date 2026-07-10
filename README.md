# Malibu SUP Kressbronn

Mobile-first booking portal for SUP rentals with PayPal and cash payment workflows, an admin dashboard, and PostgreSQL support for production hosting.

## Features

- Public booking form with 15-minute time slots from 8:00 to 20:00
- Server-side booking validation and price calculation
- PayPal.me payment link support
- Cash payment flow with manual admin confirmation
- Admin dashboard with booking groups, notes, payment verification, and revenue stats
- Local JSON storage for development
- PostgreSQL storage when `DATABASE_URL` is configured

## Prices

- 90 min.: 15,00 EUR per board
- 2h: 20,00 EUR per board
- 3h: 30,00 EUR per board
- 1/2 day: 40,00 EUR per board
- Day ticket: 50,00 EUR per board
- 2-person surcharge: 5,00 EUR per board

Board categories: lightweight up to ca. 65 kg, allround women up to ca. 80 kg, super-allround up to ca. 120 kg, bigboards up to ca. 180 kg. Super-allround boards can be booked for 2 people; bigboards are for 2 adults only.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

For development with auto-reload:

```bash
npm run dev
```

## Environment

Create `.env` from `.env.example` and set at least:

```bash
PAYPAL_LINK=https://paypal.me/KlausOelfken
ADMIN_PASSWORD=dein_sicheres_passwort
```

Optional:

- `PORT=3000`
- `DATABASE_URL=postgres://...`
- `NODE_ENV=production`

In production, `ADMIN_PASSWORD` must be configured or admin login is disabled.

## Data Storage

Local development uses `bookings.json`, which is ignored by git and created automatically.

Production uses PostgreSQL when `DATABASE_URL` is present. To migrate local JSON bookings into PostgreSQL:

```bash
npm run migrate
```

## Tests

```bash
npm test
```

## Hosting

Railway and Render are both supported. See `HOSTING_GUIDE.md` and `RAILWAY_SETUP.md` for deployment steps.

Minimum production variables:

- `PAYPAL_LINK`
- `ADMIN_PASSWORD`
- `DATABASE_URL`
- `NODE_ENV=production`

## License

ISC
