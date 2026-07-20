# Hosting & Datenspeicherung - Leitfaden

## 📊 Datenspeicherung - Optionen

### Option 1: JSON-Datei (aktuell) - Einfach, aber limitiert
**Vorteile:**
- ✅ Sehr einfach, keine zusätzliche Infrastruktur
- ✅ Funktioniert für kleine Mengen (< 1000 Buchungen)
- ✅ Keine Datenbank-Kosten

**Nachteile:**
- ❌ Nicht skalierbar bei vielen gleichzeitigen Schreibvorgängen
- ❌ Keine Backup-Automatisierung
- ❌ Risiko bei Server-Neustarts

**Für:** Kleine Projekte, < 100 Buchungen/Tag

---

### Option 2: SQLite Datenbank (empfohlen für Start)
**Vorteile:**
- ✅ Einfach zu implementieren (Datei-basiert wie JSON)
- ✅ Bessere Datenintegrität
- ✅ SQL-Abfragen möglich
- ✅ Keine separate Datenbank-Server nötig

**Implementierung:**
```bash
npm install better-sqlite3
```

**Für:** Kleine bis mittlere Projekte, < 500 Buchungen/Tag

---

### Option 3: PostgreSQL/MySQL (für Produktion)
**Vorteile:**
- ✅ Professionell und skalierbar
- ✅ Automatische Backups möglich
- ✅ Mehrere Server können zugreifen
- ✅ Bessere Performance

**Nachteile:**
- ❌ Zusätzliche Infrastruktur nötig
- ❌ Mehr Konfiguration

**Für:** Größere Projekte, > 500 Buchungen/Tag

---

### Option 4: Cloud-Datenbanken (einfachste Lösung)
**Optionen:**
- **Supabase** (PostgreSQL, kostenlos bis 500MB)
- **PlanetScale** (MySQL, kostenlos)
- **MongoDB Atlas** (MongoDB, kostenlos bis 512MB)

**Vorteile:**
- ✅ Keine Server-Verwaltung
- ✅ Automatische Backups
- ✅ Einfache Skalierung
- ✅ Oft kostenlos für kleine Projekte

**Für:** Alle Projekte, besonders wenn du keine Server verwalten willst

---

## 🚀 Hosting-Optionen

### Option 1: Railway (empfohlen - einfachste Lösung)
**Kosten:** ~$5-10/Monat, oder kostenlos mit Credits

**Vorteile:**
- ✅ Sehr einfach zu deployen (GitHub-Integration)
- ✅ Automatische HTTPS
- ✅ PostgreSQL-Datenbank inklusive
- ✅ Environment-Variablen einfach zu setzen
- ✅ Automatische Deployments bei Git-Push

**Schritte:**
1. Account auf railway.app erstellen
2. "New Project" → "Deploy from GitHub"
3. Repository auswählen
4. PostgreSQL-Datenbank hinzufügen
5. Environment-Variablen setzen (`ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`, etc.)
6. Fertig!

**URL:** `https://dein-projekt.up.railway.app`

---

### Option 2: Render (kostenlos für Start)
**Kosten:** Kostenlos (mit Einschränkungen), $7/Monat für bessere Performance

**Vorteile:**
- ✅ Kostenloser Plan verfügbar
- ✅ Automatische HTTPS
- ✅ PostgreSQL-Datenbank verfügbar
- ✅ Einfaches Deployment

**Schritte:**
1. Account auf render.com erstellen
2. "New Web Service"
3. GitHub-Repository verbinden
4. Build: `npm install`
5. Start: `npm start`
6. PostgreSQL-Datenbank hinzufügen

**URL:** `https://dein-projekt.onrender.com`

---

### Option 3: Vercel (nur Frontend) + Serverless Functions
**Kosten:** Kostenlos

**Vorteile:**
- ✅ Sehr schnell
- ✅ Automatische HTTPS
- ✅ Serverless (keine Server-Verwaltung)

**Nachteile:**
- ❌ Braucht Umstrukturierung für Backend
- ❌ Datenbank muss extern sein

**Für:** Wenn du Zeit für Umstrukturierung hast

---

### Option 4: DigitalOcean App Platform
**Kosten:** $5-12/Monat

**Vorteile:**
- ✅ Professionell
- ✅ PostgreSQL verfügbar
- ✅ Gute Performance

---

### Option 5: Heroku (nicht mehr kostenlos)
**Kosten:** $5-7/Monat

**Vorteile:**
- ✅ Sehr etabliert
- ✅ Viele Add-ons

**Nachteile:**
- ❌ Nicht mehr kostenlos

---

## 🔒 Admin-Seite Sicherheit

### Aktuelles Problem:
Die Admin-Seite ist öffentlich zugänglich! Jeder kann `/admin.html` aufrufen.

### Lösung 1: Passwort-Schutz (einfachste Lösung)
**Implementierung:** Basic Auth oder einfaches Login-Formular

**Vorteile:**
- ✅ Schnell implementiert
- ✅ Keine zusätzliche Infrastruktur

**Nachteile:**
- ❌ Nicht sehr sicher für sensible Daten

---

### Lösung 2: Environment-Variable basierter Schutz
**Implementierung:** 
- Admin-Seite nur mit Secret-Token zugänglich
- URL: `/admin.html?token=SECRET_TOKEN`

**Vorteile:**
- ✅ Einfach
- ✅ Keine Datenbank nötig

---

### Lösung 3: Session-basiertes Login (empfohlen)
**Implementierung:**
- Login-Seite mit Passwort
- Session-Cookies
- Passwort-Hash in Environment-Variable

**Vorteile:**
- ✅ Sicherer
- ✅ Professionell

---

## 📝 Empfohlene Lösung für dein Projekt

### Für den Start (einfachste Lösung):
1. **Hosting:** Railway oder Render
2. **Datenbank:** SQLite (Datei-basiert) oder PostgreSQL (wenn Railway/Render)
3. **Admin-Sicherheit:** Passwort-Schutz mit Environment-Variable

### Für Produktion (skalierbar):
1. **Hosting:** Railway oder Render
2. **Datenbank:** PostgreSQL (über Railway/Render)
3. **Admin-Sicherheit:** Session-basiertes Login

---

## 🛠️ Nächste Schritte

1. **Datenbank-Migration:** JSON → SQLite oder PostgreSQL
2. **Admin-Sicherheit:** Passwort-Schutz implementieren
3. **Environment-Variablen:** Für Produktion konfigurieren
4. **Deployment:** Auf Railway/Render deployen

Soll ich dir bei der Implementierung helfen?
