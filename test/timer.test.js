// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device published
// with should_poll: false (nor one created without should_poll,
// GladysAssistant/Gladys#3198): OpenProject must be read by the hub's own
// timer, with no onPoll at all — and on time for the hour of a "due" event
// between two readings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CONFIG, createAll, createClock, createWorld, instanceId } from './helpers/world.js';

const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const reads = (server) =>
  server.requests.filter((r) => r.path.startsWith('/api/v3/projects?')).length;

test('the internal timer reads OpenProject without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({
    clock,
    config: { ...BASE_CONFIG, poll_interval: '120' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'poll');
  await createAll(w);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false, 'Gladys is not asked to poll');
  const before = reads(w.server);
  for (let i = 0; i < 3; i += 1) {
    clock.advance(120_000);
    t.mock.timers.tick(120_000);
    await settle();
  }
  assert.equal(reads(w.server) - before, 3, 'one reading per interval');
  assert.ok(polled.mock.callCount() >= 3);
});

test('the timer wakes up at the hour of a "due" event, shorter than the interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock(Date.UTC(2026, 10, 2, 6, 58)); // 07:58 in Paris, Monday
  const w = await createWorld({
    clock,
    config: { ...BASE_CONFIG, poll_interval: '600' },
    timers: true,
  });
  t.after(() => w.app.stop());
  clock.advance(140_000);
  t.mock.timers.tick(140_000);
  await settle();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => `${event.key}:${event.data.work_package}`),
    ['work_package_due:Tondre la pelouse', 'work_package_due:Réparer le robinet'],
    'read at 08:00, not at 08:08',
  );
});

test('the timer wakes up at midnight: the counters of the new day', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock(Date.UTC(2026, 9, 30, 22, 55)); // 23:55 in Paris
  const w = await createWorld({
    clock,
    config: { ...BASE_CONFIG, poll_interval: '600' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const overdue = instanceId(w.gladys).feature('overdue');
  assert.equal(w.fake.lastState(overdue), 2);
  clock.advance(5 * 60_000 + 2_000);
  t.mock.timers.tick(5 * 60_000 + 2_000);
  await settle();
  assert.equal(w.fake.lastState(overdue), 4, 'read at midnight, not at 00:05');
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  await w.app.stop();
  const before = w.server.requests.length;
  t.mock.timers.tick(60 * 60_000);
  await settle();
  assert.equal(w.server.requests.length, before);
});
