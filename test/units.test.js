// -----------------------------------------------------------------------------
// The pure parts: configuration, the parsing of real OpenProject answers
// (test/fixtures/openproject), the local days, the lookup by name, and the
// client's reading of the HTTP answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  isLocalAddress,
  normalizeConfig,
  parseNameList,
  parseServerUrl,
} from '../src/config.js';
import { ERROR_KINDS, OpenProjectClient, OpenProjectError } from '../src/openproject/client.js';
import {
  addDays,
  dayStart,
  dayString,
  findByIdOrName,
  localDay,
  localTime,
  parseGroups,
  parseProjects,
  parseWorkPackages,
  summarize,
} from '../src/openproject/model.js';
import { fixture } from './helpers/fakeOpenProject.js';
import { START, TIME_ZONE } from './helpers/world.js';

test('the address: bare host, copied browser URL, API URL, reverse proxy prefix', () => {
  assert.equal(parseServerUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080');
  assert.equal(
    parseServerUrl('https://op.example.org/projects/maison/work_packages?query_id=3'),
    'https://op.example.org',
    'https://fdx.example.com',
  );
  assert.equal(parseServerUrl('https://op.example.org/api/v3/'), 'https://op.example.org');
  assert.equal(
    parseServerUrl('https://example.org/openproject/my/page'),
    'https://example.org/openproject',
  );
  assert.equal(parseServerUrl('http://user:pass@192.0.2.10'), null, 'no credentials in the URL');
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseServerUrl('  '), null);
});

test('local or cloud: the address tells', () => {
  for (const url of [
    'http://192.168.1.20:8080',
    'http://10.0.0.5',
    'http://172.20.0.3',
    'http://openproject:8080',
    'https://op.home.arpa',
    'http://openproject.lan',
    'http://[fd00::5]:8080',
  ]) {
    assert.equal(isLocalAddress(url), true, url);
  }
  for (const url of [
    'https://acme.openproject.com',
    'http://198.51.100.7',
    'https://op.example.org',
  ]) {
    assert.equal(isLocalAddress(url), false, url);
  }
});

test('the configuration and its defaults', () => {
  const config = normalizeConfig({ url: 'op.lan', api_key: ' key ', projects: 'a; b,a' });
  assert.equal(config.url, 'http://op.lan');
  assert.equal(config.apiKey, 'key');
  assert.deepEqual(config.projects, ['a', 'b']);
  assert.equal(config.dueHour, 8);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ due_hour: '0', poll_interval: '7' }).dueHour, 0);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 300_000);
  assert.deepEqual(parseNameList(undefined), []);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('real projects: id as a string, identifier, name', () => {
  assert.deepEqual(parseProjects(fixture('real-projects')._embedded.elements), [
    { id: '4', identifier: 'jardin', name: 'Jardin' },
    { id: '3', identifier: 'maison', name: 'Maison' },
  ]);
});

test('real work packages: due day of a task and of a milestone, assignee, project', () => {
  const items = parseWorkPackages(fixture('real-query-dated').body._embedded.elements, {
    userId: 4,
    timeZone: TIME_ZONE,
  });
  assert.deepEqual(
    items.map((item) => [item.id, item.dueDay, item.mine, item.projectId]),
    [
      ['43', '2026-10-28', false, '4'],
      ['44', '2026-10-29', true, '3'],
      ['39', '2026-10-30', false, '3'],
      ['45', '2026-10-30', true, '3'],
      ['42', '2026-11-02', false, '4'],
      ['47', '2026-11-02', true, '3'],
      ['41', '2026-11-16', false, '3'],
    ],
  );
  const milestone = items.at(-1);
  assert.equal(milestone.name, 'Fin des travaux');
  assert.equal(milestone.type, 'Milestone');
  assert.equal(new Date(milestone.dueAt).toISOString(), '2026-11-15T23:00:00.000Z');
  assert.equal(items[1].assignee, 'OpenProject Admin');
});

test('real group counts, by project id', () => {
  const counts = parseGroups(fixture('real-query-open-by-project').body.groups);
  assert.deepEqual(
    [...counts],
    [
      ['4', 2],
      ['3', 6],
    ],
  );
});

test('the counters of a day', () => {
  const dated = parseWorkPackages(fixture('real-query-dated').body._embedded.elements, {
    userId: 4,
    timeZone: TIME_ZONE,
  });
  const summary = summarize(
    { dated, late: dated, mine: 3, open: 8, done: 2 },
    localDay(START, TIME_ZONE),
  );
  assert.equal(summary.overdue, 2);
  assert.equal(summary.dueToday, 2);
  assert.equal(summary.mine, 3);
  assert.equal(summary.next.name, 'Arroser les plantes');
  assert.deepEqual(
    summary.agenda.map((item) => item.id),
    ['43', '44', '39', '45'],
  );
});

