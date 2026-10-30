// -----------------------------------------------------------------------------
// From the raw OpenProject answers to what Gladys shows: projects, work
// packages with their due day, and the counters of a local day (the time zone
// of Gladys, injected by the supervisor as TZ).
//
// Definitions, the same in the devices, the widget, the scene actions and the
// documentation:
//   - open work package: its status is not a closed one (OpenProject's
//     "isClosed", the `o` filter of the API);
//   - due day: its finish date (`dueDate`), or the date of a milestone (`date`);
//   - overdue: open, and its due day is over (before today);
//   - due today: open, and its due day is today;
//   - done today: closed, and last updated today (OpenProject keeps no
//     closing date: a closed work package edited today counts too);
//   - next due date: the earliest due day of an open work package, today or
//     later.
// -----------------------------------------------------------------------------

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const fold = (value) =>
  String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The numeric id at the end of a HAL link (`/api/v3/projects/3` → `3`), else null. */
export function linkId(link) {
  const match = typeof link?.href === 'string' ? link.href.match(/\/(\d+)$/) : null;
  return match ? match[1] : null;
}

const linkTitle = (link) => text(link?.title);

/**
 * Every active project the user sees, in the order OpenProject gives them.
 * @param {unknown[]} elements of GET /api/v3/projects
 * @returns {Array<{ id: string, identifier: string, name: string }>}
 */
export function parseProjects(elements) {
  const seen = new Set();
  return (Array.isArray(elements) ? elements : [])
    .filter((project) => Number.isInteger(project?.id) && project.active !== false)
    .filter((project) => !seen.has(project.id) && seen.add(project.id))
    .map((project) => ({
      id: String(project.id),
      identifier: text(project.identifier),
      name: text(project.name) || `#${project.id}`,
    }));
}

/**
 * The open work packages of an answer (they are all open: the query filters
 * on the status), with their due day.
 * @param {unknown[]} elements of GET /api/v3/work_packages (with `select`)
 * @param {{ userId: number|null, timeZone: string }} options
 */
export function parseWorkPackages(elements, { userId, timeZone }) {
  const seen = new Set();
  return (Array.isArray(elements) ? elements : [])
    .filter((item) => Number.isInteger(item?.id) && !seen.has(item.id) && seen.add(item.id))
    .map((item) => {
      const links = item._links ?? {};
      const dueDay = [item.dueDate, item.date].find((day) => DAY.test(day ?? '')) ?? null;
      const assigneeId = linkId(links.assignee);
      return {
        id: String(item.id),
        name: text(item.subject) || `#${item.id}`,
        projectId: linkId(links.project),
        projectName: linkTitle(links.project),
        type: linkTitle(links.type),
        status: linkTitle(links.status),
        assignee: linkTitle(links.assignee),
        mine: userId !== null && assigneeId === String(userId),
        dueDay,
        dueAt: dueDay ? dayStart(dueDay, timeZone) : null,
      };
    });
}

/** The counts of a `groupBy=project` answer, by project id. */
export function parseGroups(groups) {
  const counts = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const id = linkId(group?._links?.valueLink?.[0]);
    if (id && Number.isFinite(group.count)) {
      counts.set(id, (counts.get(id) ?? 0) + group.count);
    }
  }
  return counts;
}

// --- Local days -------------------------------------------------------------------

const partsFormatters = new Map();

function zonedParts(ms, timeZone) {
  let format = partsFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]),
  );
  return parts;
}

/** Offset of `timeZone` from UTC at `ms`, in milliseconds. */
function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight of a local calendar day (DST-safe). */
function localMidnight(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, timeZone);
  let start = guess - offsetAt(first, timeZone);
  // Where the clocks jump at midnight (Chile, Cuba), 00:00 does not exist and
  // the instant found is 23:00 the day before: the day starts an hour later.
  if (zonedParts(start, timeZone).day !== day) {
    start += 60 * 60_000;
  }
  return start;
}

/** UTC instant of a local wall-clock time (in a DST overlap, one of the two). */
export function localTime(year, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/** A time zone Intl knows, else the one of the process. */
export function resolveTimeZone(timeZone) {
  try {
    if (timeZone) {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    }
  } catch {
    // fall through
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Start and end (exclusive) of the local day holding `now`. */
export function localDay(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const start = localMidnight(p.year, p.month, p.day, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, end };
}

/** The local calendar day of `ms`, `YYYY-MM-DD`. */
export function dayString(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Local midnight starting a `YYYY-MM-DD` day. */
export function dayStart(day, timeZone) {
  const [, y, m, d] = day.match(DAY);
  return localMidnight(Number(y), Number(m), Number(d), timeZone);
}

/** `YYYY-MM-DD`, `days` after the local day of `ms`. */
export function addDays(ms, days, timeZone) {
  const [y, m, d] = dayString(ms, timeZone).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

// --- Counters ---------------------------------------------------------------------

// The overdue work packages kept in the agenda (the widget shows ten rows).
export const AGENDA_OVERDUE = 10;

/**
 * Counters of one day, for a scope: the whole instance, or one project.
 * @param {object} reading
 * @param {ReturnType<typeof parseWorkPackages>} reading.dated open, due from yesterday on
 * @param {ReturnType<typeof parseWorkPackages>} reading.late open and overdue, the most recent ones
 * @param {number} [reading.overdueCount] every overdue one (else `late` is complete)
 * @param {number} reading.mine open, assigned to the user
 * @param {number} reading.open open work packages
 * @param {number} reading.done closed today
 * @param {{ start: number, end: number }} day
 */
export function summarize({ dated, late, overdueCount, mine, open, done }, day) {
  const order = (a, b) => a.dueAt - b.dueAt || Number(a.id) - Number(b.id);
  const ahead = dated.filter((item) => item.dueAt !== null && item.dueAt >= day.start).sort(order);
  // The most recent overdue ones, shown oldest first (a big instance may have
  // thousands: the widget and the sentence show ten).
  const behind = late
    .filter((item) => item.dueAt !== null && item.dueAt < day.start)
    .sort((a, b) => order(b, a))
    .slice(0, AGENDA_OVERDUE)
    .reverse();
  const today = ahead.filter((item) => item.dueAt < day.end);
  return {
    dayStart: day.start,
    open,
    done,
    mine,
    overdue:
      overdueCount ?? late.filter((item) => item.dueAt !== null && item.dueAt < day.start).length,
    dueToday: today.length,
    next: ahead[0] ?? null,
    // What is left by tonight: overdue first, then today's.
    agenda: [...behind, ...today],
  };
}

/**
 * Find an item by its id, its identifier (a project's, as in its address)
 * or its exact name (case, accents and repeated blanks ignored).
 * @template {{ id: string, name: string, identifier?: string }} T
 * @param {T[]} items
 * @param {unknown} query
 * @returns {{ item: T|null, reason?: 'empty'|'not_found'|'ambiguous' }}
 */
export function findByIdOrName(items, query) {
  const wanted = String(query ?? '')
    .trim()
    .replace(/^#/, '');
  if (!wanted) {
    return { item: null, reason: 'empty' };
  }
  const byId = items.find(
    (item) => item.id === wanted || (item.identifier && item.identifier === wanted),
  );
  if (byId) {
    return { item: byId };
  }
  const matches = items.filter((item) => fold(item.name) === fold(wanted));
  if (matches.length === 1) {
    return { item: matches[0] };
  }
  return { item: null, reason: matches.length > 1 ? 'ambiguous' : 'not_found' };
}
