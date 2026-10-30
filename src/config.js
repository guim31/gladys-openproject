// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One OpenProject instance (its address, and the API key of one of its
// users), read on a timer of the container.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '120', '300', '600'];

// Hours of the "due" scene event, on the due day (local time of Gladys).
export const DUE_HOURS = ['0', '7', '8', '9', '12'];

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  projects: '',
  due_hour: '8',
  allow_self_signed: false,
  poll_interval: '300',
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:8080`), or the URL copied from the browser
 * (`https://op.example.org/projects/home/work_packages`). HTTP by default.
 * A path prefix is kept (OpenProject under `/openproject`, its
 * OPENPROJECT_RAILS__RELATIVE__URL__ROOT), the API path and the known
 * screens of the web app are dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/prefix]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname
    .replace(/\/api(\/.*)?$/, '')
    .replace(
      /\/(projects|work_packages|my|login|admin|users|notifications|search|boards|calendar|team_planners|home)(\/.*)?$/,
      '',
    )
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * Whether the address is on the home network (a private or link-local IP, a
 * name without a dot, `.local`, `.lan`, `.home`, `.internal`): the devices
 * are then "local" in Gladys, else "cloud" (OpenProject's own cloud, or an
 * instance reached through the Internet).
 */
export function isLocalAddress(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes('.') && !host.includes(':')) {
    return true;
  }
  if (/\.(local|lan|home|internal|home\.arpa)$/.test(host)) {
    return true;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return host === '::1' || /^(fc|fd|fe80)/.test(host);
}

/**
 * A list of names, identifiers or ids, as typed, separated by commas or
 * semicolons (the projects to follow).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseNameList(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

const bool = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const poll = String(source.poll_interval ?? '');
  const dueHour = String(source.due_hour ?? '');
  return {
    url: parseServerUrl(typed),
    urlTyped: typed !== '',
    apiKey: typeof source.api_key === 'string' ? source.api_key.trim() : '',
    projects: parseNameList(source.projects),
    dueHour: Number(DUE_HOURS.includes(dueHour) ? dueHour : DEFAULT_CONFIG.due_hour),
    allowSelfSigned: bool(source.allow_self_signed),
    pollIntervalMs:
      Number(POLL_INTERVALS.includes(poll) ? poll : DEFAULT_CONFIG.poll_interval) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
