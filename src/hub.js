// -----------------------------------------------------------------------------
// The OpenProject hub: reads the instance on a timer of the container,
// publishes the counters of the instance and of every followed project when
// they change, fires the scene events (a work package assigned to me, a work
// package's due day comes, a due day ends with the work package still open),
// and creates work packages for the scene action.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 10 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire even when no device was added. The timer also wakes up at
// the hour of the "due" events and at local midnight, so the events and the
// counters move on time whatever the interval.
// (Architecture adapted from guim31/gladys-wekan.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { hostOf, isLocalAddress } from './config.js';
import { buildDevice, featureStates, instanceIds, projectIds } from './devices.js';
import { ERROR_KINDS, OpenProjectClient, OpenProjectError } from './openproject/client.js';
import {
  addDays,
  findByIdOrName,
  localDay,
  localTime,
  parseGroups,
  parseProjects,
  parseWorkPackages,
  resolveTimeZone,
  summarize,
} from './openproject/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  TODAY_TEXT,
  UNKNOWN_PROJECTS,
  allLanguages,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'openproject-hub' });

export const WIDGET_KEY = 'work_packages_today';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  ASSIGNED: 'work_package_assigned',
  DUE: 'work_package_due',
  OVERDUE: 'work_package_overdue',
});

export const HUB_TIMINGS = {
  // A failed read is tried again this soon, whatever the interval.
  retryMs: 30_000,
  // Read this long after an event hour or midnight, so the server agrees.
  wakeSlackMs: 2_000,
  // Never read more often than this.
  minDelayMs: 10_000,
  // Re-send unchanged values this often: Gladys shows "no recent value" after 48 h.
  heartbeatMs: 12 * 60 * 60_000,
  // An event this late (OpenProject or the integration was down) is dropped.
  maxLateMs: 60 * 60_000,
};

// At most this many projects get a device.
export const MAX_PROJECTS = 20;
// The dated work packages read: due up to this many days ahead (and every
// overdue one), enough for "next due date".
export const HORIZON_DAYS = 60;
// The reading after a command is awaited at most this long: the scene action
// answers within its 20 s.
const REFRESH_WAIT_MS = 3_000;
// Names read out by the "Read today's work packages" action.
const MAX_NAMES = 10;
// OpenProject's limit for a subject.
const MAX_SUBJECT = 255;

const OPEN = { status: { operator: 'o', values: [] } };
const CLOSED = { status: { operator: 'c', values: [] } };

const EMPTY = () => ({
  projects: [],
  openTotal: 0,
  openCounts: new Map(),
  doneTotal: 0,
  doneCounts: new Map(),
  dated: [],
  late: [],
  lateTotal: 0,
  lateCounts: new Map(),
  mine: [],
});

