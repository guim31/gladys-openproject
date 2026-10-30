// -----------------------------------------------------------------------------
// Gladys devices: one for the OpenProject instance (every project the user
// sees), and one per followed project.
//
// Identity: `instance` / `instance` for the instance (one per integration),
// `project` / `project-<id>` for a project, the numeric id OpenProject gives it
// (stable, never its name nor its identifier, both editable): renaming a
// project keeps its device.
//
// Features (category/type couples of the core table, test/gladys-rules.test.js),
// definitions in src/openproject/model.js:
//   - open, due today, overdue, assigned to me, done today:
//     counter-sensor/integer;
//   - next due date: text/text, the work package and its day ("None" when
//     nothing is planned: a text state is never empty).
//
// The devices are published with should_poll: false: the integration reads
// OpenProject on its own timer (src/hub.js), every 1 to 10 minutes.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const INSTANCE_TYPE = 'instance';
export const PROJECT_TYPE = 'project';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  OPEN: 'open',
  DUE_TODAY: 'due_today',
  OVERDUE: 'overdue',
  MINE: 'assigned_to_me',
  DONE_TODAY: 'done_today',
  NEXT_DUE: 'next_due',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.OPEN]: 'Open work packages',
    [FEATURE_KEYS.DUE_TODAY]: 'Due today',
    [FEATURE_KEYS.OVERDUE]: 'Overdue',
    [FEATURE_KEYS.MINE]: 'Assigned to me',
    [FEATURE_KEYS.DONE_TODAY]: 'Done today',
    [FEATURE_KEYS.NEXT_DUE]: 'Next due date',
  },
  fr: {
    [FEATURE_KEYS.OPEN]: 'Lots ouverts',
    [FEATURE_KEYS.DUE_TODAY]: "À échéance aujourd'hui",
    [FEATURE_KEYS.OVERDUE]: 'En retard',
    [FEATURE_KEYS.MINE]: 'Assignés à moi',
    [FEATURE_KEYS.DONE_TODAY]: "Terminés aujourd'hui",
    [FEATURE_KEYS.NEXT_DUE]: 'Prochaine échéance',
  },
  de: {
    [FEATURE_KEYS.OPEN]: 'Offene Arbeitspakete',
    [FEATURE_KEYS.DUE_TODAY]: 'Heute fällig',
    [FEATURE_KEYS.OVERDUE]: 'Überfällig',
    [FEATURE_KEYS.MINE]: 'Mir zugewiesen',
    [FEATURE_KEYS.DONE_TODAY]: 'Heute erledigt',
    [FEATURE_KEYS.NEXT_DUE]: 'Nächste Fälligkeit',
  },
  es: {
    [FEATURE_KEYS.OPEN]: 'Paquetes de trabajo abiertos',
    [FEATURE_KEYS.DUE_TODAY]: 'Vencen hoy',
    [FEATURE_KEYS.OVERDUE]: 'Atrasados',
    [FEATURE_KEYS.MINE]: 'Asignados a mí',
    [FEATURE_KEYS.DONE_TODAY]: 'Terminados hoy',
    [FEATURE_KEYS.NEXT_DUE]: 'Próximo vencimiento',
  },
};

// Published on "next due date" when no open work package has a due day ahead.
export const NOTHING = { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguno' };

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 100000;
const TEXT_MAX_LENGTH = 100;
const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

const COUNTER = {
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: COUNTER_MAX,
};

const TEXT = {
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: false,
  // NOT NULL in the core, even for a text (422 on "Add to Gladys" otherwise).
  min: 0,
  max: 0,
};

export const instanceIds = (gladys) => gladys.externalIds(INSTANCE_TYPE, 'instance');
export const projectIds = (gladys, projectId) =>
  gladys.externalIds(PROJECT_TYPE, `project-${projectId}`);

/** The ids of a scope: the instance (`null`) or a project. */
export const scopeIds = (gladys, projectId) =>
  projectId === null ? instanceIds(gladys) : projectIds(gladys, projectId);

export const projectDeviceName = (name) => `OpenProject ${name}`.slice(0, 60);

/**
 * @param {object} gladys
 * @param {{ id: string, name: string }|null} project null: the instance device
 * @param {string} [language]
 */
export function buildDevice(gladys, project, language = 'en') {
  const ids = scopeIds(gladys, project ? project.id : null);
  const names = NAMES[language] ?? NAMES.en;
  const counter = (key) => ({ ...COUNTER, name: names[key], external_id: ids.feature(key) });
  return {
    name: project ? projectDeviceName(project.name) : 'OpenProject',
    external_id: ids.device,
    should_poll: false,
    features: [
      counter(FEATURE_KEYS.OPEN),
      counter(FEATURE_KEYS.DUE_TODAY),
      counter(FEATURE_KEYS.OVERDUE),
      counter(FEATURE_KEYS.MINE),
      counter(FEATURE_KEYS.DONE_TODAY),
      { ...TEXT, name: names.next_due, external_id: ids.feature(FEATURE_KEYS.NEXT_DUE) },
    ],
  };
}

/** A local day, in words: "Fri 24 Oct". */
export function formatDay(ms, { language, timeZone }) {
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(ms));
}

/** "Work package · Fri 24 Oct", in the language of the feature names. */
export function nextDueText(summary, { language, timeZone }) {
  if (!summary.next) {
    return NOTHING[language] ?? NOTHING.en;
  }
  const when = formatDay(summary.next.dueAt, { language, timeZone });
  const room = TEXT_MAX_LENGTH - when.length - 3;
  const name =
    summary.next.name.length > room
      ? `${summary.next.name.slice(0, room - 1).trimEnd()}…`
      : summary.next.name;
  return `${name} · ${when}`;
}

/**
 * The states of every feature of a device, in the `publishStates` format:
 * `state` for a number, `text` for a text.
 * @param {string|null} projectId null: the instance device
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function featureStates(gladys, projectId, summary, { language, timeZone }) {
  const ids = scopeIds(gladys, projectId);
  const counter = (key, value) => ({
    device_feature_external_id: ids.feature(key),
    state: Math.min(COUNTER_MAX, value),
  });
  return [
    counter(FEATURE_KEYS.OPEN, summary.open),
    counter(FEATURE_KEYS.DUE_TODAY, summary.dueToday),
    counter(FEATURE_KEYS.OVERDUE, summary.overdue),
    counter(FEATURE_KEYS.MINE, summary.mine),
    counter(FEATURE_KEYS.DONE_TODAY, summary.done),
    {
      device_feature_external_id: ids.feature(FEATURE_KEYS.NEXT_DUE),
      text: nextDueText(summary, { language, timeZone }),
    },
  ];
}
