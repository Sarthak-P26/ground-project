import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('demo seed is repeatable, verifies hashed fictional accounts, and reset preserves the normal store', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'turfcast-demo-data-'));
  try {
    const scriptDirectory = path.join(directory, 'scripts');
    const dataDirectory = path.join(directory, 'data');
    await fs.mkdir(scriptDirectory);
    await fs.mkdir(dataDirectory);
    await fs.copyFile(path.join(projectRoot, 'scripts', 'demoData.js'), path.join(scriptDirectory, 'demoData.js'));
    const normalStorePath = path.join(dataDirectory, 'store.json');
    const marker = '{"mustRemain":"untouched"}\n';
    await fs.writeFile(normalStorePath, marker);

    const run = (action) => spawnSync(process.execPath, [path.join(scriptDirectory, 'demoData.js'), action], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(run('seed').status, 0);
    const firstSeed = await fs.readFile(path.join(dataDirectory, 'demo-store.json'), 'utf8');
    assert.equal(run('seed').status, 0);
    const secondSeed = await fs.readFile(path.join(dataDirectory, 'demo-store.json'), 'utf8');
    assert.equal(firstSeed, secondSeed);
    const verify = run('verify');
    assert.equal(verify.status, 0, verify.stderr);
    const summary = JSON.parse(verify.stdout);
    assert.equal(summary.users, 9);
    assert.equal(summary.students, 8);
    assert.equal(summary.bookings, 25);
    assert.equal(summary.confirmedActive, 20);
    assert.equal(summary.paid, 15);
    assert.equal(summary.unpaid, 5);
    assert.equal(summary.cancelled, 5);
    assert.equal(summary.collectedRevenue, 9000);
    assert.equal(summary.pendingAmount, 3000);
    assert.equal(summary.cancellationRate, 20);
    const seededStore = JSON.parse(firstSeed);
    assert.equal(
      seededStore.users.find((user) => user.role === 'owner')?.email,
      'sarthakpawar2604@gmail.com',
    );
    assert.equal((await fs.readFile(normalStorePath, 'utf8')), marker);

    const reset = run('reset');
    assert.equal(reset.status, 0, reset.stderr);
    await assert.rejects(fs.access(path.join(dataDirectory, 'demo-store.json')));
    assert.equal((await fs.readFile(normalStorePath, 'utf8')), marker);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
