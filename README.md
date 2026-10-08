# College Turf Booking

A full web app for booking a college turf split into four playable sections. It gives students a clear slot schedule and gives the sports desk a shared record of all bookings.

## Features

- Four-section turf schedule for cricket and football
- Premium home page with login and signup
- File-backed user accounts with hashed passwords
- Password recovery emails with one-time links that expire after 15 minutes
- Three-hour slots at Rs. 600 by default
- Configurable price, duration, open hours, close hours, sports, and section names
- Shared Node API with file-backed storage in `data/store.json`
- Duplicate-slot protection so two players cannot book the same section and time
- Server-side validation for phone numbers, booking window, maintenance dates, sections, sports, and valid time slots
- Admin PIN gate for exports, cancellations, and rule changes
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

Create an account from the home page, then log in to enter the booking console.

### Configure Gmail password recovery

Password reset emails use Gmail SMTP. In `.env`, set `SMTP_USER` to the Gmail address
that will send messages and `SMTP_APP_PASSWORD` to a Google App Password for that
account (requires 2-Step Verification). Do not use your normal Gmail password or
commit `.env`. `APP_BASE_URL` should be the public URL users visit; it defaults to
`http://localhost:4173`. Restart the server after changing these settings. Until SMTP
credentials are configured, password recovery will report that email is unavailable
instead of implying that a message was sent.

## Change Rules

Use the settings button in the app to change the fee, slot duration, timings, sports, section names, booking window, active-booking limit, maintenance dates, or admin PIN. Default admin PIN is `1234`. New bookings keep the price that was active when they were created.
