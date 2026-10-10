import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startIsolatedServer(directory, nodeEnv) {
  const port = await availablePort();
  const child = spawn(process.execPath, [path.join(directory, 'server.js')], {
    cwd: directory,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      PORT: String(port),
      FIREBASE_DATABASE_URL: '',
      FIREBASE_PROJECT_ID: '',
      FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '',
      FIREBASE_ALLOW_PUBLIC_REST: 'false',
      GEMINI_API_KEY: 'test-disabled',
      GEMINI_MODEL: '',
      SMTP_USER: '',
      SMTP_APP_PASSWORD: '',
    },
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (child.exitCode !== null) throw new Error(`Isolated server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/store`);
      if (response.ok) return { child, baseUrl };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('Isolated server did not start within 15 seconds.');
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

async function postJson(baseUrl, route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

test('local MVP password reset works without a confirmation field and invalidates the old session', async () => {
  const testDirectory = await fs.mkdtemp(path.join(projectRoot, '.test-auth-reset-'));
  await fs.copyFile(path.join(projectRoot, 'server.js'), path.join(testDirectory, 'server.js'));
  let server;

  try {
    server = await startIsolatedServer(testDirectory, 'test');
    const signup = await postJson(server.baseUrl, '/api/auth/signup', {
      name: 'Reset Regression',
      email: 'reset-regression@example.test',
      phone: '9876543210',
      password: 'OldPass123',
      role: 'student',
    });
    assert.equal(signup.status, 201);
    assert.ok(signup.body.sessionToken);

    const missingIdentifier = await postJson(server.baseUrl, '/api/auth/reset-password', {
      directReset: true,
      password: 'NewPass123',
    });
    assert.equal(missingIdentifier.status, 400);
    assert.match(missingIdentifier.body.message, /registered email or phone/i);

    const storePath = path.join(testDirectory, 'data', 'store.json');
    const isolatedStore = JSON.parse(await fs.readFile(storePath, 'utf8'));
    isolatedStore.users[0].passwordReset = {
      token: 'outstanding-test-token',
      expiresAt: Date.now() + 60000,
    };
    await fs.writeFile(storePath, JSON.stringify(isolatedStore));

    const reset = await postJson(server.baseUrl, '/api/auth/reset-password', {
      directReset: true,
      identifier: ' RESET-REGRESSION@EXAMPLE.TEST ',
      password: 'NewPass123',
    });
    assert.equal(reset.status, 200);
    assert.match(reset.body.message, /password updated/i);

    const updatedStore = JSON.parse(await fs.readFile(storePath, 'utf8'));
    const user = updatedStore.users[0];
    assert.notEqual(user.passwordHash, 'NewPass123');
    assert.match(user.passwordHash, /^[a-f\d]{32}:[a-f\d]{128}$/i);
    assert.equal(user.passwordReset, undefined);
    assert.equal(user.sessionTokenHash, '');
    assert.equal(JSON.stringify(updatedStore).includes('NewPass123'), false);

    const oldSession = await fetch(`${server.baseUrl}/api/auth/session`, {
      headers: { Authorization: `Bearer ${signup.body.sessionToken}` },
    });
    assert.equal(oldSession.status, 401);

    const oldPasswordLogin = await postJson(server.baseUrl, '/api/auth/login', {
      identifier: 'reset-regression@example.test',
      password: 'OldPass123',
      role: 'student',
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await postJson(server.baseUrl, '/api/auth/login', {
      identifier: 'reset-regression@example.test',
      password: 'NewPass123',
      role: 'student',
    });
    assert.equal(newPasswordLogin.status, 200);
    assert.ok(newPasswordLogin.body.sessionToken);

    await stopServer(server.child);
    server = await startIsolatedServer(testDirectory, 'production');
    const productionReset = await postJson(server.baseUrl, '/api/auth/reset-password', {
      directReset: true,
      identifier: 'reset-regression@example.test',
      password: 'ProdBlocked123',
    });
    assert.equal(productionReset.status, 403);
    assert.match(productionReset.body.message, /disabled in production/i);
  } finally {
    if (server) await stopServer(server.child);
    await fs.rm(testDirectory, { recursive: true, force: true });
  }
});
