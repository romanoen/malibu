# 🏄 Surfboard Verleih Website

Eine moderne, mobile-optimierte Website für den Surfboard-Verleih mit integriertem Buchungssystem und Zahlungsabwicklung.

## Features

- 📱 **Mobile-First Design**: Optimiert für alle Geräte
- 💳 **Zahlungsintegration**: Stripe für Kreditkartenzahlungen
- 💵 **Barzahlung**: Option für Barzahlung vor Ort
- ⏰ **Flexible Preise**: 
  - 1 Stunde: 15€
  - Jede weitere 15 Minuten: +5€
  - Tag (24h): 50€
- 📋 **Einfache Buchung**: Name, Telefon, Anzahl Boards, Start- und Endzeit

## Installation

1. **Abhängigkeiten installieren:**
   ```bash
   npm install
   ```

2. **PayPal Link konfigurieren:**
   
   Erstelle eine `.env` Datei und füge deinen PayPal Link ein:
   ```bash
   PAYPAL_LINK=https://paypal.me/deinname
   ```
   
   **PayPal Link Optionen:**
   - PayPal.me Link: `https://paypal.me/deinname` (einfachste Option)
   - PayPal Payment Button Link: Falls du einen PayPal Button erstellt hast
   
   **Hinweis:** Der PayPal Link wird automatisch mit dem Betrag erweitert (z.B. `paypal.me/deinname/50EUR`)

3. **Server starten:**
   ```bash
   npm start
   ```
   
   Oder für Entwicklung mit Auto-Reload:
   ```bash
   npm run dev
   ```

4. **Website öffnen:**
   Öffne `http://localhost:3000` im Browser

## PayPal Setup

1. Erstelle einen PayPal Account (falls noch nicht vorhanden)
2. Aktiviere PayPal.me auf [paypal.com](https://www.paypal.com/de/webapps/mpp/paypal-me)
3. Erhalte deinen persönlichen PayPal.me Link (z.B. `paypal.me/deinname`)
4. Setze den Link in der `.env` Datei als `PAYPAL_LINK`

## Datenbank

### Lokale Entwicklung
Alle Buchungen werden in `bookings.json` gespeichert. Diese Datei wird automatisch erstellt.

### Produktion mit PostgreSQL
Wenn `DATABASE_URL` gesetzt ist (z.B. bei Railway/Render), wird automatisch PostgreSQL verwendet.

**Migration bestehender Daten:**
```bash
npm run migrate
```

## Produktion / Hosting

### Railway (empfohlen)
1. Erstelle Account auf [railway.app](https://railway.app)
2. "New Project" → "Deploy from GitHub"
3. PostgreSQL-Datenbank hinzufügen ("New" → "Database" → "Add PostgreSQL")
4. Environment-Variablen setzen:
   - `PAYPAL_LINK=https://paypal.me/deinname`
   - `DATABASE_URL` wird automatisch gesetzt
5. Deploy!

### Render (Alternative)
1. Erstelle Account auf [render.com](https://render.com)
2. "New Web Service" → GitHub Repository verbinden
3. PostgreSQL-Datenbank hinzufügen
4. Environment-Variablen setzen
5. Deploy!

Siehe auch: `HOSTING_GUIDE.md` und `RAILWAY_SETUP.md` für detaillierte Anleitung.

## Lizenz

ISC

