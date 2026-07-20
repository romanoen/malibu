# GitHub Setup - Schritt für Schritt

## ✅ Lokales Git-Repository ist bereits erstellt!

Das Projekt wurde bereits für Git vorbereitet:
- ✅ Git-Repository initialisiert
- ✅ Erster Commit erstellt
- ✅ .gitignore konfiguriert

## 🚀 Zu GitHub pushen

### Schritt 1: GitHub Repository erstellen

1. Gehe zu [github.com](https://github.com)
2. Klicke auf "New" oder "+" → "New repository"
3. Repository-Name eingeben (z.B. `malibu-sup-kressbronn`)
4. **WICHTIG:** Lass das Repository **LEER** (keine README, keine .gitignore, keine License)
5. Klicke auf "Create repository"

### Schritt 2: Lokales Repository mit GitHub verbinden

Führe diese Befehle im Terminal aus (im Projekt-Verzeichnis):

```bash
# GitHub Repository URL hinzufügen (ersetze USERNAME und REPO-NAME)
git remote add origin https://github.com/USERNAME/REPO-NAME.git

# Branch umbenennen zu main (falls nötig)
git branch -M main

# Code zu GitHub pushen
git push -u origin main
```

**Beispiel:**
```bash
git remote add origin https://github.com/romanoelfken/malibu-sup-kressbronn.git
git branch -M main
git push -u origin main
```

### Schritt 3: Railway mit GitHub verbinden

1. Gehe zu [railway.app](https://railway.app)
2. Klicke auf "New Project"
3. Wähle "Deploy from GitHub repo"
4. Autorisiere Railway, auf dein GitHub-Konto zuzugreifen
5. Wähle dein Repository aus
6. Railway startet automatisch das Deployment!

## 📝 Nächste Commits

Wenn du Änderungen machst:

```bash
# Änderungen hinzufügen
git add .

# Commit erstellen
git commit -m "Beschreibung der Änderungen"

# Zu GitHub pushen
git push
```

## 🔒 Wichtige Dateien, die NICHT zu GitHub gepusht werden

Diese Dateien sind in `.gitignore` und werden **NICHT** zu GitHub gepusht:
- `node_modules/` - Dependencies (werden auf Railway neu installiert)
- `bookings.json` - Lokale Buchungsdaten
- `.env` - Environment-Variablen (sollten in Railway gesetzt werden)

## ✅ Checkliste

- [ ] GitHub Repository erstellt
- [ ] Lokales Repository mit GitHub verbunden (`git remote add origin`)
- [ ] Code zu GitHub gepusht (`git push -u origin main`)
- [ ] Railway mit GitHub verbunden
- [ ] PostgreSQL-Datenbank in Railway hinzugefügt
- [ ] Environment-Variablen in Railway gesetzt:
  - [ ] `ADMIN_PASSWORD`
  - [ ] `STRIPE_SECRET_KEY`
  - [ ] `STRIPE_WEBHOOK_SECRET`
  - [ ] `PUBLIC_BASE_URL`
  - [ ] `DATABASE_URL` (automatisch von Railway)

## 🎉 Fertig!

Nach dem Push zu GitHub und dem Verbinden mit Railway:
- ✅ Code wird automatisch bei jedem Push deployed
- ✅ PostgreSQL-Datenbank ist eingerichtet
- ✅ Website ist live!
