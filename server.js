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
const defaults = { settings: { price: 600, durationHours: 3, openHour: 6, closeHour: 21, sections: ['Section A', 'Section B', 'Section C', 'Section D'], sports: ['Cricket', 'Football'], bookingWindowDays: 14, maxActiveBookingsPerPhone: 2, maintenanceDates: [] }, priceOverrides: [], bookings: [], users: [] };
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
const MAX_PRICE_INR = 100000;
const isValidPrice = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_PRICE_INR;
function normalizePriceOverrides(overrides, settings) {
  const activeOverrides = new Map();
  const normalized = list(overrides || []).flatMap((override) => {
    const date = String(override?.date || '');
    const section = String(override?.section || '');
    const startHour = Number(override?.startHour);
    if (
      !override ||
      typeof override.id !== 'string' ||
      !isValidDateValue(date) ||
      !settings.sections.includes(section) ||
      !Number.isSafeInteger(startHour) ||
      !slots(settings).includes(startHour) ||
      !isValidPrice(override.price) ||
      !['manual', 'promotion'].includes(override.type) ||
      typeof override.active !== 'boolean'
    ) return [];
    return [{
      id: override.id,
      date,
      section,
      startHour,
      price: override.price,
      type: override.type,
      active: override.active,
      createdAt: String(override.createdAt || ''),
      updatedAt: String(override.updatedAt || ''),
    }];
  });
  for (const override of normalized) {
    if (!override.active) continue;
    const key = `${override.date}|${override.section}|${override.startHour}`;
    const previous = activeOverrides.get(key);
    if (previous) previous.active = false;
    activeOverrides.set(key, override);
  }
  return normalized;
}
const normalizeBooking = (booking = {}) => ({
  ...booking,
  paymentMode: booking.paymentMode === 'UPI' ? 'Pay at venue' : (booking.paymentMode || 'Pay at venue'),
  paymentStatus: booking.paymentStatus === 'cancelled' ? 'refunded' : (booking.paymentStatus || 'unpaid'),
});
const rolesNeedMigration = Symbol('rolesNeedMigration');
function normalizeUserRoles(users) {
  let needsMigration = false;
  const normalizedUsers = list(users || []).map((user) => {
    const role = user.role === 'owner' ? 'owner' : 'student';
    if (role !== user.role) needsMigration = true;
    return { ...user, role };
  });
  return { users: normalizedUsers, needsMigration };
}
const normalizeStore = (store = {}, forceRoleMigration = false) => {
  const storedSettings = { ...(store.settings || {}) };
  const normalizedUsers = normalizeUserRoles(store.users);
  delete storedSettings.adminPin;
  const normalized = {
    settings: {
      ...defaults.settings,
      ...storedSettings,
      price: isValidPrice(storedSettings.price) ? storedSettings.price : defaults.settings.price,
    },
    priceOverrides: normalizePriceOverrides(store.priceOverrides, {
      ...defaults.settings,
      ...storedSettings,
    }),
    bookings: list(store.bookings || []).map(normalizeBooking),
    users: normalizedUsers.users,
  };
  Object.defineProperty(normalized, rolesNeedMigration, {
    value: forceRoleMigration || normalizedUsers.needsMigration,
  });
  return normalized;
};
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
  const [settings, priceOverrides, bookings, users] = await Promise.all(['settings', 'priceOverrides', 'bookings', 'users'].map((node) => db.ref(node).once('value')));
  const mergedUsers = new Map(fileStore.users.map((user) => [user.id, user]));
  const firebaseUsers = list(users.val() || []);
  for (const user of firebaseUsers) mergedUsers.set(user.id, user);
  return normalizeStore({
    settings: settings.val() || {},
    priceOverrides: priceOverrides.val() || [],
    bookings: bookings.val() || [],
    users: [...mergedUsers.values()],
  }, fileStore[rolesNeedMigration] || firebaseUsers.some((user) => !['student', 'owner'].includes(user.role)));
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
  await db.ref().update({ settings: store.settings, priceOverrides: store.priceOverrides, bookings: store.bookings, users: store.users });
}
async function writeUsers(users) {
  if (db) return db.ref('users').set(users);
  const store = await readFileStore();
  store.users = users;
  await writeFileStore(store);
}
async function persistRoleMigration(store) {
  if (store[rolesNeedMigration]) await writeUsers(store.users);
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
const sessionHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
function authenticatedUser(store, req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const tokenDigest = Buffer.from(sessionHash(token), 'hex');
  return store.users.find((user) => {
    const storedDigest = Buffer.from(String(user.sessionTokenHash || ''), 'hex');
    return storedDigest.length === tokenDigest.length && crypto.timingSafeEqual(storedDigest, tokenDigest);
  }) || null;
}
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const normalizePhone = (value = '') => {
  const digits = String(value).replace(/\D/g, '').replace(/^0+/, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
};
const constantTimeEquals = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
const normalizeIdentifier = (value = '') => {
  const input = String(value).trim();
  if (!input) return '';
  return input.includes('@') ? normalizeEmail(input) : normalizePhone(input);
};
const publicStoreForUser = (store, user) => ({
  ...publicStore(store),
  bookings: user?.role === 'owner'
    ? publicStore(store).bookings
    : publicStore(store).bookings.map((booking) => {
        const ownBooking = user && booking.bookedBy === user.id;
        if (ownBooking) return booking;
        return {
          id: booking.id,
          date: booking.date,
          section: booking.section,
          startHour: booking.startHour,
          endHour: booking.endHour,
          sport: booking.sport,
          price: booking.price,
          cancelledAt: booking.cancelledAt,
        };
      }),
});
const publicUser = (u) => u && ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role === 'owner' ? 'owner' : 'student',
  collegeId: u.collegeId || '',
  businessName: u.businessName || '',
  ownerTitle: u.ownerTitle || '',
  createdAt: u.createdAt,
});
const publicStore = (s) => ({
  settings: s.settings,
  bookings: (s.bookings || []).map(normalizeBooking),
  priceOverrides: s.priceOverrides || [],
});
function configuredAppUrl() {
  const configuredUrl = String(process.env.APP_BASE_URL || '').trim();
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!isLocalHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
function bookingStartTimestamp(date, hour) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day, Number(hour)) - 330 * 60 * 1000;
}
function isValidDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const route = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

