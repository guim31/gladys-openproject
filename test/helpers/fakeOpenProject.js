// -----------------------------------------------------------------------------
// An in-memory OpenProject, answering the routes the integration calls the
// way the real server does (HAL collections, `groupBy` counts, `{ _type:
// "Error", message }` bodies, the web app's HTML page outside the API). Its
// starting data are real answers of openproject/openproject:16 in Docker
// (test/fixtures/openproject/real-*.json), captured on 30/10/2026 around
// 17:50 UTC, user "OpenProject Admin" (id 4). Two projects, Maison (3) and
// Jardin (4), ten work packages:
//   - Maison: "Sortir les poubelles" (29/10, mine), "Payer la cantine" (30/10,
//     mine), "Arroser les plantes" (30/10, Camille), "Changer les draps"
//     (30/10, mine, closed today), "Réparer le robinet" (02/11, mine),
//     "Ranger le grenier" (no date), milestone "Fin des travaux" (16/11);
//   - Jardin: "Tailler la haie" (28/10), "Tondre la pelouse" (02/11, Camille),
//     "Commander du terreau" (no date, mine, closed today).
// test/fake-openproject.test.js checks the fake answers the captured queries
// exactly as the real server did.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/openproject/${name}.json`, import.meta.url), 'utf8'),
  );

export const API_KEY = 'b2f1c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
export const USER_ID = 4;
export const PROJECTS = Object.freeze({ MAISON: '3', JARDIN: '4' });
export const TYPES = Object.freeze({ TASK: 1, MILESTONE: 2, SUMMARY: 3 });
export const STATUSES = Object.freeze({ NEW: 1, CLOSED: 12 });

const json = (status, value) => ({
  status,
  headers: { 'content-type': 'application/hal+json; charset=utf-8' },
  body: JSON.stringify(value),
});
const html = (status) => ({
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: '<!DOCTYPE html><html><body>OpenProject</body></html>',
});
const idOf = (link) => link?.href?.match(/\/(\d+)$/)?.[1] ?? null;

