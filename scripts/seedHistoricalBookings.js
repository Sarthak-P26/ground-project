/* Simulated academic-demo data only; it stays in /historicalBookings, separate from real /bookings. */
import 'dotenv/config';
import crypto from 'node:crypto';
import admin from 'firebase-admin';

const databaseUrl = process.env.FIREBASE_DATABASE_URL?.replace(/\/$/, '');
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const hasServiceAccount = Boolean(databaseUrl && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey);
if (!databaseUrl) throw new Error('Set FIREBASE_DATABASE_URL in .env first.');
const items = [], sections = ['Section A', 'Section B', 'Section C', 'Section D'], hours = [6, 9, 12, 15, 18];
for (let offset = 183; offset > 0; offset -= 1) { const day = new Date(); day.setDate(day.getDate() - offset); const dow = day.getDay(), rainy = Math.sin(offset * .72) > .67, festival = offset > 108 && offset < 116; for (const section of sections) for (const hour of hours) { const likelihood = (hour >= 15 ? .42 : .12) + ([0, 6].includes(dow) ? .25 : 0) + (festival ? .3 : 0) - (rainy ? .22 : 0); if (Math.random() < likelihood) items.push({ id: `SIM-${crypto.randomUUID()}`, date: day.toISOString().slice(0, 10), section, startHour: hour, endHour: hour + 3, sport: hour % 2 ? 'Football' : 'Cricket', simulated: true, createdAt: day.toISOString() }); } }
if (hasServiceAccount) { admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }), databaseURL: databaseUrl }); await admin.database().ref('historicalBookings').set(items); }
else { if (process.env.FIREBASE_ALLOW_PUBLIC_REST !== 'true') throw new Error('Set service-account credentials or explicitly enable public RTDB demo mode.'); const response = await fetch(`${databaseUrl}/historicalBookings.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) }); if (!response.ok) throw new Error(`RTDB history seed failed: ${response.status}`); }
console.log(`Seeded ${items.length} simulated academic-demo bookings.`);
