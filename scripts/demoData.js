import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(projectRoot, 'data');
const demoStorePath = path.join(dataDirectory, 'demo-store.json');
const normalStorePath = path.join(dataDirectory, 'store.json');
const demoPassword = 'TurfDemo#2026';
const settings = {
  price: 600,
  durationHours: 3,
  openHour: 6,
  closeHour: 21,
  sections: ['Section A', 'Section B', 'Section C', 'Section D'],
  sports: ['Cricket', 'Football'],
  bookingWindowDays: 14,
  maxActiveBookingsPerPhone: 2,
  maintenanceDates: [],
  turfLocation: 'Dharashiv, Maharashtra',
};
const students = [
  ['DEMO-STUDENT-01', 'Aarav Patil', 'student01@example.test', '9000000001', 'DEMO-01'],
  ['DEMO-STUDENT-02', 'Ananya Jadhav', 'student02@example.test', '9000000002', 'DEMO-02'],
  ['DEMO-STUDENT-03', 'Rohan Shinde', 'student03@example.test', '9000000003', 'DEMO-03'],
  ['DEMO-STUDENT-04', 'Isha Kulkarni', 'student04@example.test', '9000000004', 'DEMO-04'],
  ['DEMO-STUDENT-05', 'Vedant More', 'student05@example.test', '9000000005', 'DEMO-05'],
  ['DEMO-STUDENT-06', 'Sai Deshmukh', 'student06@example.test', '9000000006', 'DEMO-06'],
  ['DEMO-STUDENT-07', 'Mira Pawar', 'student07@example.test', '9000000007', 'DEMO-07'],
  ['DEMO-STUDENT-08', 'Kabir Joshi', 'student08@example.test', '9000000008', 'DEMO-08'],
];

function hashPassword(password, salt) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function indiaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date, offset) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function localMidnightUtc(date) {
  return `${shiftDate(date, -1)}T18:30:00.000Z`;
}

function bookingStartTimestamp(date, hour) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day, hour) - 330 * 60 * 1000;
}

function createUser([id, name, email, phone, collegeId], role = 'student') {
  const salt = crypto.createHash('sha256').update(`turfcast-demo:${id}`).digest('hex').slice(0, 32);
  return {
    id,
    name,
    email,
    phone,
    role,
    collegeId,
    businessName: role === 'owner' ? 'TurfCast Exhibition Demo' : '',
    ownerTitle: role === 'owner' ? 'Demo Administrator' : '',
    passwordHash: hashPassword(demoPassword, salt),
    sessionTokenHash: '',
    createdAt: localMidnightUtc(indiaToday()),
    demoRecord: true,
  };
}

function configuredSlots(configuration) {
  const hours = [];
  for (let hour = configuration.openHour; hour + configuration.durationHours <= configuration.closeHour; hour += configuration.durationHours) {
    hours.push(hour);
  }
  return hours;
}

function createBooking(index, specification, occurrence, configuration) {
  const student = students[index % students.length];
  const startHour = specification.startHour ?? configuredSlots(configuration)[occurrence % configuredSlots(configuration).length];
  const section = configuration.sections[occurrence % configuration.sections.length];
  const createdDate = shiftDate(specification.date, -5);
  const cancelled = specification.status === 'cancelled';
  const booking = {
    id: `DEMO-BK-${String(index + 1).padStart(3, '0')}`,
    date: specification.date,
    section,
    sport: configuration.sports[index % configuration.sports.length],
    startHour,
    endHour: startHour + configuration.durationHours,
    playerName: student[1],
    phone: student[3],
    collegeId: student[4],
    bookedBy: student[0],
    teamSize: 4 + (index % 5),
    paymentMode: 'Pay at venue',
    paymentStatus: cancelled ? 'refunded' : specification.status,
    price: configuration.price,
    notes: '',
    createdAt: `${createdDate}T05:00:00.000Z`,
    demoRecord: true,
  };
  if (cancelled) {
    booking.cancelledAt = `${specification.cancelledDate}T05:00:00.000Z`;
  }
  return booking;
}