// A day of an `<>d` filter: a date (`YYYY-MM-DD`, the whole day) or an instant.
const bound = (value, end) => {
  if (!value) {
    return end ? Infinity : -Infinity;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return Date.parse(value);
};

export class FakeOpenProject {
  constructor() {
    this.me = fixture('real-me');
    this.projectsAnswer = fixture('real-projects');
    this.typesAnswer = fixture('real-types');
    this.closed = new Set(
      fixture('real-statuses')
        ._embedded.elements.filter((status) => status.isClosed)
        .map((status) => String(status.id)),
    );
    this.workPackages = fixture('real-work-packages').map((item) => structuredClone(item));
    this.nextId = 49;
    /** Requests received, `{ method, path, json }`. */
    this.requests = [];
    /** When set, every request answers this (`{ status, body }` or an Error to throw). */
    this.failure = null;
    this.apiKey = API_KEY;
  }

  // --- Test helpers --------------------------------------------------------------

  find(id) {
    return this.workPackages.find((item) => item.id === Number(id));
  }

  /** Change a work package as a user would in OpenProject. */
  update(id, { dueDate, assignee, status, updatedAt } = {}) {
    const item = this.find(id);
    if (dueDate !== undefined) {
      if ('date' in item) {
        item.date = dueDate;
      } else {
        item.dueDate = dueDate;
      }
    }
    if (assignee !== undefined) {
      item._links.assignee =
        assignee === null ? { href: null } : { href: `/api/v3/users/${assignee}`, title: 'User' };
    }
    if (status !== undefined) {
      item._links.status = {
        href: `/api/v3/statuses/${status}`,
        title: status === STATUSES.CLOSED ? 'Closed' : 'New',
      };
    }
    item.updatedAt = updatedAt ?? item.updatedAt;
    return item;
  }

  // --- Routes ----------------------------------------------------------------------

  async handle({ method, path, headers, json: body }) {
    this.requests.push({ method, path, json: body });
    if (this.failure instanceof Error) {
      throw this.failure;
    }
    if (this.failure) {
      return json(this.failure.status, this.failure.body);
    }
    const url = new URL(path, 'http://fake');
    if (!url.pathname.startsWith('/api/v3/')) {
      return html(404);
    }
    const expected = `Basic ${Buffer.from(`apikey:${this.apiKey}`).toString('base64')}`;
    if (headers?.authorization !== expected) {
      return json(401, fixture('real-error-401'));
    }
    const route = `${method} ${url.pathname}`;
    if (route === 'GET /api/v3/users/me') {
      return json(200, this.me);
    }
    if (route === 'GET /api/v3/projects') {
      return json(200, this.projectsAnswer);
    }
    let match = url.pathname.match(/^\/api\/v3\/projects\/(\d+)\/types$/);
    if (method === 'GET' && match) {
      return this.project(match[1])
        ? json(200, this.typesAnswer)
        : json(404, fixture('real-error-404'));
    }
    match = url.pathname.match(/^\/api\/v3\/projects\/(\d+)\/work_packages$/);
    if (method === 'POST' && match) {
      return this.create(match[1], body);
    }
    if (route === 'GET /api/v3/work_packages') {
      return this.query(url.searchParams);
    }
    return json(404, fixture('real-error-404'));
  }

  project(id) {
    return this.projectsAnswer._embedded.elements.find((project) => String(project.id) === id);
  }

  matches(item, filters) {
    for (const filter of filters) {
      const [[name, { operator, values }]] = Object.entries(filter);
      const status = idOf(item._links.status);
      if (name === 'status') {
        if (operator === 'o' && this.closed.has(status)) return false;
        if (operator === 'c' && !this.closed.has(status)) return false;
      } else if (name === 'assignee') {
        const wanted = values.map((value) => (value === 'me' ? String(this.me.id) : value));
        if (!wanted.includes(idOf(item._links.assignee))) return false;
      } else if (name === 'dueDate') {
        const day = item.dueDate ?? item.date ?? null;
        if (day === null || day < bound(values[0], false) || day > bound(values[1], true)) {
          return false;
        }
      } else if (name === 'updatedAt') {
        const at = Date.parse(item.updatedAt);
        if (at < bound(values[0], false) || at > bound(values[1], true)) return false;
      } else {
        throw new Error(`fake: filter ${name} not supported`);
      }
    }
    return true;
  }

  query(params) {
    const filters = JSON.parse(params.get('filters') ?? '[]');
    const sortBy = JSON.parse(params.get('sortBy') ?? '[["id","asc"]]');
    const pageSize = Number(params.get('pageSize') ?? 20);
    const found = this.workPackages
      .filter((item) => this.matches(item, filters))
      .sort((a, b) => {
        for (const [key, direction] of sortBy) {
          const value = (item) =>
            key === 'dueDate' ? (item.dueDate ?? item.date ?? '~') : item[key];
          const order = value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0;
          if (order !== 0) return direction === 'asc' ? order : -order;
        }
        return 0;
      });
    const elements = found.slice(0, pageSize).map(({ updatedAt: _updatedAt, ...item }) => item);
    const answer = { total: found.length, count: elements.length, _embedded: { elements } };
    if (params.get('groupBy') === 'project') {
      const groups = new Map();
      for (const item of found) {
        const link = item._links.project;
        const group = groups.get(link.href) ?? { value: link.title, count: 0, href: link.href };
        group.count += 1;
        groups.set(link.href, group);
      }
      answer._type = 'WorkPackageCollection';
      answer.groups = [...groups.values()]
        .sort((a, b) => a.value.localeCompare(b.value))
        .map((group) => ({
          value: group.value,
          count: group.count,
          _links: {
            valueLink: [{ href: group.href }],
            groupBy: { href: '/api/v3/queries/group_bys/project', title: 'Project' },
          },
        }));
    }
    return json(200, answer);
  }

  create(projectId, body) {
    const project = this.project(projectId);
    if (!project) {
      return json(404, fixture('real-error-404'));
    }
    if (body?.dueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
      return json(422, fixture('real-error-422'));
    }
    if (body?.dueDate && Number.isNaN(Date.parse(`${body.dueDate}T00:00:00Z`))) {
      return json(422, fixture('real-error-422'));
    }
    const typeId = idOf(body?._links?.type) ?? String(TYPES.TASK);
    const type = this.typesAnswer._embedded.elements.find((item) => String(item.id) === typeId);
    const milestone = type?.isMilestone === true;
    // Non-working days (Saturday and Sunday by default) move to the Monday,
    // as the real server did (31/10/2026 → 02/11/2026).
    let due = body.dueDate ?? null;
    if (due) {
      const day = new Date(`${due}T00:00:00Z`);
      const shift = { 6: 2, 0: 1 }[day.getUTCDay()] ?? 0;
      due = new Date(day.getTime() + shift * 86_400_000).toISOString().slice(0, 10);
    }
    const item = {
      id: this.nextId++,
      subject: body.subject,
      ...(milestone ? { date: due } : { dueDate: due }),
      updatedAt: new Date().toISOString(),
      _links: {
        project: { href: `/api/v3/projects/${projectId}`, title: project.name },
        status: { href: `/api/v3/statuses/${STATUSES.NEW}`, title: 'New' },
        type: { href: `/api/v3/types/${type?.id ?? TYPES.TASK}`, title: type?.name ?? 'Task' },
        assignee: { href: null },
      },
    };
    this.workPackages.push(item);
    const { updatedAt: _updatedAt, ...answer } = item;
    return json(201, { _type: 'WorkPackage', lockVersion: 0, ...answer });
  }
}

/**
 * A fake network: `request(url, options)` like src/openproject/http.js, routed
 * to the fake server of the URL's origin; any other origin is unreachable.
 */
export function createNetwork(servers) {
  return {
    async request(url, options = {}) {
      const target = new URL(url);
      for (const [base, server] of Object.entries(servers)) {
        const prefix = new URL(base);
        if (target.origin === prefix.origin) {
          const path = `${target.pathname}${target.search}`;
          return server.handle({ ...options, method: options.method ?? 'GET', path });
        }
      }
      const error = new Error(`connect ECONNREFUSED ${target.host}`);
      error.code = 'ECONNREFUSED';
      throw error;
    },
  };
}
