// -----------------------------------------------------------------------------
// The hub against the in-memory OpenProject (real answers of
// openproject/openproject:16): counters, followed projects, scene events, the
// scene actions, the API key and the error cases. The clock starts on
// 30/10/2026 at 19:00 in Paris (UTC+1), a Friday.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BASE_CONFIG,
  FakeOpenProject,
  PROJECTS,
  START,
  STATUSES,
  URL_1,
  USER_ID,
  createClock,
  createWorld,
  instanceId,
  projectId,
} from './helpers/world.js';

const at = (month, day, h, m = 0) => Date.UTC(2026, month - 1, day, h, m); // UTC

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const counters = (w, ids) => ({
  open: w.fake.lastState(ids.feature('open')),
  dueToday: w.fake.lastState(ids.feature('due_today')),
  overdue: w.fake.lastState(ids.feature('overdue')),
  mine: w.fake.lastState(ids.feature('assigned_to_me')),
  done: w.fake.lastState(ids.feature('done_today')),
  next: w.fake.lastState(ids.feature('next_due')),
});

const events = (w) => w.fake.sceneEvents.map((event) => `${event.key}:${event.data.work_package}`);

test('the fixtures start where the tests expect them', () => {
  assert.equal(new Date(START).toISOString(), '2026-10-30T18:00:00.000Z');
  assert.equal(URL_1, 'http://openproject.lan:8080');
});

test('the instance device and one device per followed project, with their counters', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => [device.name, device.external_id]),
    [
      ['OpenProject', instanceId(w.gladys).device],
      ['OpenProject Jardin', projectId(w.gladys, PROJECTS.JARDIN).device],
      ['OpenProject Maison', projectId(w.gladys, PROJECTS.MAISON).device],
    ],
  );
  assert.deepEqual(counters(w, instanceId(w.gladys)), {
    open: 8,
    dueToday: 2,
    overdue: 2,
    mine: 3,
    done: 2,
    next: 'Arroser les plantes · Fri 30 Oct',
  });
  assert.deepEqual(counters(w, projectId(w.gladys, PROJECTS.MAISON)), {
    open: 6,
    dueToday: 2,
    overdue: 1,
    mine: 3,
    done: 1,
    next: 'Arroser les plantes · Fri 30 Oct',
  });
  assert.deepEqual(counters(w, projectId(w.gladys, PROJECTS.JARDIN)), {
    open: 2,
    dueToday: 0,
    overdue: 1,
    mine: 0,
    done: 1,
    next: 'Tondre la pelouse · Mon 2 Nov',
  });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    w.fake.transports.map((entry) => entry.transport),
    ['local', 'local', 'local'],
  );
});

test('no followed project: the instance device only', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, projects: '' } });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['OpenProject'],
  );
});

test('projects by name, identifier or id; an unknown one is reported', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, projects: 'MAISON, 4, potager' } });
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.deepEqual(w.hub.unknownProjects, ['potager']);
  const report = await w.fake.action('test_connection');
  assert.equal(report.success, true);
  assert.match(
    report.data.message.en,
    /as OpenProject Admin: 8 open work package\(s\), 2 followed/,
  );
  assert.match(report.data.message.en, /Unknown project\(s\) ignored: potager/);
});

