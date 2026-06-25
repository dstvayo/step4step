# Koordination — Smart Calendar & Task Management
**Version 1.0**

Eine moderne Web-App für Teamleiter zum Verwalten von Kalenderterminen, Aufgaben und Erinnerungen mit Sharing-Funktionen, personalisierten Nachrichten und Echtzeit-Synchronisierung.

---

## Features

### Kalender-Modul
- **3 Ansichten**: Tag, Woche, Monat
- CRUD für Termine mit allen Feldern (Titel, Zeiten, Ort, Kategorie, Farben)
- **Konflikterkennung** bei überschneidenden Terminen
- Dringlichkeitsstufen (Niedrig / Normal / Hoch / Kritisch)
- Nachrichtenart pro Termin (Termin, Meeting, Aufgabe, etc.)
- Erinnerungszeiten (5min / 15min / 30min / 1h / 1 Tag)
- Teilnehmer zuweisen

### Aufgaben-Modul
- **Kanban-Board** (Offen / In Arbeit / Erledigt)
- Subtasks / Checklisten
- Prioritäten (Niedrig / Mittel / Hoch) mit Farbcodes
- Teammitglieder zuweisen mit Empfangszeitstempel
- Verknüpfung zu Kalendertermin möglich
- Direktversand als personalisierte Nachricht

### Erinnerungs-System
- Zeitbasierte Erinnerungen (Cron-Job läuft jede Minute)
- **Eskalation** bei nicht erledigten Erinnerungen (alle 15 Min, max. 3x)
- WebSocket-Push an den Nutzer
- Verknüpfbar mit Events und Tasks

### Nachrichten & Sharing
- Personalisierte Nachrichten mit **automatischer persönlicher Anrede**
- Reaktionsmöglichkeiten per **Checkbox** (✅ ❌ 🔄 ⏰ ❓)
- Reaktionen werden per WebSocket an den Sender übertragen
- **Übersetzung** der Nachricht (DE, EN, FR, ES, AR, TR, ZH)
- WhatsApp-Link-Generierung für externe Zustellung
- E-Mail- und In-App-Kanäle
- Posteingang / Gesendet-Ansicht

### Teams / Gruppen
- Gruppen erstellen und verwalten
- Mitglieder hinzufügen/entfernen
- Rollen (Owner / Member)

### Echtzeit (WebSocket)
- Live-Updates bei Task-/Event-Änderungen
- Sofortige Benachrichtigung bei neuen Nachrichten
- Reaktionen in Echtzeit

---

## Tech-Stack

| Bereich | Technologie |
|---------|-------------|
| Frontend | Next.js 14, TypeScript, TailwindCSS, Zustand |
| Backend | NestJS, TypeScript |
| Datenbank | PostgreSQL + Prisma ORM |
| Realtime | Socket.io (WebSockets) |
| Auth | JWT + Passport.js |
| Jobs | @nestjs/schedule (Cron) |
| Container | Docker + Docker Compose |

---

## Schnellstart (mit Docker)

```bash
# Repository klonen
git clone https://github.com/dstvayo/step4step.git
cd step4step/Koordination

# Umgebungsvariablen kopieren
cp backend/.env.example backend/.env
# JWT_SECRET in backend/.env anpassen!

# Docker starten
docker compose up -d

# Datenbank initialisieren (beim ersten Start automatisch)
# API Docs: http://localhost:3001/api/docs
# Frontend: http://localhost:3000
```

---

## Manuelle Installation (ohne Docker)

### Voraussetzungen
- Node.js 20+
- PostgreSQL 16+

### Backend

```bash
cd backend

# Pakete installieren
npm install

# .env erstellen
cp .env.example .env
# DATABASE_URL und JWT_SECRET in .env setzen

# Prisma Client generieren + Datenbank migrieren
npx prisma migrate dev --name init
npx prisma generate

# Development starten
npm run start:dev

# Production Build
npm run build && npm run start
```

### Frontend

```bash
cd frontend

# Pakete installieren
npm install

# Umgebungsvariablen (optional)
# NEXT_PUBLIC_API_URL=http://localhost:3001/api
# NEXT_PUBLIC_WS_URL=http://localhost:3001

# Development starten
npm run dev

# Production Build
npm run build && npm run start
```

---

## API-Dokumentation

Nach dem Start erreichbar unter: **http://localhost:3001/api/docs**

### Endpoints

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| POST | `/api/auth/register` | Neues Konto |
| POST | `/api/auth/login` | Anmelden |
| GET | `/api/events` | Alle Termine |
| POST | `/api/events` | Termin erstellen |
| PATCH | `/api/events/:id` | Termin aktualisieren |
| DELETE | `/api/events/:id` | Termin löschen |
| GET | `/api/events/conflicts` | Konflikte prüfen |
| GET | `/api/tasks` | Alle Aufgaben |
| POST | `/api/tasks` | Aufgabe erstellen |
| PATCH | `/api/tasks/:id/status` | Status ändern |
| GET | `/api/reminders` | Alle Erinnerungen |
| POST | `/api/reminders` | Erinnerung erstellen |
| POST | `/api/sharing/send` | Nachricht senden |
| GET | `/api/sharing/sent` | Gesendete Nachrichten |
| GET | `/api/sharing/received` | Posteingang |
| POST | `/api/sharing/:id/react` | Reaktion senden |
| POST | `/api/sharing/:id/translate` | Übersetzen |
| GET | `/api/groups` | Alle Teams |
| POST | `/api/groups` | Team erstellen |

---

## WebSocket Events

```typescript
// Client → Server
socket.emit('join-group', groupId);
socket.emit('leave-group', groupId);

// Server → Client
socket.on('reminder', (data) => { /* Erinnerung */ });
socket.on('new-message', (data) => { /* Neue Nachricht */ });
socket.on('message-reaction', (data) => { /* Reaktion */ });
socket.on('event-updated', (event) => { /* Event geändert */ });
socket.on('task-updated', (task) => { /* Task geändert */ });
```

---

## Versionierung

Die Version wird in `frontend/next.config.js` als `NEXT_PUBLIC_VERSION` definiert und auf der Startseite und im Login-Screen angezeigt.

Bei jedem Update:
1. Version in `next.config.js` erhöhen (z.B. `1.0` → `1.1`)
2. Commit mit Versionsnummer erstellen

---

## Projektstruktur

```
Koordination/
├── backend/
│   ├── src/
│   │   ├── auth/           # JWT Authentifizierung
│   │   ├── events/         # Kalender-Termine
│   │   ├── tasks/          # Aufgaben & Subtasks
│   │   ├── reminders/      # Erinnerungen + Cron
│   │   ├── groups/         # Teams
│   │   ├── sharing/        # Nachrichten & Reaktionen
│   │   ├── notifications/  # WebSocket Gateway
│   │   ├── users/          # Nutzerverwaltung
│   │   └── prisma/         # DB Service
│   └── prisma/
│       └── schema.prisma   # Datenbankschema
├── frontend/
│   └── src/
│       ├── app/            # Next.js Pages
│       ├── components/     # React Components
│       ├── store/          # Zustand Store
│       ├── lib/            # API & Socket Client
│       └── types/          # TypeScript Types
└── docker-compose.yml
```

---

## Lizenz

MIT — Entwickelt für dstvayo/step4step
