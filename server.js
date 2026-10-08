import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express(); const PORT = process.env.PORT || 4173;
const defaults = { settings: { price: 600, durationHours: 3, openHour: 6, closeHour: 21, sections: ['Section A', 'Section B', 'Section C', 'Section D'], sports: ['Cricket', 'Football'], bookingWindowDays: 14, maxActiveBookingsPerPhone: 2, adminPin: '1234', maintenanceDates: [] }, bookings: [], users: [] };
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const databaseUrl = process.env.FIREBASE_DATABASE_URL;
const hasServiceAccount = Boolean(databaseUrl && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey);
function publicRtdbRef(path = '') {
  const base = databaseUrl.replace(/\/$/, ''); const endpoint = `${base}/${path ? `${path}/` : ''}.json`;
  async function request(method, value) { const response = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) }); if (!response.ok) throw new Error(`RTDB REST request failed: ${response.status}`); return response.status === 204 ? null : response.json(); }
  return { once: async () => { const value = await request('GET'); return { val: () => value }; }, set: (value) => request('PUT', value), update: (value) => request('PATCH', value), remove: () => request('DELETE') };
}
let db;
if (hasServiceAccount) { admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }), databaseURL: databaseUrl }); db = admin.database(); }
else if (databaseUrl && process.env.FIREBASE_ALLOW_PUBLIC_REST === 'true') { db = { ref: publicRtdbRef }; console.warn('Using public RTDB REST demo mode. Add service-account credentials before production.'); }
else console.warn('Firebase credentials are missing; using data/store.json for app data.');
const smtpUser = process.env.SMTP_USER;
const smtpAppPassword = process.env.SMTP_APP_PASSWORD?.replace(/\s/g, '');
const smtpPort = Number(process.env.SMTP_PORT || 465);
const mailTransport = smtpUser && smtpAppPassword
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: smtpPort,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465,
      auth: { user: smtpUser, pass: smtpAppPassword },
    })
  : null;