test('the requests: seven per reading (and the user once), filters as JSON', async (t) => {
  const w = await world(t);
  const paths = w.server.requests.map((request) => decodeURIComponent(request.path));
  assert.equal(paths.length, 8);
  assert.match(paths[0], /^\/api\/v3\/users\/me$/);
  assert.match(paths[1], /^\/api\/v3\/projects\?filters=\[\{"active"/);
  assert.match(paths[2], /groupBy=project&pageSize=0$/);
  assert.match(
    paths[3],
    /"updatedAt":\{"operator":"<>d","values":\["2026-10-29T23:00:00.000Z",""\]/,
  );
  assert.match(paths[4], /"dueDate":\{"operator":"<>d","values":\["","2026-10-29"\]\}.*groupBy/);
  assert.match(paths[5], /"values":\["","2026-10-29"\].*\["dueDate","desc"\]/);
  assert.match(paths[6], /"dueDate":\{"operator":"<>d","values":\["2026-10-29","2026-12-29"\]/);
  assert.match(paths[7], /"assignee":\{"operator":"=","values":\["me"\]/);
  await w.hub.poll();
  assert.equal(w.server.requests.length, 8 + 7, 'the user is read once');
});

test('a big instance: more than a page of old overdue ones, today is still seen', async (t) => {
  const server = new FakeOpenProject();
  for (let i = 0; i < 1100; i += 1) {
    server.workPackages.push({
      ...structuredClone(server.find(43)),
      id: 1000 + i,
      subject: `Old ${i}`,
      dueDate: '2025-01-15',
    });
  }
  const w = await world(t, { server });
  assert.deepEqual(counters(w, instanceId(w.gladys)), {
    open: 1108,
    dueToday: 2,
    overdue: 1102,
    mine: 3,
    done: 2,
    next: 'Arroser les plantes · Fri 30 Oct',
  });
  const today = await w.fake.sceneAction('read_today', {});
  assert.equal(today.data.outputs.count, 1002, 'the 1000 most recent overdue, then today');
  assert.equal(today.data.outputs.overdue, 1102);
});

test('another key on the same instance: its assignments are not news', async (t) => {
  const server = new FakeOpenProject();
  const w = await world(t, { server });
  server.me = { ...server.me, id: 5, name: 'Camille Martin' };
  server.apiKey = 'camille-key';
  await w.fake.configUpdated({ ...BASE_CONFIG, api_key: 'camille-key' });
  assert.deepEqual(events(w), []);
  server.update(45, { assignee: 5 });
  w.clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(events(w), ['work_package_assigned:Payer la cantine']);
});

test('midnight crossed during a slow reading: read again soon', async (t) => {
  const clock = createClock(Date.UTC(2026, 9, 30, 22, 59, 55));
  const w = await world(t, { clock });
  const readAt = clock.now();
  clock.advance(11_000);
  assert.equal(w.hub.nextDelay(readAt), w.hub.timings.minDelayMs);
});

test('the "due" event at 08:00 on the due day, "overdue" at midnight', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  assert.deepEqual(events(w), [], 'nothing on the first reading');
  clock.set('2026-10-30T23:00:30Z'); // midnight in Paris
  await w.hub.poll();
  assert.deepEqual(events(w), [
    'work_package_overdue:Arroser les plantes',
    'work_package_overdue:Payer la cantine',
  ]);
  clock.set('2026-11-02T07:00:10Z'); // Monday 08:00 in Paris
  await w.hub.poll();
  assert.deepEqual(events(w).slice(2), [
    'work_package_due:Tondre la pelouse',
    'work_package_due:Réparer le robinet',
  ]);
  const due = w.fake.sceneEvents.at(-1).data;
  assert.deepEqual(due, {
    work_package: 'Réparer le robinet',
    work_package_id: '47',
    project: projectId(w.gladys, PROJECTS.MAISON).device,
    project_name: 'Maison',
    type: 'Task',
    status: 'New',
    assignee: 'OpenProject Admin',
    due_date: '2026-11-02',
    url: `${URL_1}/work_packages/47`,
  });
});

test('the hour of the "due" event comes from the configuration', async (t) => {
  const clock = createClock(at(11, 1, 12));
  const w = await world(t, { clock, config: { ...BASE_CONFIG, due_hour: '0' } });
  clock.set('2026-11-01T23:00:05Z'); // Monday 00:00 in Paris
  await w.hub.poll();
  assert.deepEqual(events(w), [
    'work_package_due:Tondre la pelouse',
    'work_package_due:Réparer le robinet',
  ]);
});

test('a closed work package fires nothing; one reopened and mine is "assigned"', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  w.server.update(39, { status: STATUSES.CLOSED });
  w.server.update(46, { status: STATUSES.NEW });
  clock.set('2026-10-30T23:00:30Z');
  await w.hub.poll();
  assert.deepEqual(events(w), [
    'work_package_assigned:Changer les draps',
    'work_package_overdue:Payer la cantine',
    'work_package_overdue:Changer les draps',
  ]);
});

test('assigned to me: a new assignment fires once, a restart does not repeat it', async (t) => {
  const clock = createClock();
  const server = new FakeOpenProject();
  const first = await createWorld({ clock, server });
  server.update(42, { assignee: USER_ID });
  clock.advance(60_000);
  await first.hub.poll();
  assert.deepEqual(events(first), ['work_package_assigned:Tondre la pelouse']);
  await first.app.stop();
  const second = await world(t, { clock, server, dataDir: first.dataDir });
  clock.advance(60_000);
  await second.hub.poll();
  assert.deepEqual(events(second), [], 'known since the previous run (under /data)');
});

test('an event missed while stopped fires at the restart, within the hour', async (t) => {
  const clock = createClock(at(10, 30, 22, 50));
  const server = new FakeOpenProject();
  const first = await createWorld({ clock, server });
  await first.app.stop();
  clock.set('2026-10-30T23:20:00Z'); // 00:20 in Paris
  const second = await world(t, { clock, server, dataDir: first.dataDir });
  assert.deepEqual(events(second), [
    'work_package_overdue:Arroser les plantes',
    'work_package_overdue:Payer la cantine',
  ]);
});

test('a refused event is sent again at the next reading, the others not twice', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  let refuse = 2;
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  w.gladys.publishSceneEvent = async (key, data) => {
    if (data.work_package === 'Payer la cantine' && refuse-- > 0) {
      throw new Error('HTTP 503');
    }
    return publish(key, data);
  };
  clock.set('2026-10-30T23:00:30Z');
  await w.hub.poll();
  clock.advance(60_000);
  await w.hub.poll();
  clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(events(w), [
    'work_package_overdue:Arroser les plantes',
    'work_package_overdue:Payer la cantine',
  ]);
});

test('the counters move at midnight', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.set('2026-10-30T23:00:30Z');
  w.server.workPackages.forEach((item) => {
    if (item.id === 46 || item.id === 48) item.updatedAt = '2026-10-30T17:00:00Z';
  });
  await w.hub.poll();
  assert.deepEqual(counters(w, instanceId(w.gladys)), {
    open: 8,
    dueToday: 0,
    overdue: 4,
    mine: 3,
    done: 0,
    next: 'Tondre la pelouse · Mon 2 Nov',
  });
});

test('OpenProject down: unreachable devices, a status message, then back', async (t) => {
  const w = await world(t);
  w.server.failure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.fr, 'OpenProject ne répond pas');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  w.server.failure = null;
  await w.hub.poll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('a wrong key, a wrong address, an address without the API', async (t) => {
  const server = new FakeOpenProject();
  const w = await world(t, { server, config: { ...BASE_CONFIG, api_key: 'nope' } });
  assert.equal(
    w.fake.connectionStatus.message.en,
    'API key refused (revoked, or its user locked?)',
  );
  await w.fake.configUpdated({ ...BASE_CONFIG, url: `${URL_1}/wrong-prefix` });
  assert.equal(w.fake.connectionStatus.message.en, 'no OpenProject API at this address');
  await w.fake.configUpdated({ ...BASE_CONFIG, url: 'http://198.51.100.7' });
  assert.equal(w.fake.connectionStatus.message.en, 'OpenProject does not answer');
  await w.fake.configUpdated({ ...BASE_CONFIG, url: 'ftp://x' });
  assert.equal(
    w.fake.connectionStatus.message.en,
    'Address not understood, e.g. http://192.168.1.20:8080',
  );
  await w.fake.configUpdated({ ...BASE_CONFIG, api_key: '' });
  assert.equal(
    w.fake.connectionStatus.message.en,
    'Enter the API key of an OpenProject user in the configuration.',
  );
});

test('create a work package: default type, by name, milestone, due date', async (t) => {
  const w = await world(t);
  const created = await w.fake.sceneAction('create_work_package', {
    subject: '  Vérifier les détecteurs de fumée ',
    project: 'maison',
    due: '+3d',
  });
  assert.equal(created.success, true, JSON.stringify(created));
  assert.deepEqual(created.data.outputs, {
    work_package: 'Vérifier les détecteurs de fumée',
    work_package_id: '49',
    url: `${URL_1}/work_packages/49`,
    project_name: 'Maison',
    type: 'Task',
    due_date: '2026-11-02',
  });
  const post = w.server.requests.find((request) => request.method === 'POST');
  assert.deepEqual(post.json, {
    subject: 'Vérifier les détecteurs de fumée',
    dueDate: '2026-11-02',
    _links: { type: { href: '/api/v3/types/1' } },
  });
  const milestone = await w.fake.sceneAction('create_work_package', {
    subject: 'Récolte',
    project: 'Jardin',
    type: 'milestone',
    due: '2026-11-15',
  });
  assert.equal(milestone.data.outputs.type, 'Milestone');
  assert.equal(
    milestone.data.outputs.due_date,
    '2026-11-16',
    'a Sunday moved to the Monday by OpenProject, read back from `date`',
  );
  const first = await w.fake.sceneAction('create_work_package', { subject: 'Sans projet' });
  assert.equal(first.data.outputs.project_name, 'Jardin', 'the first followed project');
});

test('create a work package: the errors, in the configured language', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  const fail = async (fields) => (await w.fake.sceneAction('create_work_package', fields)).error;
  assert.match(await fail({ subject: ' ' }), /Indiquez le sujet/);
  assert.match(await fail({ subject: 'x', due: 'demain' }), /Échéance incomprise/);
  assert.match(await fail({ subject: 'x', due: '2026-02-30' }), /Échéance incomprise/);
  assert.match(await fail({ subject: 'x', project: 'potager' }), /Aucun projet/);
  assert.match(await fail({ subject: 'x', project: 'maison', type: 'Bug' }), /Aucun type/);
  w.server.failure = {
    status: 422,
    body: (await import('./helpers/fakeOpenProject.js')).fixture('real-error-422'),
  };
  assert.match(
    await fail({ subject: 'x', project: 'maison' }),
    /^OpenProject : valeurs refusées \(HTTP 422\) Invalid format for property 'dueDate'/,
  );
  w.server.failure = null;
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'fr', projects: '' });
  assert.match(await fail({ subject: 'x' }), /Indiquez le projet/);
});

