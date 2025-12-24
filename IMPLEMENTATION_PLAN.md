# Implementierungsplan für Produktion

## Schritt 1: Admin-Seite absichern (PRIORITÄT!)

### Option A: Einfacher Passwort-Schutz (5 Minuten)
- Admin-Seite mit Passwort schützen
- Passwort in Environment-Variable speichern
- Einfaches Login-Formular

### Option B: Token-basierter Zugang (2 Minuten)
- Admin-Seite nur mit Secret-Token zugänglich
- URL: `/admin.html?token=DEIN_SECRET_TOKEN`

**Empfehlung:** Option B für schnellen Start, Option A für bessere Sicherheit

---

## Schritt 2: Datenbank-Migration

### Option A: Bei SQLite bleiben (einfachste Lösung)
- `better-sqlite3` installieren
- JSON-Datei in SQLite migrieren
- Code anpassen

### Option B: PostgreSQL verwenden (wenn Railway/Render)
- PostgreSQL-Datenbank erstellen
- Migration-Script schreiben
- Code anpassen

**Empfehlung:** Option A für Start, Option B wenn du Railway/Render nutzt

---

## Schritt 3: Hosting einrichten

### Railway (empfohlen)
1. Account erstellen
2. GitHub-Repository verbinden
3. PostgreSQL-Datenbank hinzufügen
4. Environment-Variablen setzen:
   - `PAYPAL_LINK=https://paypal.me/romaniscool`
   - `ADMIN_PASSWORD=dein_sicheres_passwort`
   - `DATABASE_URL` (automatisch von Railway)
5. Deploy!

### Render (Alternative)
1. Account erstellen
2. Web Service erstellen
3. PostgreSQL-Datenbank hinzufügen
4. Environment-Variablen setzen
5. Deploy!

---

## Schritt 4: Environment-Variablen für Produktion

Erstelle `.env.production` oder setze in Railway/Render:

```
PAYPAL_LINK=https://paypal.me/romaniscool
ADMIN_PASSWORD=dein_sicheres_passwort_123
PORT=3000
NODE_ENV=production
```

---

## Schritt 5: Domain einrichten (optional)

1. Domain kaufen (z.B. bei Namecheap, GoDaddy)
2. DNS-Einstellungen:
   - CNAME: `www` → `dein-projekt.up.railway.app`
   - A-Record: `@` → Railway IP
3. In Railway Custom Domain hinzufügen
4. SSL wird automatisch eingerichtet

---

## Schnellstart-Checkliste

- [ ] Admin-Seite absichern
- [ ] Datenbank-Migration (optional, JSON reicht für Start)
- [ ] Railway/Render Account erstellen
- [ ] Repository auf GitHub pushen
- [ ] Auf Railway/Render deployen
- [ ] Environment-Variablen setzen
- [ ] Testen!
- [ ] Domain einrichten (optional)

---

## Kosten-Übersicht

### Railway:
- **Kostenlos:** $5 Credits/Monat (oft ausreichend)
- **Paid:** $5-10/Monat für mehr Ressourcen

### Render:
- **Kostenlos:** Mit Einschränkungen (Server schläft nach Inaktivität)
- **Starter:** $7/Monat für 24/7 Betrieb

### Domain:
- **Kosten:** ~10-15€/Jahr (z.B. `malibu-sup-kressbronn.de`)

**Gesamt:** ~5-10€/Monat für professionelles Hosting

---

## Nächste Schritte

Sag mir, welche Optionen du bevorzugst, dann helfe ich dir bei der Implementierung!

1. **Admin-Sicherheit:** Option A (Login) oder B (Token)?
2. **Datenbank:** SQLite oder PostgreSQL?
3. **Hosting:** Railway oder Render?