app.use(express.json());
const list = (v) => Array.isArray(v) ? v : Object.values(v || {});
const normalizeBooking = (booking = {}) => ({
  ...booking,
  paymentMode: booking.paymentMode === 'UPI' ? 'Pay at venue' : (booking.paymentMode || 'Pay at venue'),
  paymentStatus: booking.paymentStatus === 'cancelled' ? 'refunded' : (booking.paymentStatus || 'unpaid'),
});
const normalizeStore = (store = {}) => ({
  settings: { ...defaults.settings, ...(store.settings || {}) },
  bookings: list(store.bookings || []).map(normalizeBooking),
  users: list(store.users || []),
});
const storePath = path.join(__dirname, 'data', 'store.json');
async function readFileStore() {
  try {
    return normalizeStore(JSON.parse(await fs.readFile(storePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeStore(defaults);
    throw error;
  }
}
async function readStore() {
  const fileStore = await readFileStore();
  if (!db) return fileStore;
  const [settings, bookings, users] = await Promise.all(['settings', 'bookings', 'users'].map((node) => db.ref(node).once('value')));
  const mergedUsers = new Map(fileStore.users.map((user) => [user.id, user]));
  for (const user of list(users.val() || [])) mergedUsers.set(user.id, user);
  return normalizeStore({
    settings: settings.val() || {},
    bookings: bookings.val() || [],
    users: [...mergedUsers.values()],
  });
}
const rainyPattern = (date, hour = 18) => { const d = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime() / 86400000, p = Math.max(8, Math.min(92, Math.round(36 + (Math.sin(d * .74) + Math.sin(d * .21)) * 25))); return { probability: p, risk: p >= 65 ? 'High' : p >= 35 ? 'Medium' : 'Low', source: 'demo forecast' }; };
async function weatherRisk(date, hour) { if (!process.env.OPENWEATHER_API_KEY) return rainyPattern(date, hour); try { const r = await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=Delhi,IN&appid=${process.env.OPENWEATHER_API_KEY}`), j = await r.json(), target = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime(), items = j.list || [], item = items.filter((x) => x.dt_txt?.startsWith(date)).sort((a, b) => Math.abs(new Date(a.dt_txt).getTime() - target) - Math.abs(new Date(b.dt_txt).getTime() - target))[0]; if (!item) return rainyPattern(date, hour); const p = Math.round((item.pop || 0) * 100); return { probability: p, risk: p >= 65 ? 'High' : p >= 35 ? 'Medium' : 'Low', source: 'OpenWeatherMap' }; } catch { return rainyPattern(date, hour); } }
function demandScore(bookings, date, hour, section, risk) { const target = new Date(`${date}T00:00:00`); const weighted = bookings.filter((b) => b.section === section && Number(b.startHour) === Number(hour) && new Date(`${b.date}T00:00:00`).getDay() === target.getDay() && !b.cancelledAt).reduce((n, b) => n + Math.max(.2, 1 - Math.max(0, (target - new Date(`${b.date}T00:00:00`)) / 86400000) / 220), 0); return Math.min(100, Math.round(weighted * 16 * (risk === 'High' ? .65 : risk === 'Medium' ? .82 : 1))); }
async function writeFileStore(store) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, storePath);
}
async function writeStore(store) {
  if (!db) return writeFileStore(store);
  await db.ref().update({ settings: store.settings, bookings: store.bookings, users: store.users });
}
async function writeUsers(users) {
  if (db) return db.ref('users').set(users);
  const store = await readFileStore();
  store.users = users;
  await writeFileStore(store);
}
let storeMutationQueue = Promise.resolve();
function withStoreLock(operation) {
  const result = storeMutationQueue.then(operation, operation);
  storeMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}
async function readHistoricalBookings() {
  if (!db) return [];
  return list((await db.ref('historicalBookings').once('value')).val());
}
const slots = (s) => { const out = []; for (let h = s.openHour; h + s.durationHours <= s.closeHour; h += s.durationHours) out.push(h); return out; };
const today = () => new Date().toISOString().slice(0, 10);
const hash = (p, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(p, salt, 64).toString('hex')}`;
const matches = (p, stored) => { const [salt, saved] = String(stored || '').split(':'); if (!salt || !saved) return false; const a = crypto.scryptSync(p, salt, 64); const b = Buffer.from(saved, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const normalizePhone = (value = '') => {
  const digits = String(value).replace(/\D/g, '').replace(/^0+/, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
};
const normalizeIdentifier = (value = '') => {
  const input = String(value).trim();
  if (!input) return '';
  return input.includes('@') ? normalizeEmail(input) : normalizePhone(input);
};
const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone, collegeId: u.collegeId || '', createdAt: u.createdAt });
const publicStore = (s) => ({ settings: s.settings, bookings: (s.bookings || []).map(normalizeBooking) });
const route = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

app.get('/api/store', route(async (_req, res) => res.json(publicStore(await readStore()))));
app.get('/api/weather-risk', route(async (req, res) => res.json(await weatherRisk(String(req.query.date || today()), Number(req.query.hour || 18)))));
app.get('/api/forecast', route(async (_req, res) => {
  const store = await readStore();
  const historical = await readHistoricalBookings();
  const data = [];
  for (let day = 0; day < 7; day += 1) {
    const dateValue = new Date();
    dateValue.setDate(dateValue.getDate() + day);
    const date = dateValue.toISOString().slice(0, 10);
    const risk = await weatherRisk(date, 18);
    const values = store.settings.sections.flatMap((section) =>
      slots(store.settings).map((hour) => demandScore([...historical, ...store.bookings], date, hour, section, risk.risk)),
    );
    data.push({
      date,
      label: dateValue.toLocaleDateString('en-IN', { weekday: 'short' }),
      demand: Math.round(values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)),
      risk: risk.risk,
    });
  }
  res.json(data);
}));
app.get('/api/price-suggestions', route(async (req, res) => {
  const store = await readStore();
  const date = String(req.query.date || today());
  const historical = await readHistoricalBookings();
  const all = [...historical, ...store.bookings];
  const result = {};
  for (const section of store.settings.sections) {
    const scores = [];
    for (const hour of slots(store.settings)) {
      const risk = await weatherRisk(date, hour);
      scores.push(demandScore(all, date, hour, section, risk.risk));
    }
    const demand = Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1));
    const multiplier = demand >= 70 ? 1.18 : demand <= 30 ? .9 : 1;
    result[section] = {
      demand,
      suggestedPrice: Math.round(store.settings.price * multiplier),
      recommendation: multiplier > 1 ? 'High demand' : multiplier < 1 ? 'Low demand' : 'Base price',
    };
  }
  res.json(result);
}));
app.post('/api/auth/signup', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    if (!name || !email || !phone || !password) return { status: 400, body: { message: 'Name, email, phone, and password are required.' } };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { message: 'Enter a valid email address.' } };
    if (!/^[6-9]\d{9}$/.test(phone)) return { status: 400, body: { message: 'Enter a valid 10-digit Indian phone number.' } };
    if (password.length < 6) return { status: 400, body: { message: 'Password must be at least 6 characters.' } };
    if (store.users.some((user) => normalizeEmail(user.email) === email || normalizePhone(user.phone) === phone)) {
      return { status: 409, body: { message: 'An account is already registered with this email or phone number.' } };
    }
    const user = {
      id: `USR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      name,
      email,
      phone,
      collegeId: String(req.body.collegeId || '').trim(),
      passwordHash: hash(password),
      createdAt: new Date().toISOString(),
    };
    const sessionToken = crypto.randomBytes(32).toString('hex');
    store.users.push(user);
    await writeUsers(store.users);
    return { status: 201, body: { user: publicUser(user), store: publicStore(store), sessionToken } };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/auth/login', route(async (req, res) => {
  const store = await readStore();
  const identifier = normalizeIdentifier(req.body.identifier);
  const user = store.users.find((record) => normalizeEmail(record.email) === identifier || normalizePhone(record.phone) === identifier);
  if (!user || !matches(String(req.body.password || ''), user.passwordHash)) {
    return res.status(401).json({ message: 'Incorrect email/phone or password. Please try again.' });
  }
  res.json({ user: publicUser(user), store: publicStore(store), sessionToken: crypto.randomBytes(32).toString('hex') });
}));
app.post('/api/auth/forgot-password', route(async (req, res) => {
  if (!mailTransport) {
    return res.status(503).json({
      message: 'Password email is not configured. Add SMTP_USER and SMTP_APP_PASSWORD to the server .env file.',
    });
  }
  const reset = await withStoreLock(async () => {
    const store = await readStore();
    const identifier = normalizeIdentifier(req.body.identifier);
    const user = store.users.find((record) => normalizeEmail(record.email) === identifier || normalizePhone(record.phone) === identifier);
    if (!user) return null;
    const token = crypto.randomBytes(24).toString('hex');
    user.passwordReset = { token, expiresAt: Date.now() + 15 * 60 * 1000, createdAt: new Date().toISOString() };
    await writeUsers(store.users);
    return { userId: user.id, email: user.email, token };
  });
  if (reset) {
    const baseUrl = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const resetLink = `${baseUrl}/?reset=${encodeURIComponent(reset.token)}`;
    try {
      await mailTransport.sendMail({
        from: { name: 'TurfCast', address: smtpUser },
        to: reset.email,
        subject: 'Reset your TurfCast password',
        text: `We received a request to reset your TurfCast password. This link expires in 15 minutes:\n\n${resetLink}\n\nIf you did not request a reset, you can ignore this email.`,
        html: `<p>We received a request to reset your TurfCast password.</p><p><a href="${resetLink}">Reset your password</a></p><p>This link expires in 15 minutes. If you did not request a reset, you can ignore this email.</p>`,
      });
    } catch (error) {
      console.error('Password reset email delivery failed:', error);
      await withStoreLock(async () => {
        const store = await readStore();
        const user = store.users.find((record) => record.id === reset.userId);
        if (user?.passwordReset?.token === reset.token) {
          delete user.passwordReset;
          await writeUsers(store.users);
        }
      });
      return res.status(502).json({ message: 'Could not send the password reset email. Check the Gmail SMTP configuration and try again.' });
    }
  }
  res.json({ message: 'If an account with that email or phone exists, a password reset email has been sent.' });
}));
app.post('/api/auth/reset-password', route(async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = store.users.find((record) => record.passwordReset?.token === token);
    if (!user || Date.now() >= Number(user.passwordReset.expiresAt)) return null;
    user.passwordHash = hash(password);
    delete user.passwordReset;
    await writeUsers(store.users);
    return true;
  });
  if (!result) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
  res.json({ message: 'Password reset. You can now log in.' });
}));
app.put('/api/settings', route(async (req, res) => {
  const store = await withStoreLock(async () => {
    const current = await readStore();
    const old = current.settings;
    current.settings = {
      ...old,
      ...req.body,
      price: Math.max(1, Number(req.body.price)),
      durationHours: Math.max(1, Number(req.body.durationHours)),
      openHour: Math.max(0, Math.min(23, Number(req.body.openHour))),
      closeHour: Math.max(1, Math.min(24, Number(req.body.closeHour))),
      sections: Array.isArray(req.body.sections) && req.body.sections.length ? req.body.sections : old.sections,
      sports: Array.isArray(req.body.sports) && req.body.sports.length ? req.body.sports : old.sports,
      bookingWindowDays: Math.max(1, Number(req.body.bookingWindowDays || old.bookingWindowDays)),
      maxActiveBookingsPerPhone: Math.max(1, Number(req.body.maxActiveBookingsPerPhone || old.maxActiveBookingsPerPhone)),
      adminPin: String(req.body.adminPin || old.adminPin),
      maintenanceDates: Array.isArray(req.body.maintenanceDates) ? req.body.maintenanceDates : old.maintenanceDates,
    };
    await writeStore(current);
    return publicStore(current);
  });
  res.json(store);
}));
app.post('/api/bookings', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const settings = store.settings;
    const booking = {
      ...req.body,
      id: req.body.id || `BK-${Date.now().toString(36).toUpperCase()}`,
      playerName: String(req.body.playerName || '').trim(),
      phone: String(req.body.phone || '').trim(),
      collegeId: String(req.body.collegeId || '').trim(),
      bookedBy: String(req.body.bookedBy || '').trim(),
      paymentMode: 'Pay at venue',
      paymentStatus: 'unpaid',
      price: Number(settings.price),
      startHour: Number(req.body.startHour),
      endHour: Number(req.body.startHour) + Number(settings.durationHours),
      teamSize: Number(req.body.teamSize || 1),
      createdAt: req.body.createdAt || new Date().toISOString(),
    };
    if (!booking.date || !booking.section || !booking.playerName || !booking.phone) {
      return { status: 400, body: { message: 'Missing booking details.' } };
    }
    if (!/^[6-9]\d{9}$/.test(booking.phone)) {
      return { status: 400, body: { message: 'Enter a valid 10-digit Indian phone number.' } };
    }
    if (!settings.sections.includes(booking.section) || !settings.sports.includes(booking.sport) || !slots(settings).includes(booking.startHour)) {
      return { status: 400, body: { message: 'Invalid booking details.' } };
    }
    if (settings.maintenanceDates.includes(booking.date)) {
      return { status: 400, body: { message: 'This date is blocked for maintenance.' } };
    }
    const last = new Date();
    last.setDate(last.getDate() + Number(settings.bookingWindowDays));
    if (booking.date < today() || booking.date > last.toISOString().slice(0, 10)) {
      return { status: 400, body: { message: `Bookings are allowed only within ${settings.bookingWindowDays} days.` } };
    }
    if (store.bookings.filter((item) => !item.cancelledAt && item.phone === booking.phone && item.date >= today()).length >= settings.maxActiveBookingsPerPhone) {
      return { status: 400, body: { message: `This phone already has ${settings.maxActiveBookingsPerPhone} active bookings.` } };
    }
    if (store.bookings.some((item) => !item.cancelledAt && item.date === booking.date && item.section === booking.section && Number(item.startHour) === booking.startHour)) {
      return { status: 409, body: { message: 'This slot is already booked.' } };
    }
    store.bookings.push(booking);
    await writeStore(store);
    return { status: 201, body: publicStore(store) };
  });
  res.status(result.status).json(result.body);
}));
app.put('/api/bookings/:id/payment', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const booking = store.bookings.find((item) => item.id === req.params.id);
    if (!booking || booking.cancelledAt) return { status: 404, body: { message: 'Active booking not found.' } };
    booking.paymentStatus = req.body.paymentStatus === 'paid' ? 'paid' : 'unpaid';
    booking.paymentMode = 'Pay at venue';
    await writeStore(store);
    return { status: 200, body: publicStore(store) };
  });
  res.status(result.status).json(result.body);
}));
app.delete('/api/bookings/:id', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const booking = store.bookings.find((item) => item.id === req.params.id);
    if (!booking) return { status: 404, body: { message: 'Booking not found.' } };
    booking.cancelledAt = new Date().toISOString();
    booking.paymentStatus = 'refunded';
    booking.paymentMode = 'Pay at venue';
    await writeStore(store);
    return { status: 200, body: publicStore(store) };
  });
  res.status(result.status).json(result.body);
}));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ message: 'Could not read or save app data. Check data/store.json permissions and server logs.' }); });
app.use(express.static(path.join(__dirname, 'dist'))); app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html'))); app.listen(PORT, () => console.log(`Turf booking app running at http://localhost:${PORT}`));
