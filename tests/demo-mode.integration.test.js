import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function getPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function requestJson(baseUrl, route, method, token, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('demo server bypasses Firebase, uses its isolated store, and limits email enrichment to owners', async () => {
  const directory = await fs.mkdtemp(path.join(projectRoot, '.test-demo-server-'));
  let child;
  try {
    await fs.mkdir(path.join(directory, 'scripts'));
    await fs.mkdir(path.join(directory, 'data'));
    await fs.copyFile(path.join(projectRoot, 'server.js'), path.join(directory, 'server.js'));
    await fs.copyFile(path.join(projectRoot, 'scripts', 'demoData.js'), path.join(directory, 'scripts', 'demoData.js'));
    await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');
    const normalStorePath = path.join(directory, 'data', 'store.json');
    const normalStoreMarker = '{"normalStore":"preserve"}\n';
    await fs.writeFile(normalStorePath, normalStoreMarker);
    const seed = spawnSync(process.execPath, [path.join(directory, 'scripts', 'demoData.js'), 'seed'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(seed.status, 0, seed.stderr);

    const port = await getPort();
    child = spawn(process.execPath, [path.join(directory, 'server.js')], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        TURFCAST_DEMO_MODE: 'true',
        TURFCAST_DEMO_ALLOW_PRODUCTION: '',
        FIREBASE_DATABASE_URL: 'https://unreachable-demo-test.invalid',
        FIREBASE_PROJECT_ID: '',
        FIREBASE_CLIENT_EMAIL: '',
        FIREBASE_PRIVATE_KEY: '',
        FIREBASE_ALLOW_PUBLIC_REST: 'true',
        GEMINI_API_KEY: '',
        GEMINI_MODEL: '',
        SMTP_USER: '',
        SMTP_APP_PASSWORD: '',
      },
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    const baseUrl = `http://127.0.0.1:${port}`;
    let storeResponse;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      if (child.exitCode !== null) throw new Error(`Demo server exited early: ${output}`);
      try {
        storeResponse = await fetch(`${baseUrl}/api/store`);
        if (storeResponse.ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(storeResponse?.ok, `Demo server did not become ready. ${output}`);
    assert.match(output, /Firebase is disabled/);
    assert.doesNotMatch(output, /Using public RTDB REST demo mode/);
    const anonymousStore = await storeResponse.json();
    assert.equal(anonymousStore.demoMode, true);

    const ownerLogin = await postJson(baseUrl, '/api/auth/login', {
      identifier: 'sarthakpawar2604@gmail.com',
      password: 'TurfDemo#2026',
      role: 'owner',
    });
    assert.equal(ownerLogin.status, 200);
    assert.ok(ownerLogin.body.store.bookings.some((booking) => booking.customerEmail === 'student01@example.test'));
    const ownerRoleMismatch = await postJson(baseUrl, '/api/auth/login', {
      identifier: 'sarthakpawar2604@gmail.com',
      password: 'TurfDemo#2026',
      role: 'student',
    });
    assert.equal(ownerRoleMismatch.status, 403);

    const studentLogin = await postJson(baseUrl, '/api/auth/login', {
      identifier: 'student01@example.test',
      password: 'TurfDemo#2026',
      role: 'student',
    });
    assert.equal(studentLogin.status, 200);
    assert.ok(studentLogin.body.store.bookings.some((booking) => booking.bookedBy === studentLogin.body.user.id));
    assert.ok(studentLogin.body.store.bookings.every((booking) => !Object.hasOwn(booking, 'customerEmail')));
    const studentCannotCollect = await requestJson(
      baseUrl,
      '/api/bookings/DEMO-BK-001/payment',
      'PUT',
      studentLogin.body.sessionToken,
      { paymentStatus: 'paid' },
    );
    assert.equal(studentCannotCollect.status, 403);

    const secondStudentLogin = await postJson(baseUrl, '/api/auth/login', {
      identifier: 'student02@example.test',
      password: 'TurfDemo#2026',
      role: 'student',
    });
    assert.equal(secondStudentLogin.status, 200);
    assert.ok(secondStudentLogin.body.store.bookings.every((booking) =>
      booking.bookedBy === secondStudentLogin.body.user.id || !Object.hasOwn(booking, 'playerName'),
    ));

    const signup = await postJson(baseUrl, '/api/auth/signup', {
      name: 'Isolated Test Student',
      email: 'isolated-write@example.test',
      phone: '9012345678',
      password: 'TestPass123',
      role: 'student',
    });
    assert.equal(signup.status, 201);
    assert.equal((await fs.readFile(normalStorePath, 'utf8')), normalStoreMarker);

    const bookingDate = new Date();
    bookingDate.setUTCDate(bookingDate.getUTCDate() + 3);
    const bookingPayload = {
      date: bookingDate.toISOString().slice(0, 10),
      section: 'Section A',
      sport: 'Cricket',
      startHour: 6,
      teamSize: 5,
    };
    const authorization = signup.body.sessionToken;
    const booking = await requestJson(baseUrl, '/api/bookings', 'POST', authorization, bookingPayload);
    assert.equal(booking.status, 201);
    const createdBooking = booking.body.bookings.find((item) => item.playerName === 'Isolated Test Student');
    assert.ok(createdBooking);
    assert.equal(createdBooking.paymentStatus, 'unpaid');
    const duplicate = await requestJson(baseUrl, '/api/bookings', 'POST', authorization, bookingPayload);
    assert.equal(duplicate.status, 409);

    const collect = await requestJson(
      baseUrl,
      `/api/bookings/${createdBooking.id}/payment`,
      'PUT',
      ownerLogin.body.sessionToken,
      { paymentStatus: 'paid' },
    );
    assert.equal(collect.status, 200);
    const collectForStudent = await requestJson(baseUrl, '/api/store', 'GET', authorization);
    assert.equal(
      collectForStudent.body.bookings.find((item) => item.id === createdBooking.id).paymentStatus,
      'paid',
    );

    const cancellation = await requestJson(
      baseUrl,
      `/api/bookings/${createdBooking.id}`,
      'DELETE',
      authorization,
    );
    assert.equal(cancellation.status, 200);
    const cancelledForStudent = await requestJson(baseUrl, '/api/store', 'GET', authorization);
    const cancelledBooking = cancelledForStudent.body.bookings.find((item) => item.id === createdBooking.id);
    assert.ok(cancelledBooking.cancelledAt);
    assert.equal(cancelledBooking.paymentStatus, 'refunded');
    const ownerAfterCancellation = await requestJson(baseUrl, '/api/store', 'GET', ownerLogin.body.sessionToken);
    const ownerBooking = ownerAfterCancellation.body.bookings.find((item) => item.id === createdBooking.id);
    assert.equal(ownerBooking.customerEmail, 'isolated-write@example.test');
    assert.equal(ownerBooking.paymentStatus, 'refunded');

    const demoStore = JSON.parse(await fs.readFile(path.join(directory, 'data', 'demo-store.json'), 'utf8'));
    assert.ok(demoStore.users.some((user) => user.email === 'isolated-write@example.test' && user.demoRecord));
    assert.ok(demoStore.bookings.some((item) => item.id === createdBooking.id && item.cancelledAt && item.demoRecord));
    assert.equal((await fs.readFile(normalStorePath, 'utf8')), normalStoreMarker);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('demo server refuses production startup without explicit override', async () => {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'server.js')], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '0',
      TURFCAST_DEMO_MODE: 'true',
      TURFCAST_DEMO_ALLOW_PRODUCTION: '',
      GEMINI_API_KEY: '',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked in production/i);
});