export class OpenProjectHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/openproject/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] defaults to TZ, set by the Gladys supervisor
   */
  constructor({ gladys, store, request, timers = true, timings, now, timeZone }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.timeZone = resolveTimeZone(timeZone ?? process.env.TZ);
    this.config = null;
    this.client = null;
    this.reset();
    this.saved = { scope: null, readAt: 0, mine: [], sent: [] };
    this.connection = null;
    this.devicesSignature = null;
    this.widgetSignature = null;
    this.transports = new Map();
    this.timer = null;
    this.polling = null;
    this.stopped = false;
  }

  reset() {
    /** The user of the API key, `{ id, name }`. */
    this.user = null;
    /** The last reading (see EMPTY). */
    this.data = EMPTY();
    /** The followed projects, `{ id, identifier, name }`. */
    this.followed = [];
    this.unknownProjects = [];
    this.error = null;
    this.downSince = null;
    this.readAt = 0;
    this.connectedLogged = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats is logged once, then at debug until it clears.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      readAt: Number.isFinite(saved.readAt) ? saved.readAt : 0,
      mine: Array.isArray(saved.mine) ? saved.mine.map(String) : [],
      sent: Array.isArray(saved.sent) ? saved.sent : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.devicesSignature = null;
    this.transports.clear();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const same =
      previous &&
      previous.url === config.url &&
      previous.apiKey === config.apiKey &&
      previous.allowSelfSigned === config.allowSelfSigned;
    if (!same) {
      this.reset();
      this.transports.clear();
      this.client =
        config.url && config.apiKey
          ? new OpenProjectClient({
              url: config.url,
              apiKey: config.apiKey,
              insecure: config.allowSelfSigned,
              request: this.request,
            })
          : null;
    }
    // A new language or project list: the devices are published again.
    this.devicesSignature = null;
    this.gladys.forgetPublishedStates?.();
    await this.poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(() => {
      this.poll().catch((err) => this.problem('poll', 'Reading failed', err, 'error'));
    }, delay);
  }

  /** The moment of the "due" event of a work package: its due day, at the configured hour. */
  dueMoment(item) {
    if (this.config.dueHour === 0) {
      // The start of the day, also where midnight does not exist (Chile, Cuba).
      return item.dueAt;
    }
    const [y, m, d] = item.dueDay.split('-').map(Number);
    return localTime(y, m, d, this.config.dueHour, 0, this.timeZone);
  }

  /** The interval, shortened to the next event hour or local midnight. */
  nextDelay(readAt = this.now()) {
    if (this.error) {
      return Math.min(this.config.pollIntervalMs, this.timings.retryMs);
    }
    const now = this.now();
    // `readAt`: a moment that passed during the reading is still ahead of it.
    const moments = [localDay(readAt, this.timeZone).end];
    for (const item of this.data.dated) {
      const due = this.dueMoment(item);
      if (due > readAt) {
        moments.push(due);
      }
    }
    // A moment crossed while reading (a slow server at 23:59:55): read again soon.
    const wake = Math.max(0, Math.min(...moments) - now + this.timings.wakeSlackMs);
    return Math.max(this.timings.minDelayMs, Math.min(this.config.pollIntervalMs, wake));
  }

  // --- Reading ---------------------------------------------------------------

  /** One reading at a time: a call during a reading waits for it, then reads. */
  poll() {
    const run = async () => {
      const readAt = this.now();
      try {
        await this.read();
      } finally {
        this.schedule(this.nextDelay(readAt));
      }
    };
    this.polling = (this.polling ?? Promise.resolve()).catch(() => {}).then(run);
    return this.polling;
  }

  /** Seven requests, one after the other: a small server is not hit at once. */
  async fetch(client, now) {
    const user = this.user ?? (await client.me());
    const projects = parseProjects((await client.projects()).elements);
    const day = localDay(now, this.timeZone);
    const open = await client.workPackages({ filters: [OPEN], groupBy: 'project' });
    const done = await client.workPackages({
      filters: [
        CLOSED,
        { updatedAt: { operator: '<>d', values: [new Date(day.start).toISOString(), ''] } },
      ],
      groupBy: 'project',
    });
    const options = { userId: user.id, timeZone: this.timeZone };
    const yesterday = addDays(now, -1, this.timeZone);
    // Every overdue one is counted, per project; their elements, the most
    // recent first, are read apart: a big instance with more than a page of
    // old overdue work packages still sees today's.
    const lateFilters = [OPEN, { dueDate: { operator: '<>d', values: ['', yesterday] } }];
    const lateCounts = await client.workPackages({ filters: lateFilters, groupBy: 'project' });
    const late = await client.workPackages({
      filters: lateFilters,
      sortBy: [
        ['dueDate', 'desc'],
        ['id', 'asc'],
      ],
    });
    // From yesterday: the "overdue" events at midnight need yesterday's.
    const dated = await client.workPackages({
      filters: [
        OPEN,
        {
          dueDate: {
            operator: '<>d',
            values: [yesterday, addDays(now, HORIZON_DAYS, this.timeZone)],
          },
        },
      ],
      sortBy: [
        ['dueDate', 'asc'],
        ['id', 'asc'],
      ],
    });
    const mine = await client.workPackages({
      filters: [OPEN, { assignee: { operator: '=', values: ['me'] } }],
      sortBy: [['id', 'asc']],
    });
    for (const [key, answer] of [
      ['dated', dated],
      ['late', late],
      ['mine', mine],
    ]) {
      if (answer.total > answer.count) {
        this.problem(
          `truncated-${key}`,
          `${answer.total} work packages in the "${key}" query: only the first ${answer.count} are read`,
        );
      } else {
        this.resolved(`truncated-${key}`);
      }
    }
    return {
      user,
      data: {
        projects,
        openTotal: open.total,
        openCounts: parseGroups(open.groups),
        doneTotal: done.total,
        doneCounts: parseGroups(done.groups),
        dated: parseWorkPackages(dated.elements, options).filter((item) => item.dueAt !== null),
        late: parseWorkPackages(late.elements, options).filter((item) => item.dueAt !== null),
        lateTotal: lateCounts.total,
        lateCounts: parseGroups(lateCounts.groups),
        mine: parseWorkPackages(mine.elements, options),
      },
    };
  }

  async read() {
    if (!this.client) {
      await this.publishConnectionStatus();
      return;
    }
    const now = this.now();
    const { client } = this;
    try {
      const { user, data } = await this.fetch(client, now);
      if (client !== this.client) {
        // The configuration changed during the reading: this is the old
        // instance; the new one is being read.
        return;
      }
      this.user = user;
      this.data = data;
      this.followed = this.follow(data.projects);
      this.readAt = now;
      this.recovered(now);
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.failed(err, now);
    }
    if (this.readAt !== 0) {
      await this.publishDevices();
      // The configuration may change while Gladys answers: never write the
      // old reading's events under the new one.
      if (!this.error && client === this.client) {
        await this.publishStates();
        if (client === this.client) {
          await this.fireEvents(now);
        }
      }
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.refreshWidget();
  }

  /** The projects with a device: the configuration's list (names, identifiers or ids). */
  follow(projects) {
    const unknown = [];
    const found = new Set();
    for (const query of this.config.projects) {
      const { item, reason } = findByIdOrName(projects, query);
      if (item) {
        found.add(item.id);
      } else if (reason === 'ambiguous') {
        // Two projects of that name: both are followed.
        for (const project of projects) {
          if (findByIdOrName([project], query).item) {
            found.add(project.id);
          }
        }
      } else {
        unknown.push(query);
      }
    }
    let followed = projects.filter((project) => found.has(project.id));
    if (followed.length > MAX_PROJECTS) {
      this.problem(
        'too-many-projects',
        `${followed.length} projects: only the first ${MAX_PROJECTS} get a device`,
      );
      followed = followed.slice(0, MAX_PROJECTS);
    } else {
      this.resolved('too-many-projects');
    }
    if (unknown.join('|') !== this.unknownProjects.join('|')) {
      this.unknownProjects = unknown;
      if (unknown.length > 0) {
        logger.warn(UNKNOWN_PROJECTS.en(unknown.join(', ')));
      }
    }
    return followed;
  }

  recovered(now) {
    const host = hostOf(this.config.url);
    if (this.downSince !== null) {
      const minutes = Math.round((now - this.downSince) / 60_000);
      this.resolved('read', `OpenProject at ${host} answers again after ${minutes} min`);
    }
    if (!this.connectedLogged) {
      this.connectedLogged = true;
      logger.info(
        `Connected to OpenProject at ${host}: ${this.data.openTotal} open work package(s), ${this.followed.length} followed project(s)`,
      );
    }
    this.error = null;
    this.downSince = null;
  }

  failed(err, now) {
    const kind = err instanceof OpenProjectError ? err.kind : ERROR_KINDS.HTTP;
    this.error = { kind, message: err.message };
    this.downSince ??= now;
    this.problem(
      'read',
      `OpenProject at ${hostOf(this.config.url)}: ${err.message}`,
      undefined,
      'error',
    );
  }

  /** What a device external id points at: `{ projectId }` (null: the instance), or null. */
  scopeOf(externalId) {
    if (externalId === instanceIds(this.gladys).device) {
      return { projectId: null };
    }
    const project = this.followed.find(
      (item) => projectIds(this.gladys, item.id).device === externalId,
    );
    return project ? { projectId: project.id } : null;
  }

  /** What a widget points at: the instance, or one followed project. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return { projectId: null, unknown: false };
    }
    const scope = this.scopeOf(deviceExternalId);
    return { projectId: scope?.projectId ?? null, unknown: !scope };
  }

  /**
   * The counters of the instance (`projectId` null) or of one project.
   * @param {string|null} [projectId]
   * @param {{ onlyMine?: boolean }} [options] the dated ones assigned to me only
   */
  summary(projectId = null, { onlyMine = false } = {}) {
    const { data } = this;
    const inProject = (item) => projectId === null || item.projectId === projectId;
    const mine = data.mine.filter(inProject);
    const day = localDay(this.now(), this.timeZone);
    const open = projectId === null ? data.openTotal : (data.openCounts.get(projectId) ?? 0);
    const done = projectId === null ? data.doneTotal : (data.doneCounts.get(projectId) ?? 0);
    if (onlyMine) {
      // Every open one assigned to me is read: the overdue ones are all there.
      return summarize({ dated: mine, late: mine, mine: mine.length, open, done }, day);
    }
    return summarize(
      {
        dated: data.dated.filter(inProject),
        late: data.late.filter(inProject),
        overdueCount: projectId === null ? data.lateTotal : (data.lateCounts.get(projectId) ?? 0),
        mine: mine.length,
        open,
        done,
      },
      day,
    );
  }

  projectTitle(projectId) {
    return this.data.projects.find((project) => project.id === projectId)?.name ?? '';
  }

  /** The name of the project in Gladys once its device is added, else in OpenProject (the widget). */
  shownProjectName(projectId) {
    const externalId = projectIds(this.gladys, projectId).device;
    const device = (this.gladys.devices ?? []).find((item) => item.external_id === externalId);
    return device?.name || this.projectTitle(projectId);
  }

  workPackageUrl(id) {
    return `${this.config.url}/work_packages/${id}`;
  }

  // --- Publishing to Gladys --------------------------------------------------

  devices() {
    // Two projects of the same name: the identifier tells them apart.
    const names = new Map();
    for (const project of this.followed) {
      names.set(project.name, (names.get(project.name) ?? 0) + 1);
    }
    return [
      buildDevice(this.gladys, null, this.language),
      ...this.followed.map((project) => {
        const name =
          names.get(project.name) > 1
            ? `${project.name.slice(0, 30)} (${project.identifier || project.id})`
            : project.name;
        return buildDevice(this.gladys, { ...project, name }, this.language);
      }),
    ];
  }

  async publishDevices() {
    const devices = this.devices();
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesSignature = signature;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab. */
  async rediscover() {
    this.devicesSignature = null;
    await this.poll();
  }

  /** The user added a device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device?.external_id);
    if (!this.error && this.readAt !== 0) {
      await this.publishStates();
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  states() {
    const options = { language: this.language, timeZone: this.timeZone };
    return [null, ...this.followed.map((project) => project.id)].flatMap((projectId) =>
      featureStates(this.gladys, projectId, this.summary(projectId), options),
    );
  }

  async publishStates() {
    try {
      // Only the changes, and every value again after `heartbeatMs`.
      await this.gladys.publishChangedStates(this.states(), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    let transport = DEVICE_TRANSPORTS.UNREACHABLE;
    if (!this.error) {
      transport = isLocalAddress(this.config.url)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.CLOUD;
    }
    const entries = this.devices()
      .map((device) => ({ external_id: device.external_id, transport }))
      .filter((entry) => this.transports.get(entry.external_id) !== entry.transport);
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noApiKey };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidget() {
    const signature = JSON.stringify([
      this.error?.kind ?? null,
      this.followed,
      this.data.dated,
      localDay(this.now(), this.timeZone).start,
    ]);
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Scene events ----------------------------------------------------------

  /**
   * The events since the previous successful reading (persisted under /data,
   * so a restart neither repeats nor loses one):
   *   - an open work package assigned to me that was not then (assigned,
   *     created, or reopened since);
   *   - the hour of the "due" event crossed on the due day of an open work
   *     package, the end of its due day crossed, since the previous reading
   *     (at most `maxLateMs` ago). A due date set by hand to a day already
   *     over fires nothing.
   */
  async fireEvents(now) {
    // Another key on the same instance is another user: their assignments are not news.
    const scope = `${this.config.url}#${this.user?.id ?? ''}`;
    const mine = this.data.mine.map((item) => item.id);
    if (this.saved.scope !== scope || this.saved.readAt === 0) {
      // First reading of this instance: what already passed is not news.
      this.saved = { scope, readAt: now, mine, sent: [] };
      this.store.save(this.saved);
      return;
    }
    const known = new Set(this.saved.mine);
    // Due events already sent at the moment where Gladys refused one.
    const sent = new Set(this.saved.sent);
    const eventId = (event) => `${event.key}:${event.item.id}:${event.at}`;
    const from = Math.max(this.saved.readAt, now - this.timings.maxLateMs);
    const crossed = (moment) => moment > from && moment <= now;
    // Gladys refused (restarting?): an assignment is tried again at the next
    // reading (it stays unknown); a due event and the next ones too, within
    // the hour (the time of the reading stays before it).
    const kept = new Set(mine);
    for (const item of this.data.mine) {
      if (!known.has(item.id) && !(await this.fire(TRIGGERS.ASSIGNED, this.eventData(item)))) {
        kept.delete(item.id);
      }
    }
    const events = [];
    for (const item of this.data.dated) {
      const due = this.dueMoment(item);
      if (crossed(due)) {
        events.push({ at: due, key: TRIGGERS.DUE, item });
      }
      const dayEnd = localDay(item.dueAt, this.timeZone).end;
      if (crossed(dayEnd)) {
        events.push({ at: dayEnd, key: TRIGGERS.OVERDUE, item });
      }
    }
    events.sort((a, b) => a.at - b.at || Number(a.item.id) - Number(b.item.id));
    let readAt = now;
    let sentNow = [];
    for (const event of events) {
      if (sent.has(eventId(event))) {
        sentNow.push(eventId(event));
        continue;
      }
      if (!(await this.fire(event.key, this.eventData(event.item)))) {
        readAt = event.at - 1;
        // Those of the same moment already sent are not sent again.
        sentNow = sentNow.filter((id) => id.endsWith(`:${event.at}`));
        break;
      }
      sentNow.push(eventId(event));
    }
    if (readAt === now) {
      sentNow = [];
    }
    this.saved = {
      scope,
      readAt: Math.max(readAt, this.saved.readAt),
      mine: [...kept],
      sent: sentNow,
    };
    this.store.save(this.saved);
  }

  eventData(item) {
    return {
      work_package: item.name,
      work_package_id: item.id,
      project: item.projectId ? projectIds(this.gladys, item.projectId).device : '',
      project_name: item.projectName || this.projectTitle(item.projectId),
      type: item.type,
      status: item.status,
      assignee: item.assignee,
      due_date: item.dueDay ?? '',
      url: this.workPackageUrl(item.id),
    };
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
      return true;
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Commands --------------------------------------------------------------

  /** An OpenProject error, in words for the user (the server's text stays in the logs). */
  explain(err) {
    if (!(err instanceof OpenProjectError)) {
      return err;
    }
    const language = this.language;
    const colon = language === 'fr' ? ' : ' : ': ';
    const status = err.status ? ` (HTTP ${err.status})` : '';
    // A 422 carries OpenProject's reason ("Due date can't be earlier than…").
    const detail = err.kind === ERROR_KINDS.INVALID && err.detail ? ` ${err.detail}` : '';
    return new Error(
      `OpenProject${colon}${pick(ERROR_TEXT[err.kind], language)}${status}${detail}`.slice(0, 500),
      { cause: err },
    );
  }

  fail(key) {
    return new Error(pick(ACTION_TEXT[key], this.language));
  }

  requireClient() {
    if (!this.client) {
      throw this.fail('notConfigured');
    }
    return this.client;
  }

  /** Read now and wait for it; a failed reading is the command's error. */
  async readNow() {
    this.requireClient();
    await this.poll();
    if (this.error) {
      throw this.explain(new OpenProjectError(this.error.kind, this.error.message));
    }
  }

  /** Read again now, and wait for it a little (the answer should not lag). */
  async refreshSoon() {
    const refresh = this.poll().catch(() => {});
    let timer;
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        timer = setTimeout(resolve, REFRESH_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /** A project by id, identifier or name; empty: the first followed one. */
  findProject(projects, query) {
    if (String(query ?? '').trim() === '') {
      const first = this.followed[0] ?? null;
      if (!first) {
        throw this.fail('noProject');
      }
      return first;
    }
    const { item, reason } = findByIdOrName(projects, query);
    if (!item) {
      throw this.fail(reason === 'ambiguous' ? 'projectAmbiguous' : 'projectNotFound');
    }
    return item;
  }

  /**
   * The due date typed in a scene: `YYYY-MM-DD` (or the day of an ISO 8601
   * date and time), or from today, `+3d` (`j` for jours too). Empty: none.
   * @returns {string|null} `YYYY-MM-DD`
   */
  parseDue(raw) {
    const value = String(raw ?? '').trim();
    if (value === '') {
      return null;
    }
    const relative = value.match(/^\+\s*(\d{1,4})\s*(d|j)$/i);
    if (relative) {
      return addDays(this.now(), Number(relative[1]), this.timeZone);
    }
    const day = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
    if (day) {
      const [, y, m, d] = day.map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
        return value.slice(0, 10);
      }
    }
    throw this.fail('badDue');
  }

  /** Create a work package in a project, of a type (by name; empty: the first one). */
  async createWorkPackage({ project: projectQuery, type: typeQuery, subject: rawSubject, due }) {
    const client = this.requireClient();
    const subject = String(rawSubject ?? '')
      .trim()
      .slice(0, MAX_SUBJECT);
    if (!subject) {
      throw this.fail('emptySubject');
    }
    const dueDate = this.parseDue(due);
    let project;
    let type;
    let created;
    try {
      const projects =
        this.readAt !== 0 && !this.error
          ? this.data.projects
          : parseProjects((await client.projects()).elements);
      project = this.findProject(projects, projectQuery);
      const types = (await client.types(project.id)).elements
        .filter((item) => Number.isInteger(item?.id))
        .map((item) => ({
          id: String(item.id),
          name: String(item.name ?? ''),
          milestone: item.isMilestone === true,
          position: Number.isFinite(item.position) ? item.position : Infinity,
        }))
        .sort((a, b) => a.position - b.position);
      if (String(typeQuery ?? '').trim() === '') {
        type = types.find((item) => !item.milestone) ?? types[0];
        if (!type) {
          throw this.fail('noType');
        }
      } else {
        const found = findByIdOrName(types, typeQuery);
        if (!found.item) {
          throw this.fail(found.reason === 'ambiguous' ? 'typeAmbiguous' : 'typeNotFound');
        }
        type = found.item;
      }
      created = await client.createWorkPackage(project.id, {
        subject,
        typeId: type.id,
        dueDate: dueDate ?? undefined,
      });
    } catch (err) {
      throw this.explain(err);
    }
    const id = Number.isInteger(created?.id) ? String(created.id) : '';
    // OpenProject moves a date on a non-working day (a weekend, by default)
    // to the next working day: the answer tells the day kept.
    const kept = [created?.dueDate, created?.date].find((day) => typeof day === 'string');
    logger.info(`Work package ${id} created in project ${project.id} from Gladys`);
    await this.refreshSoon();
    return {
      work_package: subject,
      work_package_id: id,
      url: id ? this.workPackageUrl(id) : '',
      project_name: project.name,
      type: type.name,
      due_date: kept ?? dueDate ?? '',
    };
  }

  /**
   * Today's work packages, as a sentence for a message or a voice
   * announcement, for the instance or one project (id, identifier or name).
   */
  async today({ project: projectQuery, only_mine: onlyMine } = {}) {
    await this.readNow();
    let projectId = null;
    if (String(projectQuery ?? '').trim() !== '') {
      const { item, reason } = findByIdOrName(this.data.projects, projectQuery);
      if (!item) {
        throw this.fail(reason === 'ambiguous' ? 'projectAmbiguous' : 'projectNotFound');
      }
      projectId = item.id;
    }
    const mine = onlyMine === true || onlyMine === 'true';
    const summary = this.summary(projectId, { onlyMine: mine });
    const texts = TODAY_TEXT[this.language] ?? TODAY_TEXT.en;
    const total = summary.overdue + summary.dueToday;
    const names = summary.agenda.slice(0, MAX_NAMES).map((item) => item.name);
    const more = total - names.length;
    if (more > 0) {
      names.push(`+${more}`);
    }
    const text =
      total === 0
        ? texts.none
        : texts.list(total, names) + (summary.overdue > 0 ? texts.overdue(summary.overdue) : '');
    return {
      text: text.slice(0, 1000),
      count: total,
      overdue: summary.overdue,
    };
  }

  /** The "Test the connection" action: read now, report. */
  async testConnection() {
    await this.poll();
    const status = this.connectionStatus();
    if (!status.connected) {
      const message = allLanguages((language) =>
        REPORT_TEXT[language].failed(pick(status.message, language)),
      );
      throw new Error(message[this.language]);
    }
    return allLanguages((language) => {
      const unknown =
        this.unknownProjects.length > 0
          ? ` ${UNKNOWN_PROJECTS[language](this.unknownProjects.join(', '))}`
          : '';
      return `${REPORT_TEXT[language].ok(
        this.user?.name ?? '',
        this.data.openTotal,
        this.followed.length,
      )}${unknown}`;
    });
  }
}