function createDemoStore(now = new Date()) {
  const today = indiaToday(now);
  const users = [
    createUser(
      ['DEMO-OWNER-01', 'Sarthak Pawar', 'sarthakpawar2604@gmail.com', '9000000000', 'DEMO-OWNER'],
      'owner',
    ),
    ...students.map((student) => createUser(student)),
  ];
  const specifications = [
    ...[-29, -24, -19, -13, -8, -6, -4, -1].map((offset) => ({
      date: shiftDate(today, offset), status: 'paid',
    })),
    ...[6, 9, 12, 15].map((startHour) => ({
      date: today, status: 'paid', startHour,
    })),
    ...[1, 2, 4].map((offset) => ({
      date: shiftDate(today, offset), status: 'paid',
    })),
    ...[-10, -2].map((offset) => ({
      date: shiftDate(today, offset), status: 'unpaid',
    })),
    ...[2, 5, 7].map((offset) => ({
      date: shiftDate(today, offset), status: 'unpaid',
    })),
    ...[
      { bookingOffset: -26, cancelledOffset: -29 },
      { bookingOffset: -18, cancelledOffset: -21 },
      { bookingOffset: -10, cancelledOffset: -14 },
      { bookingOffset: -4, cancelledOffset: -7 },
      { bookingOffset: -1, cancelledOffset: -2 },
    ].map(({ bookingOffset, cancelledOffset }) => ({
      date: shiftDate(today, bookingOffset),
      cancelledDate: shiftDate(today, cancelledOffset),
      status: 'cancelled',
    })),
  ];
  const occurrencesByDate = new Map();
  const bookings = specifications.map((specification, index) => {
    const occurrence = occurrencesByDate.get(specification.date) || 0;
    occurrencesByDate.set(specification.date, occurrence + 1);
    return createBooking(index, specification, occurrence, settings);
  });

  return {
    demoMode: true,
    settings: structuredClone(settings),
    priceOverrides: [],
    bookings,
    users,
  };
}