test('find by id, identifier or exact name', () => {
  const items = parseProjects(fixture('real-projects')._embedded.elements);
  assert.equal(findByIdOrName(items, 'MAISON').item.id, '3', 'name, case ignored');
  assert.equal(findByIdOrName(items, 'jardin').item.id, '4');
  assert.equal(findByIdOrName(items, '#3').item.id, '3');
  assert.equal(findByIdOrName(items, 'Potager').reason, 'not_found');
  assert.equal(findByIdOrName(items, ' ').reason, 'empty');
  const twins = [
    { id: '1', name: 'Été' },
    { id: '2', name: 'ete' },
  ];
  assert.equal(findByIdOrName(twins, 'ETE').reason, 'ambiguous');
});

test('local days and wall-clock times, across a DST change', () => {
  // 25/10/2026: Paris goes back from UTC+2 to UTC+1 at 03:00.
  assert.equal(
    new Date(localTime(2026, 10, 24, 18, 0, 'Europe/Paris')).toISOString(),
    '2026-10-24T16:00:00.000Z',
  );
  assert.equal(
    new Date(dayStart('2026-10-25', TIME_ZONE)).toISOString(),
    '2026-10-24T22:00:00.000Z',
  );
  assert.equal(
    localDay(dayStart('2026-10-25', TIME_ZONE), TIME_ZONE).end,
    dayStart('2026-10-26', TIME_ZONE),
  );
  assert.equal(dayString(START, TIME_ZONE), '2026-10-30');
  assert.equal(dayString(Date.UTC(2026, 9, 30, 23, 30), TIME_ZONE), '2026-10-31');
  assert.equal(addDays(START, 3, TIME_ZONE), '2026-11-02');
  assert.equal(addDays(START, 60, TIME_ZONE), '2026-12-29');
});

const answer = (status, body) => async () => ({
  status,
  headers: {},
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const kindOf = async (request, call = (client) => client.me()) => {
  const client = new OpenProjectClient({ url: 'http://op.lan', apiKey: 'k', request });
  try {
    await call(client);
  } catch (err) {
    assert.ok(err instanceof OpenProjectError);
    return err.kind;
  }
  return null;
};

test('the client: real errors, an HTML page, a redirect, a network error', async () => {
  assert.equal(await kindOf(answer(401, fixture('real-error-401'))), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(answer(404, fixture('real-error-404'))), ERROR_KINDS.NOT_FOUND);
  assert.equal(await kindOf(answer(422, fixture('real-error-422'))), ERROR_KINDS.INVALID);
  assert.equal(await kindOf(answer(404, '<!DOCTYPE html>')), ERROR_KINDS.NOT_OPENPROJECT);
  assert.equal(await kindOf(answer(404, { error: 'x' })), ERROR_KINDS.NOT_OPENPROJECT);
  assert.equal(
    await kindOf(answer(200, { _type: 'Root' }), (c) => c.projects()),
    ERROR_KINDS.NOT_OPENPROJECT,
  );
  assert.equal(await kindOf(answer(302, '')), ERROR_KINDS.REDIRECT);
  assert.equal(await kindOf(answer(429, '')), ERROR_KINDS.RATE_LIMIT);
  assert.equal(await kindOf(answer(502, '<html>')), ERROR_KINDS.HTTP);
  assert.equal(
    await kindOf(answer(200, { _type: 'AnonymousUser', id: null })),
    ERROR_KINDS.AUTH,
    'an instance open to anonymous users took no key',
  );
  const refused = async () => {
    throw Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  };
  assert.equal(await kindOf(refused), ERROR_KINDS.TLS);
});

test('the client: the 422 explanation is kept for the user', async () => {
  const client = new OpenProjectClient({
    url: 'http://op.lan',
    apiKey: 'k',
    request: answer(422, fixture('real-error-422')),
  });
  const err = await client.createWorkPackage(3, { subject: 'x', typeId: '1' }).catch((e) => e);
  assert.match(err.detail, /^Invalid format for property 'dueDate'/);
});

test('the client: the key in HTTP Basic, apikey as the user name', async () => {
  let seen;
  const client = new OpenProjectClient({
    url: 'http://op.lan',
    apiKey: 'secret',
    request: async (url, options) => {
      seen = options.headers.authorization;
      return { status: 200, headers: {}, body: JSON.stringify(fixture('real-me')) };
    },
  });
  assert.deepEqual(await client.me(), { id: 4, name: 'OpenProject Admin' });
  assert.equal(seen, `Basic ${Buffer.from('apikey:secret').toString('base64')}`);
});