test('read today: the sentence, per project, mine only', async (t) => {
  const w = await world(t);
  const all = await w.fake.sceneAction('read_today', {});
  assert.deepEqual(all.data.outputs, {
    text: '4 work package(s) due by tonight: Tailler la haie, Sortir les poubelles, Arroser les plantes and Payer la cantine. 2 overdue.',
    count: 4,
    overdue: 2,
  });
  const mine = await w.fake.sceneAction('read_today', { project: 'maison', only_mine: 'true' });
  assert.equal(
    mine.data.outputs.text,
    '2 work package(s) due by tonight: Sortir les poubelles and Payer la cantine. 1 overdue.',
  );
  const none = await w.fake.sceneAction('read_today', { project: 'jardin', only_mine: 'true' });
  assert.equal(none.data.outputs.text, 'No work package due today.');
});

test('the state under /data holds no secret and no name', async (t) => {
  const w = await world(t);
  await w.hub.store.flush();
  const saved = await readFile(join(w.dataDir, 'openproject-state.json'), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(saved)), ['scope', 'readAt', 'mine', 'sent']);
  assert.doesNotMatch(saved, /apikey|b2f1c3|Sortir|Maison/);
  assert.deepEqual(JSON.parse(saved).mine, ['44', '45', '47']);
});

test('a configuration change during a reading: the old answer is dropped', async (t) => {
  const w = await world(t);
  const other = { ...BASE_CONFIG, projects: '' };
  const reading = w.hub.poll();
  await w.fake.configUpdated(other);
  await reading;
  assert.equal(w.hub.followed.length, 0);
});

test('a device created in Gladys gets its states again', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  assert.ok(w.fake.states.length >= before + 6);
});