async function writeDemoStore(store) {
  const resolvedDemoPath = path.resolve(demoStorePath);
  if (resolvedDemoPath !== path.resolve(dataDirectory, 'demo-store.json')
    || resolvedDemoPath === path.resolve(normalStorePath)) {
    throw new Error('Refusing to write outside the dedicated demo store.');
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${demoStorePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, demoStorePath);
}

function verifyDemoStore(store, now = new Date()) {
  const errors = [];
  const today = indiaToday(now);
  const configuration = store.settings || settings;
  const usersById = new Map((store.users || []).map((user) => [user.id, user]));
  const bookingIds = new Set();
  const activeSlots = new Set();
  const allSlots = configuredSlots(configuration);
  const demoPasswordValid = (user) => {
    const [salt, savedHash] = String(user.passwordHash || '').split(':');
    return Boolean(salt && savedHash && crypto.scryptSync(demoPassword, salt, 64).toString('hex') === savedHash);
  };

  if (store.demoMode !== true) errors.push('Demo store marker is missing.');
  if (store.users?.length !== 9) errors.push('Expected one owner and eight student accounts.');
  if (configuration.price !== 600) errors.push('Expected the standard demo booking price to be ₹600.');
  if (!store.users?.every((user) => user.demoRecord === true && !String(user.passwordHash).includes(demoPassword) && demoPasswordValid(user))) {
    errors.push('A demo user is missing a valid hashed demo password.');
  }
  if (!store.users?.some((user) => user.email === 'sarthakpawar2604@gmail.com' && user.role === 'owner')) {
    errors.push('The demo owner account is missing.');
  }
  if (students.some(([, , email]) => !store.users?.some((user) => user.email === email && user.role === 'student'))) {
    errors.push('One or more required demo student accounts are missing.');
  }
  if (new Set((store.users || []).map((user) => user.email)).size !== store.users?.length) {
    errors.push('Demo account email addresses are not unique.');
  }
  for (const booking of store.bookings || []) {
    if (!booking.id || bookingIds.has(booking.id)) errors.push(`Duplicate or missing booking ID: ${booking.id || '(missing)'}.`);
    bookingIds.add(booking.id);
    if (booking.demoRecord !== true) errors.push(`Booking ${booking.id} is not marked as simulated data.`);
    if (!usersById.has(booking.bookedBy) || usersById.get(booking.bookedBy).role !== 'student') {
      errors.push(`Booking ${booking.id} has no valid student account.`);
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(booking.date) ||
      new Date(`${booking.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== booking.date ||
      !configuration.sections.includes(booking.section) ||
      !configuration.sports.includes(booking.sport) ||
      !allSlots.includes(booking.startHour) ||
      booking.endHour !== booking.startHour + configuration.durationHours ||
      booking.price !== configuration.price
    ) {
      errors.push(`Booking ${booking.id} has invalid date, section, sport, time, or price data.`);
    }
    if (!booking.cancelledAt) {
      const key = `${booking.date}|${booking.section}|${booking.startHour}`;
      if (activeSlots.has(key)) errors.push(`Conflicting active reservations at ${key}.`);
      activeSlots.add(key);
    } else if (booking.paymentStatus !== 'refunded') {
      errors.push(`Cancelled booking ${booking.id} is not refunded.`);
    }
  }
  const paid = store.bookings.filter((booking) => booking.paymentStatus === 'paid' && !booking.cancelledAt);
  const unpaid = store.bookings.filter((booking) => booking.paymentStatus === 'unpaid' && !booking.cancelledAt);
  const cancelled = store.bookings.filter((booking) => Boolean(booking.cancelledAt));
  const dayDifference = (date) => Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) / 86400000,
  );
  const historicalPaid = paid.filter((booking) => dayDifference(booking.date) < 0 && dayDifference(booking.date) >= -30);
  const recentPaid = historicalPaid.filter((booking) => dayDifference(booking.date) >= -7);
  const todaysPaid = paid.filter((booking) => booking.date === today);
  const futurePaid = paid.filter((booking) => dayDifference(booking.date) > 0);
  const futureUnpaid = unpaid.filter((booking) => dayDifference(booking.date) > 0);
  const cancellationsInRange = cancelled.filter((booking) => {
    const cancellationDate = String(booking.cancelledAt).slice(0, 10);
    return dayDifference(cancellationDate) >= -29 && dayDifference(cancellationDate) <= 0;
  });
  if (bookingIds.size !== 25) errors.push(`Expected exactly 25 bookings; found ${bookingIds.size}.`);
  if (paid.length !== 15 || unpaid.length !== 5 || cancelled.length !== 5) {
    errors.push(`Expected 15 paid, 5 pending, and 5 cancelled records; found ${paid.length}, ${unpaid.length}, and ${cancelled.length}.`);
  }
  if (historicalPaid.length !== 8 || recentPaid.length !== 3 || todaysPaid.length !== 4 || futurePaid.length !== 3 || futureUnpaid.length !== 3) {
    errors.push('Paid and pending bookings do not match the intended historical, today, and upcoming distribution.');
  }
  if (cancellationsInRange.length !== 5) errors.push('All five cancellation timestamps must fall within the last 30 days.');
  if (cancelled.some((booking) => Date.parse(booking.cancelledAt) < Date.parse(booking.createdAt)
    || Date.parse(booking.cancelledAt) >= bookingStartTimestamp(booking.date, booking.startHour))) {
    errors.push('Cancellation timestamps must follow booking creation and precede the reserved slot.');
  }
  if (errors.length) throw new Error(errors.join('\n'));

  return {
    users: store.users.length,
    students: store.users.filter((user) => user.role === 'student').length,
    bookings: store.bookings.length,
    confirmedActive: paid.length + unpaid.length,
    paid: paid.length,
    unpaid: unpaid.length,
    cancelled: cancelled.length,
    refunded: store.bookings.filter((booking) => booking.paymentStatus === 'refunded').length,
    collectedRevenue: paid.reduce((sum, booking) => sum + booking.price, 0),
    pendingAmount: unpaid.reduce((sum, booking) => sum + booking.price, 0),
    cancellationRate: Math.round((cancelled.length / store.bookings.length) * 100),
    todaysPaid: todaysPaid.length,
    historicalPaid: historicalPaid.length,
    recentPaid: recentPaid.length,
    futurePaid: futurePaid.length,
    futureUnpaid: futureUnpaid.length,
    uniqueStudentsWithBookings: new Set(store.bookings.map((booking) => booking.bookedBy)).size,
  };
}

async function run(action) {
  if (action === 'seed') {
    const store = createDemoStore();
    const summary = verifyDemoStore(store);
    await writeDemoStore(store);
    console.log(
      `Seeded ${summary.bookings} simulated records: ${summary.confirmedActive} active (${summary.paid} paid, ${summary.unpaid} pending), ${summary.cancelled} cancelled/refunded; collected ₹${summary.collectedRevenue}, pending ₹${summary.pendingAmount}.`,
    );
    return;
  }
  if (action === 'verify') {
    let store;
    try {
      store = JSON.parse(await fs.readFile(demoStorePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Demo store does not exist. Run npm run seed:demo first.');
      throw error;
    }
    console.log(JSON.stringify(verifyDemoStore(store), null, 2));
    return;
  }
  if (action === 'reset') {
    const resolvedDemoPath = path.resolve(demoStorePath);
    if (resolvedDemoPath !== path.resolve(dataDirectory, 'demo-store.json')
      || resolvedDemoPath === path.resolve(normalStorePath)) {
      throw new Error('Refusing to reset anything except the dedicated demo store.');
    }
    await fs.rm(resolvedDemoPath, { force: true });
    console.log('Removed data/demo-store.json only. data/store.json and Firebase were not accessed.');
    return;
  }
  throw new Error('Choose one action: seed, verify, or reset.');
}

run(process.argv[2]).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
