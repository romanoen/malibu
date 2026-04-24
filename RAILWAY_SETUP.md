# Railway Setup mit PostgreSQL

## 🚀 Railway PostgreSQL - Schritt für Schritt

### 1. Railway Account erstellen
1. Gehe zu [railway.app](https://railway.app)
2. Erstelle einen Account (kostenlos mit GitHub)
3. Klicke auf "New Project"

### 2. Projekt deployen
1. Wähle "Deploy from GitHub repo"
2. Wähle dein Repository aus
3. Railway erkennt automatisch Node.js und startet das Deployment

### 3. PostgreSQL-Datenbank hinzufügen
1. Im Railway-Dashboard: Klicke auf "New" → "Database" → "Add PostgreSQL"
2. Railway erstellt automatisch eine PostgreSQL-Datenbank
3. Die `DATABASE_URL` wird automatisch als Environment-Variable gesetzt!

### 4. Environment-Variablen setzen
Im Railway-Dashboard → Variables:
- `PAYPAL_LINK=https://paypal.me/KlausOelfken`
- `ADMIN_PASSWORD=dein_sicheres_passwort`
- `NODE_ENV=production`
- `DATABASE_URL` ist bereits gesetzt (automatisch von Railway)

### 5. Code anpassen für PostgreSQL
Der Code muss angepasst werden, um PostgreSQL statt JSON zu nutzen.

---

## 📊 PostgreSQL vs JSON

### Aktuell (JSON):
```javascript
// bookings.json Datei
const bookings = await readBookings();
```

### Mit PostgreSQL:
```javascript
// PostgreSQL Datenbank
const bookings = await db.query('SELECT * FROM bookings');
```

**Vorteile:**
- ✅ Automatische Backups
- ✅ Bessere Performance
- ✅ Skalierbar
- ✅ Mehrere Server können zugreifen
- ✅ SQL-Abfragen möglich

---

## 🔧 Code-Anpassung nötig

Um PostgreSQL zu nutzen, muss der Code angepasst werden:

1. **Dependencies hinzufügen:**
   ```bash
   npm install pg
   ```

2. **Datenbank-Verbindung:**
   ```javascript
   const { Pool } = require('pg');
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL,
     ssl: { rejectUnauthorized: false }
   });
   ```

3. **Tabellen erstellen:**
   ```sql
   CREATE TABLE bookings (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     phone TEXT NOT NULL,
     ...
   );
   ```

4. **Code anpassen:**
   - `readBookings()` → SQL SELECT
   - `writeBookings()` → SQL INSERT/UPDATE

---

## 💰 Kosten

**Railway:**
- **Kostenlos:** $5 Credits/Monat (oft ausreichend für kleine Projekte)
- **Hobby Plan:** $5/Monat (mehr Credits)
- **Pro Plan:** $20/Monat (unbegrenzte Credits)

**PostgreSQL auf Railway:**
- **Kostenlos** im kostenlosen Plan (mit Limits)
- **$5/Monat** für mehr Storage/Performance

**Für dein Projekt:** Der kostenlose Plan reicht wahrscheinlich aus!

---

## 🎯 Nächste Schritte

1. **Railway Account erstellen** ✅
2. **Projekt deployen** ✅
3. **PostgreSQL hinzufügen** ✅
4. **Code für PostgreSQL anpassen** ⚠️ (braucht Hilfe)
5. **Environment-Variablen setzen** ✅
6. **Fertig!** 🎉

---

## ❓ Soll ich den Code für PostgreSQL anpassen?

Ich kann dir helfen:
- PostgreSQL-Connection einrichten
- Tabellen-Schema erstellen
- Code von JSON auf PostgreSQL migrieren
- Migration-Script für bestehende Daten

Sag einfach Bescheid! 🚀
