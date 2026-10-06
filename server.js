import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 4173;
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'store.json');

const defaultStore = {
  settings: {
    price: 600,
    durationHours: 3,
    openHour: 6,
    closeHour: 21,
    sections: ['Section A', 'Section B', 'Section C', 'Section D'],
    sports: ['Cricket', 'Football'],
    bookingWindowDays: 14,
    maxActiveBookingsPerPhone: 2,
    adminPin: '1234',
    maintenanceDates: [],
  },
  bookings: [],
  users: [],
};

app.use(express.json());

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, JSON.stringify(defaultStore, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(dataFile, 'utf8');
  const stored = JSON.parse(raw);
  return {
    settings: { ...defaultStore.settings, ...(stored.settings || {}) },
    bookings: Array.isArray(stored.bookings) ? stored.bookings : [],
    users: Array.isArray(stored.users) ? stored.users : [],
  };
}

async function writeStore(store) {
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2));
}

function isSlotBooked(bookings, nextBooking) {
  return bookings.some(
    (booking) =>
      booking.date === nextBooking.date &&
      booking.section === nextBooking.section &&
      Number(booking.startHour) === Number(nextBooking.startHour),
  );
}

function toDateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function dateInput(date) {
  return date.toISOString().slice(0, 10);
}

function isInsideBookingWindow(date, days) {
  const today = toDateOnly(dateInput(new Date()));
  const requested = toDateOnly(date);
  const latest = new Date(today);
  latest.setDate(latest.getDate() + Number(days));
  return requested >= today && requested <= latest;
}

function activeBookingsForPhone(bookings, phone) {
  const today = dateInput(new Date());
  return bookings.filter((booking) => booking.phone === phone && booking.date >= today);
}

function makeTimeSlots(settings) {
  const slots = [];
  for (let hour = settings.openHour; hour + settings.durationHours <= settings.closeHour; hour += settings.durationHours) {
    slots.push(hour);
  }
  return slots;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, savedHash) {
  const [salt, hash] = String(savedHash || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    collegeId: user.collegeId || '',
    createdAt: user.createdAt,
  };
}

function publicStore(store) {
  return {
    settings: store.settings,
    bookings: store.bookings,
  };
}

app.get('/api/store', async (_req, res) => {
  res.json(publicStore(await readStore()));
});

app.post('/api/auth/signup', async (req, res) => {
  const store = await readStore();
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const collegeId = String(req.body.collegeId || '').trim();
  const password = String(req.body.password || '');

  if (!name || !email || !phone || !password) {
    res.status(400).json({ message: 'Name, email, phone, and password are required.' });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ message: 'Enter a valid email address.' });
    return;
  }

  if (!/^[6-9]\d{9}$/.test(phone)) {
    res.status(400).json({ message: 'Enter a valid 10-digit Indian phone number.' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ message: 'Password must be at least 6 characters.' });
    return;
  }

  if (store.users.some((user) => user.email === email || user.phone === phone)) {
    res.status(409).json({ message: 'An account already exists with this email or phone.' });
    return;
  }

  const user = {
    id: `USR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    name,
    email,
    phone,
    collegeId,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  const nextStore = { ...store, users: [...store.users, user] };
  await writeStore(nextStore);
  res.status(201).json({ user: publicUser(user), store: publicStore(nextStore) });
});

app.post('/api/auth/login', async (req, res) => {
  const store = await readStore();
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = store.users.find((item) => item.email === identifier || item.phone === identifier);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ message: 'Invalid email, phone, or password.' });
    return;
  }

  res.json({ user: publicUser(user), store: publicStore(store) });
});

app.put('/api/settings', async (req, res) => {
  const store = await readStore();
  const settings = {
    ...store.settings,
    ...req.body,
    price: Math.max(1, Number(req.body.price)),
    durationHours: Math.max(1, Number(req.body.durationHours)),
    openHour: Math.max(0, Math.min(23, Number(req.body.openHour))),
    closeHour: Math.max(1, Math.min(24, Number(req.body.closeHour))),
    sections: Array.isArray(req.body.sections) && req.body.sections.length ? req.body.sections : store.settings.sections,
    sports: Array.isArray(req.body.sports) && req.body.sports.length ? req.body.sports : store.settings.sports,
    bookingWindowDays: Math.max(1, Number(req.body.bookingWindowDays || store.settings.bookingWindowDays)),
    maxActiveBookingsPerPhone: Math.max(1, Number(req.body.maxActiveBookingsPerPhone || store.settings.maxActiveBookingsPerPhone)),
    adminPin: String(req.body.adminPin || store.settings.adminPin || '1234'),
    maintenanceDates: Array.isArray(req.body.maintenanceDates) ? req.body.maintenanceDates : store.settings.maintenanceDates,
  };
  const nextStore = { ...store, settings };
  await writeStore(nextStore);
  res.json(publicStore(nextStore));
});

app.post('/api/bookings', async (req, res) => {
  const store = await readStore();
  const booking = {
    ...req.body,
    id: req.body.id || `BK-${Date.now().toString(36).toUpperCase()}`,
    playerName: String(req.body.playerName || '').trim(),
    phone: String(req.body.phone || '').trim(),
    collegeId: String(req.body.collegeId || '').trim(),
    bookedBy: String(req.body.bookedBy || '').trim(),
    paymentMode: String(req.body.paymentMode || 'Pending'),
    price: Number(store.settings.price),
    startHour: Number(req.body.startHour),
    endHour: Number(req.body.startHour) + Number(store.settings.durationHours),
    teamSize: Number(req.body.teamSize || 1),
    createdAt: req.body.createdAt || new Date().toISOString(),
  };

  if (!booking.date || !booking.section || !booking.playerName || !booking.phone) {
    res.status(400).json({ message: 'Missing booking details.' });
    return;
  }

  if (!/^[6-9]\d{9}$/.test(booking.phone)) {
    res.status(400).json({ message: 'Enter a valid 10-digit Indian phone number.' });
    return;
  }

  if (!store.settings.sections.includes(booking.section) || !store.settings.sports.includes(booking.sport)) {
    res.status(400).json({ message: 'Invalid section or sport.' });
    return;
  }

  if (!makeTimeSlots(store.settings).includes(booking.startHour)) {
    res.status(400).json({ message: 'Invalid time slot.' });
    return;
  }

  if (store.settings.maintenanceDates.includes(booking.date)) {
    res.status(400).json({ message: 'This date is blocked for maintenance.' });
    return;
  }

  if (!isInsideBookingWindow(booking.date, store.settings.bookingWindowDays)) {
    res.status(400).json({ message: `Bookings are allowed only within ${store.settings.bookingWindowDays} days.` });
    return;
  }

  if (activeBookingsForPhone(store.bookings, booking.phone).length >= store.settings.maxActiveBookingsPerPhone) {
    res.status(400).json({ message: `This phone already has ${store.settings.maxActiveBookingsPerPhone} active bookings.` });
    return;
  }

  if (isSlotBooked(store.bookings, booking)) {
    res.status(409).json({ message: 'This slot is already booked.' });
    return;
  }

  const nextStore = { ...store, bookings: [...store.bookings, booking] };
  await writeStore(nextStore);
  res.status(201).json(publicStore(nextStore));
});

app.delete('/api/bookings/:id', async (req, res) => {
  const store = await readStore();
  const nextStore = {
    ...store,
    bookings: store.bookings.filter((booking) => booking.id !== req.params.id),
  };
  await writeStore(nextStore);
  res.json(publicStore(nextStore));
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

await ensureStore();
app.listen(PORT, () => {
  console.log(`Turf booking app running at http://localhost:${PORT}`);
});
