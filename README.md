# College Turf Booking

A full web app for booking a college turf split into four playable sections. It gives students a clear slot schedule and gives the sports desk a shared record of all bookings.

## Features

- Four-section turf schedule for cricket and football
- Separate student/customer and turf owner/admin account roles
- Student profile and owner profile fields persisted with the account
- Student view for slot discovery, booking, confirmation, and personal booking management
- Owner dashboard for all bookings, payment collection, revenue, occupancy, settings, and demand analytics
- File-backed user accounts with hashed passwords
- Password recovery emails with one-time links that expire after 15 minutes
- Three-hour slots at Rs. 600 by default
- Configurable price, duration, open hours, close hours, sports, and section names
- Shared Node API with file-backed storage in `data/store.json`
- Duplicate-slot protection so two players cannot book the same section and time
- Server-side validation for phone numbers, booking window, maintenance dates, sections, sports, and valid time slots
- Owner-only controls for exports, all-booking cancellation, payment updates, and turf settings
- Students can view and cancel only their own future bookings
- Fairness limit for active bookings per phone number
- Maintenance-date blocking
- Payment mode and college ID fields
- Printable booking receipts
- Searchable booking records
- Sport filter for booking records
- Booking cancellation
- CSV export
- Responsive premium UI with animated turf overview

## Run

```bash
npm install
npm run build
npm start
```

Open `http://localhost:4173`.

Create a student or turf owner account from the home page. Students can browse and book
the college turf; owners can manage bookings, pricing, turf settings, and business
analytics. Existing accounts without a stored role continue to be treated as students.
Sign in again after upgrading so the server can establish a role-checked session.

### Configure Firebase Realtime Database

Copy `.env.example` to `.env` and provide a Firebase service account's project ID,
client email, private key, and Realtime Database URL. With these credentials set,
the server persists account records, bookings, and settings in Firebase. If Firebase
is not configured, it uses `data/store.json`. Owner-managed slot price overrides are
persisted alongside those records.

To move an existing file-backed store into Firebase, run `npm run migrate:firebase`
after configuring the credentials. Public REST demo mode is available only when
`FIREBASE_ALLOW_PUBLIC_REST=true`; do not use it for production.

### Configure Gmail password recovery

Password reset emails use Gmail SMTP. In `.env`, set `SMTP_USER` to the Gmail address
that will send messages and `SMTP_APP_PASSWORD` to a Google App Password for that
account (requires 2-Step Verification). Do not use your normal Gmail password or
commit `.env`. `APP_BASE_URL` should be the public URL users visit; it defaults to
`http://localhost:4173`. Restart the server after changing these settings. Until SMTP
credentials are configured, password recovery will report that email is unavailable
instead of implying that a message was sent.

### Weather data

Set the turf city and state in Owner Settings to enable weather lookups. The backend
resolves that saved location with Open-Meteo Geocoding and uses Open-Meteo Forecast for
modelled current conditions, daily high/low temperatures, and hourly forecasts. No
weather API key is required. Resolved locations and successful forecasts are cached
in `data/weather-cache.json`; forecasts are refreshed after 15 minutes, with a
successful cache usable as stale data for up to three hours during provider outages.
The forecast request covers 16 calendar days, including today, which covers the
14-day booking window; dates outside the provider's returned range are explicitly
reported as unavailable.
The normalized response is available at `GET /api/weather?date=YYYY-MM-DD&hour=18`;
the existing `/api/weather-risk` and owner `/api/forecast` routes remain available.
IMD's documented JSON endpoints required credentials (HTTP 401 during verification),
so official IMD warnings are reported as unavailable rather than guessed. Weather
data does not change prices or bookings.

## Change Rules

Owners can use Turf Settings to change the base fee, slot duration, timings, sports,
section names, booking window, active-booking limit, and maintenance dates. New bookings
keep the price that was active when they were created. The Pricing page can set a
manual or promotional price for an upcoming date, section, and time slot; resetting
that slot restores the default price. Only authenticated owners can manage prices.
