// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake OpenProject on a fake
// network, a temporary /data, a manual clock and the Paris time zone, with
// the integration wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read OpenProject
// with `world.hub.poll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import {
  API_KEY,
  FakeOpenProject,
  PROJECTS,
  STATUSES,
  TYPES,
  USER_ID,
  createNetwork,
} from './fakeOpenProject.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// A name of the home network: the devices are "local" (src/config.js isLocalAddress).
export const URL_1 = 'http://openproject.lan:8080';
export const TIME_ZONE = 'Europe/Paris';
// The fixtures were captured on 30/10/2026 around 17:50 UTC; the tests start
// at 18:00 UTC (19:00 in Paris, UTC+1), a Friday. Overdue: "Tailler la haie"
// (28/10), "Sortir les poubelles" (29/10); due today: "Arroser les plantes",
// "Payer la cantine"; done today: "Changer les draps", "Commander du terreau".
export const START = Date.UTC(2026, 9, 30, 18, 0, 0);

export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    /** Move to a local Paris time (UTC+1 until March). */
    set(isoUtc) {
      clock.time = Date.parse(isoUtc);
    },
  };
  return clock;
}

export const BASE_CONFIG = {
  url: URL_1,
  api_key: API_KEY,
  projects: 'maison, Jardin',
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {FakeOpenProject} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  server,
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-openproject-')),
  timings = {},
  timers = false,
} = {}) {
  const openproject = server ?? new FakeOpenProject();
  const network = createNetwork({ [URL_1]: openproject });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
    timeZone: TIME_ZONE,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server: openproject, app, hub: app.hub, clock, dataDir };
}

export const instanceId = (gladys) => gladys.externalIds('instance', 'instance');
export const projectId = (gladys, id = PROJECTS.MAISON) =>
  gladys.externalIds('project', `project-${id}`);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { API_KEY, FakeOpenProject, PROJECTS, STATUSES, TYPES, USER_ID };