app.get('/api/store', route(async (req, res) => {
  const store = await readStore();
  res.json(publicStoreForUser(store, authenticatedUser(store, req)));
}));
app.get('/api/weather-risk', route(async (req, res) => res.json(await weatherRisk(String(req.query.date || today()), Number(req.query.hour || 18)))));
app.get('/api/forecast', route(async (req, res) => {
  const store = await readStore();
  if (authenticatedUser(store, req)?.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access is required to view the forecast.' });
  }
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
  if (authenticatedUser(store, req)?.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access is required to view pricing suggestions.' });
  }
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
    const requestedRole = String(req.body.role || 'student');
    if (!name || !email || !phone || !password) return { status: 400, body: { message: 'Name, email, phone, and password are required.' } };
    if (!['student', 'owner'].includes(requestedRole)) return { status: 400, body: { message: 'Choose student or owner account type.' } };
    const ownerSignupCode = String(process.env.OWNER_SIGNUP_CODE || '');
    if (requestedRole === 'owner' && (!ownerSignupCode || !constantTimeEquals(req.body.ownerSignupCode || '', ownerSignupCode))) {
      return { status: 403, body: { message: 'A valid owner invitation code is required to create an owner account.' } };
    }
    const role = requestedRole;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { message: 'Enter a valid email address.' } };
    if (!/^[6-9]\d{9}$/.test(phone)) return { status: 400, body: { message: 'Enter a valid 10-digit Indian phone number.' } };
    if (password.length < 6) return { status: 400, body: { message: 'Password must be at least 6 characters.' } };
    if (store.users.some((user) => normalizeEmail(user.email) === email || normalizePhone(user.phone) === phone)) {
      return { status: 409, body: { message: 'An account is already registered with this email or phone number.' } };
    }
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const user = {
      id: `USR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      name,
      email,
      phone,
      role,
      collegeId: String(req.body.collegeId || '').trim(),
      businessName: role === 'owner' ? String(req.body.businessName || '').trim() : '',
      ownerTitle: role === 'owner' ? String(req.body.ownerTitle || '').trim() : '',
      passwordHash: hash(password),
      sessionTokenHash: sessionHash(sessionToken),
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    await writeUsers(store.users);
    return { status: 201, body: { user: publicUser(user), store: publicStoreForUser(store, user), sessionToken } };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/auth/login', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    await persistRoleMigration(store);
    const identifier = normalizeIdentifier(req.body.identifier);
    const user = store.users.find((record) => normalizeEmail(record.email) === identifier || normalizePhone(record.phone) === identifier);
    if (!user || !matches(String(req.body.password || ''), user.passwordHash)) {
      return { status: 401, body: { message: 'Incorrect email/phone or password. Please try again.' } };
    }
    if (req.body.role && req.body.role !== user.role) {
      return { status: 403, body: { message: `This account is registered as a ${user.role}.` } };
    }
    const sessionToken = crypto.randomBytes(32).toString('hex');
    user.sessionTokenHash = sessionHash(sessionToken);
    await writeUsers(store.users);
    return { status: 200, body: { user: publicUser(user), store: publicStoreForUser(store, user), sessionToken } };
  });
  res.status(result.status).json(result.body);
}));
app.get('/api/auth/session', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    await persistRoleMigration(store);
    const user = authenticatedUser(store, req);
    if (!user) return { status: 401, body: { message: 'Please log in again to continue.' } };
    return { status: 200, body: { user: publicUser(user) } };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/auth/logout', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user) {
      user.sessionTokenHash = '';
      await writeUsers(store.users);
    }
    return { status: 200, body: { ok: true } };
  });
  res.status(result.status).json(result.body);
}));
app.put('/api/profile', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (!user) return { status: 401, body: { message: 'Please log in again to update your profile.' } };
    const userId = user.id;
    const name = req.body.name === undefined ? user.name : String(req.body.name).trim();
    const email = req.body.email === undefined ? user.email : normalizeEmail(req.body.email);
    const phone = req.body.phone === undefined ? user.phone : normalizePhone(req.body.phone);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[6-9]\d{9}$/.test(phone)) {
      return { status: 400, body: { message: 'Enter a name, valid email, and valid 10-digit Indian phone number.' } };
    }
    if (store.users.some((record) => record.id !== userId && (normalizeEmail(record.email) === email || normalizePhone(record.phone) === phone))) {
      return { status: 409, body: { message: 'An account is already registered with this email or phone number.' } };
    }
    user.name = name;
    user.email = email;
    user.phone = phone;
    user.role = user.role === 'owner' ? 'owner' : 'student';
    user.collegeId = String(req.body.collegeId ?? user.collegeId ?? '').trim();
    if (user.role === 'owner') {
      user.businessName = String(req.body.businessName ?? user.businessName ?? '').trim();
      user.ownerTitle = String(req.body.ownerTitle ?? user.ownerTitle ?? '').trim();
    }
    await writeUsers(store.users);
    return { status: 200, body: { user: publicUser(user) } };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/auth/forgot-password', route(async (req, res) => {
  if (!mailTransport) {
    return res.status(503).json({
      message: 'Password email is not configured. Add SMTP_USER and SMTP_APP_PASSWORD to the server .env file.',
    });
  }
  const baseUrl = configuredAppUrl();
  if (!baseUrl) {
    return res.status(503).json({
      message: 'Password reset is not configured. Set APP_BASE_URL to the canonical application URL.',
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
    const user = authenticatedUser(current, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to update turf settings.' } };
    const old = current.settings;
    const settingsInput = req.body;
    const price = Object.hasOwn(settingsInput, 'price') ? settingsInput.price : old.price;
    if (!isValidPrice(price)) {
      return { status: 400, body: { message: `Price must be a whole-number INR amount between ₹1 and ₹${MAX_PRICE_INR}.` } };
    }
    current.settings = {
      ...old,
      ...settingsInput,
      price,
      durationHours: Math.max(1, Number(settingsInput.durationHours)),
      openHour: Math.max(0, Math.min(23, Number(settingsInput.openHour))),
      closeHour: Math.max(1, Math.min(24, Number(settingsInput.closeHour))),
      sections: Array.isArray(settingsInput.sections) && settingsInput.sections.length ? settingsInput.sections : old.sections,
      sports: Array.isArray(settingsInput.sports) && settingsInput.sports.length ? settingsInput.sports : old.sports,
      bookingWindowDays: Math.max(1, Number(settingsInput.bookingWindowDays || old.bookingWindowDays)),
      maxActiveBookingsPerPhone: Math.max(1, Number(settingsInput.maxActiveBookingsPerPhone || old.maxActiveBookingsPerPhone)),
      maintenanceDates: Array.isArray(settingsInput.maintenanceDates) ? settingsInput.maintenanceDates : old.maintenanceDates,
    };
    await writeStore(current);
    return { status: 200, body: publicStore(current) };
  });
  res.status(store.status).json(store.body);
}));
app.put('/api/pricing/default', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to update the default price.' } };
    if (!isValidPrice(req.body.price)) {
      return { status: 400, body: { message: `Price must be a whole-number INR amount between ₹1 and ₹${MAX_PRICE_INR}.` } };
    }
    store.settings.price = req.body.price;
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.put('/api/pricing/overrides', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to manage slot prices.' } };

    const { date, section, startHour, price, type } = req.body;
    if (
      typeof date !== 'string' ||
      !isValidDateValue(date) ||
      typeof section !== 'string' ||
      !store.settings.sections.includes(section) ||
      !Number.isSafeInteger(startHour) ||
      !slots(store.settings).includes(startHour) ||
      bookingStartTimestamp(date, startHour) <= Date.now()
    ) {
      return { status: 400, body: { message: 'Choose a valid date, section, and time slot.' } };
    }
    if (!isValidPrice(price)) {
      return { status: 400, body: { message: `Price must be a whole-number INR amount between ₹1 and ₹${MAX_PRICE_INR}.` } };
    }
    if (!['manual', 'promotion'].includes(type)) {
      return { status: 400, body: { message: 'Choose a manual or promotional price type.' } };
    }
    const lastBookingDate = new Date(`${today()}T00:00:00.000Z`);
    lastBookingDate.setUTCDate(lastBookingDate.getUTCDate() + Number(store.settings.bookingWindowDays));
    if (date < today() || date > lastBookingDate.toISOString().slice(0, 10)) {
      return { status: 400, body: { message: `Choose a date within the ${store.settings.bookingWindowDays}-day booking window.` } };
    }
    const key = (item) => item.date === date && item.section === section && item.startHour === startHour;
    const existing = store.priceOverrides.find((item) => item.active && key(item));
    const now = new Date().toISOString();
    if (existing) {
      existing.price = price;
      existing.type = type;
      existing.updatedAt = now;
    } else {
      store.priceOverrides.push({
        id: `PRICE-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        date,
        section,
        startHour,
        price,
        type,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.delete('/api/pricing/overrides/:id', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to manage slot prices.' } };
    const override = store.priceOverrides.find((item) => item.id === req.params.id && item.active);
    if (!override) return { status: 404, body: { message: 'Active slot price not found.' } };
    override.active = false;
    override.updatedAt = new Date().toISOString();
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/bookings', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (!user || user.role !== 'student') return { status: 403, body: { message: 'A student account is required to make a booking.' } };
    const settings = store.settings;
    const date = String(req.body.date || '');
    const startHour = Number(req.body.startHour);
    const teamSize = Number(req.body.teamSize ?? 1);
    const booking = {
      id: `BK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      date,
      section: String(req.body.section || '').trim(),
      sport: String(req.body.sport || '').trim(),
      playerName: String(user.name || '').trim(),
      phone: normalizePhone(user.phone),
      collegeId: String(user.collegeId || '').trim(),
      bookedBy: user.id,
      paymentMode: 'Pay at venue',
      paymentStatus: 'unpaid',
      price: settings.price,
      startHour,
      endHour: startHour + Number(settings.durationHours),
      teamSize,
      notes: String(req.body.notes || '').trim(),
      createdAt: new Date().toISOString(),
    };
    if (!booking.date || !booking.section || !booking.sport || !booking.playerName || !booking.phone) {
      return { status: 400, body: { message: 'Missing booking details.' } };
    }
    if (!/^[6-9]\d{9}$/.test(booking.phone)) {
      return { status: 400, body: { message: 'Enter a valid 10-digit Indian phone number.' } };
    }
    if (!isValidDateValue(booking.date) || !Number.isSafeInteger(teamSize) || teamSize < 1) {
      return { status: 400, body: { message: 'Enter a valid booking date and number of players.' } };
    }
    if (!settings.sections.includes(booking.section) || !settings.sports.includes(booking.sport) || !slots(settings).includes(booking.startHour)) {
      return { status: 400, body: { message: 'Invalid booking details.' } };
    }
    const slotPrice = store.priceOverrides.find((item) =>
      item.active &&
      item.date === booking.date &&
      item.section === booking.section &&
      item.startHour === booking.startHour,
    );
    booking.price = slotPrice?.price ?? settings.price;
    if (bookingStartTimestamp(booking.date, booking.startHour) <= Date.now()) {
      return { status: 400, body: { message: 'This time slot has already started.' } };
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
    return { status: 201, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.put('/api/bookings/:id/payment', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to update payments.' } };
    const booking = store.bookings.find((item) => item.id === req.params.id);
    if (!booking || booking.cancelledAt) return { status: 404, body: { message: 'Active booking not found.' } };
    booking.paymentStatus = req.body.paymentStatus === 'paid' ? 'paid' : 'unpaid';
    booking.paymentMode = 'Pay at venue';
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.delete('/api/bookings/:id', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (!user) return { status: 403, body: { message: 'Sign in to manage this booking.' } };
    const booking = store.bookings.find((item) => item.id === req.params.id);
    if (!booking) return { status: 404, body: { message: 'Booking not found.' } };
    if (user.role !== 'owner' && booking.bookedBy !== user.id) {
      return { status: 403, body: { message: 'You can only cancel your own booking.' } };
    }
    if (booking.cancelledAt) return { status: 409, body: { message: 'This booking has already been cancelled.' } };
    if (user.role !== 'owner' && bookingStartTimestamp(booking.date, booking.startHour) <= Date.now() + 24 * 60 * 60 * 1000) {
      return { status: 400, body: { message: 'Bookings can only be cancelled at least 24 hours before their start time.' } };
    }
    booking.cancelledAt = new Date().toISOString();
    booking.paymentStatus = 'refunded';
    booking.paymentMode = 'Pay at venue';
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ message: 'Could not read or save app data. Check data/store.json permissions and server logs.' }); });
app.use(express.static(path.join(__dirname, 'dist'))); app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html'))); app.listen(PORT, () => console.log(`Turf booking app running at http://localhost:${PORT}`));
