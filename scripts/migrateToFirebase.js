import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.FIREBASE_DATABASE_URL?.replace(/\/$/, '');
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const hasServiceAccount = Boolean(databaseUrl && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey);
if (!databaseUrl) throw new Error('Set FIREBASE_DATABASE_URL in .env before migrating.');
const normalizeBooking = (booking = {}) => ({
  ...booking,
  paymentMode: booking.paymentMode === 'UPI' ? 'Pay at venue' : (booking.paymentMode || 'Pay at venue'),
  paymentStatus: booking.paymentStatus === 'cancelled' ? 'refunded' : (booking.paymentStatus || 'unpaid'),
});
async function updateFirebase(value) {
  if (hasServiceAccount) { admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }), databaseURL: databaseUrl }); return admin.database().ref().update(value); }
  if (process.env.FIREBASE_ALLOW_PUBLIC_REST !== 'true') throw new Error('Set Firebase service-account credentials or explicitly enable public RTDB demo mode.');
  const response = await fetch(`${databaseUrl}/.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`RTDB migration failed: ${response.status}`);
}
try { const store = JSON.parse(await fs.readFile(path.resolve(__dirname, '../data/store.json'), 'utf8')); const bookings = (store.bookings || []).map(normalizeBooking); await updateFirebase({ users: store.users || [], bookings, settings: store.settings || {} }); console.log('Migrated /users, /bookings, and /settings to Firebase RTDB.'); } catch (error) { if (error.code === 'ENOENT') console.log('No data/store.json found; nothing to migrate.'); else throw error; }
