// -----------------------------------------------------------------------------
// The "today's work packages" widget: content within the core budget
// (validated by the SDK's validateWidgetContent), the instance and one-project
// views, "only mine", and the degraded states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  BASE_CONFIG,
  PROJECTS,
  createClock,
  createWorld,
  instanceId,
  projectId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet('work_packages_today', {
    settings,
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (data, type) => data.components.filter((component) => component.type === type);
const rows = (data) =>
  ofType(data, 'status')[0].items.map((row) => [row.label, row.value, row.color]);

test('the instance: tiles, the work packages of the day with their project', async (t) => {
  const w = await world(t);
  const data = await content(w);
  assert.ok(data.components.length <= 8);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => tile.value),
    [2, 2],
  );
  assert.deepEqual(rows(data), [
    ['Tailler la haie', 'Wed 28 Oct · Jardin', 'danger'],
    ['Sortir les poubelles', 'Thu 29 Oct · Maison', 'danger'],
    ['Arroser les plantes', 'Today · Maison', 'neutral'],
    ['Payer la cantine', 'Today · Maison', 'neutral'],
  ]);
  assert.equal(ofType(data, 'button').length, 0);
});

test('the instance device chosen explicitly is the same view', async (t) => {
  const w = await world(t);
  const data = await content(w, { device: instanceId(w.gladys).device });
  assert.equal(rows(data).length, 4);
});

test('one project, only mine, in French; the name given in Gladys', async (t) => {
  const w = await world(t);
  const device = projectId(w.gladys, PROJECTS.MAISON).device;
  const data = await content(w, { device, only_mine: true }, 'fr');
  assert.deepEqual(rows(data), [
    ['Sortir les poubelles', 'jeu. 29 oct.', 'danger'],
    ['Payer la cantine', "Aujourd'hui", 'neutral'],
  ]);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => [tile.label, tile.value]),
    [
      ["Aujourd'hui", 1],
      ['En retard', 1],
    ],
  );
  const created = w.fake.discoveredDevices.find((item) => item.external_id === device);
  await w.fake.deviceCreated({ ...created, name: 'Travaux maison' });
  const named = await content(w);
  assert.equal(rows(named)[1][1], 'Thu 29 Oct · Travaux maison');
});

test('nothing due: a sentence and the next due date', async (t) => {
  const clock = createClock(Date.UTC(2026, 10, 10, 12)); // 10/11, everything else done
  const w = await world(t, { clock });
  for (const id of [39, 42, 43, 44, 45, 47]) {
    w.server.update(id, { status: 12 });
  }
  await w.hub.poll();
  const data = await content(w);
  assert.equal(ofType(data, 'text')[0].text, 'No work package due today.');
  assert.deepEqual(rows(data), [['Fin des travaux', 'Next · Mon 16 Nov', 'neutral']]);
});

test('degraded states: not configured, never read, no longer followed, stale', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, api_key: '' } });
  assert.match(ofType(await content(w), 'text')[0].text, /API key/);
  await w.fake.configUpdated(BASE_CONFIG);
  const unknown = await content(w, { device: projectId(w.gladys, '99').device });
  assert.match(ofType(unknown, 'text')[0].text, /no longer followed/);
  w.server.failure = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
  await w.hub.poll();
  const stale = await content(w);
  assert.match(ofType(stale, 'text')[0].text, /last known work packages/);
  assert.equal(rows(stale).length, 4);
  const never = await world(t, { config: { ...BASE_CONFIG, url: 'http://198.51.100.7' } });
  assert.match(ofType(await content(never), 'text')[0].text, /does not answer/);
});

test('ten rows at most', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 12; i += 1) {
    w.server.workPackages.push({
      ...structuredClone(w.server.find(45)),
      id: 100 + i,
      subject: `Lot ${i}`,
    });
  }
  await w.hub.poll();
  const data = await content(w);
  assert.equal(rows(data).length, 10);
  assert.equal(ofType(data, 'value')[0].value, 14);
});
