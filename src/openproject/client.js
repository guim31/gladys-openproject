// -----------------------------------------------------------------------------
// OpenProject API v3 client (HAL+JSON): the calls the integration needs.
// Checked against a real openproject/openproject:16 (all-in-one image) in
// Docker, October 2026.
//
// Authentication: an API key of an OpenProject user ("My account → Access
// tokens → API"), sent as HTTP Basic `apikey:<key>`. Nothing else is kept.
//
//   GET  /api/v3/users/me                          { id, name }
//   GET  /api/v3/projects                          { total, _embedded.elements[{ id, identifier, name, active }] }
//   GET  /api/v3/work_packages?filters=…           { total, count, groups?, _embedded.elements[…] }
//   GET  /api/v3/projects/:id/types                { _embedded.elements[{ id, name, position }] }
//   POST /api/v3/projects/:id/work_packages        { subject, dueDate?, _links.type } → 201 work package
//
// Pitfalls found on the real server are in CLAUDE.md ("OpenProject").
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // API key refused
  FORBIDDEN: 'forbidden', // the user may not do this
  NOT_FOUND: 'not_found', // the project or the type is gone
  INVALID: 'invalid', // 422: OpenProject refused the values (its message is kept)
  NOT_OPENPROJECT: 'not_openproject', // something answers, but not the API v3
  REDIRECT: 'redirect', // HTTP redirected to HTTPS, or a login portal
  RATE_LIMIT: 'rate_limit', // 429: a reverse proxy's request limit
  HTTP: 'http', // any other unexpected answer
});

export class OpenProjectError extends Error {
  constructor(kind, message, status, detail = '') {
    super(message);
    this.name = 'OpenProjectError';
    this.kind = kind;
    this.status = status;
    /** OpenProject's own explanation of a 422, shown to the user. */
    this.detail = detail;
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new OpenProjectError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new OpenProjectError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

// The API caps a page at 1000 elements (setting "apiv3_max_page_size").
export const PAGE_SIZE = 1000;

/** The fields of a work package the integration reads (`select`, a smaller answer). */
const WORK_PACKAGE_FIELDS = [
  'total',
  'count',
  'elements/id',
  'elements/subject',
  'elements/dueDate',
  'elements/date',
  'elements/project',
  'elements/status',
  'elements/type',
  'elements/assignee',
];

/** The work packages query string: filters as JSON, sort, page size, fields. */
export function workPackagesQuery({ filters, sortBy, pageSize = PAGE_SIZE, groupBy }) {
  const params = new URLSearchParams();
  params.set('filters', JSON.stringify(filters));
  if (sortBy) {
    params.set('sortBy', JSON.stringify(sortBy));
  }
  if (groupBy) {
    params.set('groupBy', groupBy);
    // `select` refuses `groups` (400): counts only, no element (pageSize 0).
    params.set('pageSize', '0');
    return `/api/v3/work_packages?${params}`;
  }
  params.set('select', WORK_PACKAGE_FIELDS.join(','));
  params.set('pageSize', String(pageSize));
  return `/api/v3/work_packages?${params}`;
}

export class OpenProjectClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, without trailing slash
   * @param {string} options.apiKey
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/openproject/http.js)
   */
  constructor({ url, apiKey = '', insecure = false, request }) {
    this.url = url;
    this.insecure = insecure;
    this.request = request ?? httpRequest;
    this.authorization = `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`;
  }

  async send(path, { method = 'GET', json } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        method,
        json,
        insecure: this.insecure,
        headers: { authorization: this.authorization, accept: 'application/hal+json' },
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    let parsed;
    let parsedOk = true;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsedOk = false;
    }
    // The server's own message, short; it never echoes the key.
    const detail =
      parsedOk && typeof parsed?.message === 'string' ? parsed.message.slice(0, 200) : '';
    const said = detail ? ` ${detail}` : '';
    if (status === 429) {
      throw new OpenProjectError(ERROR_KINDS.RATE_LIMIT, 'HTTP 429', status);
    }
    if (status >= 300 && status < 400) {
      throw new OpenProjectError(ERROR_KINDS.REDIRECT, `HTTP ${status}`, status);
    }
    // Another server, or the web app outside the API: an HTML page.
    const isApiError = parsedOk && parsed?._type === 'Error';
    if (!parsedOk || (status >= 400 && status < 500 && !isApiError)) {
      throw new OpenProjectError(
        status < 500 ? ERROR_KINDS.NOT_OPENPROJECT : ERROR_KINDS.HTTP,
        `HTTP ${status}, not the OpenProject API`,
        status,
      );
    }
    if (status === 401) {
      throw new OpenProjectError(ERROR_KINDS.AUTH, `HTTP 401${said}`, status);
    }
    if (status === 403) {
      throw new OpenProjectError(ERROR_KINDS.FORBIDDEN, `HTTP 403${said}`, status);
    }
    if (status === 404) {
      throw new OpenProjectError(ERROR_KINDS.NOT_FOUND, `HTTP 404${said}`, status);
    }
    if (status === 422) {
      throw new OpenProjectError(ERROR_KINDS.INVALID, `HTTP 422${said}`, status, detail);
    }
    if (status < 200 || status >= 300) {
      throw new OpenProjectError(ERROR_KINDS.HTTP, `HTTP ${status}${said}`, status);
    }
    return parsed;
  }

  /** A HAL collection: `{ total, count, groups, elements }`, else "not OpenProject". */
  async collection(path) {
    const data = await this.send(path);
    const elements = data?._embedded?.elements;
    // With `select`, the answer has no `_type`: its total is the sign.
    if (!Number.isFinite(data?.total) || (elements !== undefined && !Array.isArray(elements))) {
      throw new OpenProjectError(ERROR_KINDS.NOT_OPENPROJECT, `no collection in ${path}`, 200);
    }
    return {
      total: Number.isFinite(data.total) ? data.total : 0,
      count: Number.isFinite(data.count) ? data.count : 0,
      groups: Array.isArray(data.groups) ? data.groups : [],
      elements: Array.isArray(elements) ? elements : [],
    };
  }

  /** The user of the API key; anonymous answers 401 on a login-required instance. */
  async me() {
    const data = await this.send('/api/v3/users/me');
    if (data?._type !== 'User' || !Number.isFinite(data.id)) {
      // `_type: "AnonymousUser"`: an instance readable without login took no key.
      throw new OpenProjectError(ERROR_KINDS.AUTH, `not a user (${data?._type})`, 200);
    }
    return { id: data.id, name: typeof data.name === 'string' ? data.name : '' };
  }

  /** Every active project the user sees. */
  async projects() {
    const filters = [{ active: { operator: '=', values: ['t'] } }];
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
      pageSize: String(PAGE_SIZE),
    });
    return this.collection(`/api/v3/projects?${params}`);
  }

  async workPackages(query) {
    return this.collection(workPackagesQuery(query));
  }

  /** The types enabled in a project, in their order. */
  async types(projectId) {
    return this.collection(`/api/v3/projects/${encodeURIComponent(String(projectId))}/types`);
  }

  /** Create a work package; `dueDate` `YYYY-MM-DD` or omitted. Returns the work package. */
  async createWorkPackage(projectId, { subject, typeId, dueDate }) {
    const json = {
      subject,
      ...(dueDate ? { dueDate } : {}),
      _links: { type: { href: `/api/v3/types/${typeId}` } },
    };
    return this.send(`/api/v3/projects/${encodeURIComponent(String(projectId))}/work_packages`, {
      method: 'POST',
      json,
    });
  }
}
