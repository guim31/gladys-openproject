// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors and results. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// OpenProject's "work package" is "lot de travaux" in French, "Arbeitspaket"
// in German and "paquete de trabajo" in Spanish (its own translations).
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './openproject/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your OpenProject in the configuration.',
    fr: "Saisissez l'adresse de votre OpenProject dans la configuration.",
    de: 'Gib die Adresse deines OpenProject in der Konfiguration ein.',
    es: 'Introduzca la dirección de su OpenProject en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.20:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.20:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.20:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.20:8080',
  },
  noApiKey: {
    en: 'Enter the API key of an OpenProject user in the configuration.',
    fr: "Saisissez la clé d'API d'un utilisateur d'OpenProject dans la configuration.",
    de: 'Gib in der Konfiguration den API-Schlüssel eines OpenProject-Benutzers ein.',
    es: 'Introduzca la clave de API de un usuario de OpenProject en la configuración.',
  },
};

// One short explanation per error kind (src/openproject/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'OpenProject does not answer',
    fr: 'OpenProject ne répond pas',
    de: 'OpenProject antwortet nicht',
    es: 'OpenProject no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused (revoked, or its user locked?)',
    fr: "clé d'API refusée (révoquée, ou son utilisateur verrouillé ?)",
    de: 'API-Schlüssel abgelehnt (widerrufen oder sein Benutzer gesperrt?)',
    es: 'clave de API rechazada (¿revocada, o su usuario bloqueado?)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'this user may not do this (role in the project?)',
    fr: "cet utilisateur n'a pas ce droit (rôle dans le projet ?)",
    de: 'dieser Benutzer darf das nicht (Rolle im Projekt?)',
    es: 'este usuario no tiene este permiso (¿rol en el proyecto?)',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'project or type not found',
    fr: 'projet ou type introuvable',
    de: 'Projekt oder Typ nicht gefunden',
    es: 'proyecto o tipo no encontrado',
  },
  [ERROR_KINDS.INVALID]: {
    en: 'values refused',
    fr: 'valeurs refusées',
    de: 'Werte abgelehnt',
    es: 'valores rechazados',
  },
  [ERROR_KINDS.NOT_OPENPROJECT]: {
    en: 'no OpenProject API at this address',
    fr: "aucune API d'OpenProject à cette adresse",
    de: 'keine OpenProject-API unter dieser Adresse',
    es: 'no hay ninguna API de OpenProject en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests, retrying later',
    fr: 'trop de requêtes, nouvel essai plus tard',
    de: 'zu viele Anfragen, neuer Versuch später',
    es: 'demasiadas solicitudes, se reintentará más tarde',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
const as = (user, word) => (user ? ` ${word} ${user}` : '');

export const REPORT_TEXT = {
  en: {
    ok: (user, open, projects) =>
      `OpenProject OK${as(user, 'as')}: ${open} open work package(s), ${projects} followed project(s).`,
    failed: (reason) => `OpenProject: ${reason}.`,
  },
  fr: {
    ok: (user, open, projects) =>
      `OpenProject OK${as(user, 'en tant que')} : ${open} lot(s) ouvert(s), ${projects} projet(s) suivi(s).`,
    failed: (reason) => `OpenProject : ${reason}.`,
  },
  de: {
    ok: (user, open, projects) =>
      `OpenProject OK${as(user, 'als')}: ${open} offene(s) Arbeitspaket(e), ${projects} verfolgte(s) Projekt(e).`,
    failed: (reason) => `OpenProject: ${reason}.`,
  },
  es: {
    ok: (user, open, projects) =>
      `OpenProject OK${as(user, 'como')}: ${open} paquete(s) de trabajo abierto(s), ${projects} proyecto(s) seguido(s).`,
    failed: (reason) => `OpenProject: ${reason}.`,
  },
};

// Logged and shown when a project typed in the configuration does not exist.
export const UNKNOWN_PROJECTS = {
  en: (names) => `Unknown project(s) ignored: ${names}.`,
  fr: (names) => `Projet(s) inconnu(s) ignoré(s) : ${names}.`,
  de: (names) => `Unbekannte(s) Projekt(e) ignoriert: ${names}.`,
  es: (names) => `Proyecto(s) desconocido(s) ignorado(s): ${names}.`,
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  notConfigured: {
    en: 'OpenProject is not configured.',
    fr: "OpenProject n'est pas configuré.",
    de: 'OpenProject ist nicht konfiguriert.',
    es: 'OpenProject no está configurado.',
  },
  emptySubject: {
    en: 'Give the subject of the new work package.',
    fr: 'Indiquez le sujet du nouveau lot de travaux.',
    de: 'Gib den Betreff des neuen Arbeitspakets an.',
    es: 'Indique el asunto del nuevo paquete de trabajo.',
  },
  badDue: {
    en: 'Due date not understood: 2026-10-24 or +3d.',
    fr: 'Échéance incomprise : 2026-10-24 ou +3d.',
    de: 'Fälligkeit nicht verstanden: 2026-10-24 oder +3d.',
    es: 'Vencimiento no válido: 2026-10-24 o +3d.',
  },
  noProject: {
    en: 'Give the project, or follow one in the configuration.',
    fr: 'Indiquez le projet, ou suivez-en un dans la configuration.',
    de: 'Gib das Projekt an oder verfolge eines in der Konfiguration.',
    es: 'Indique el proyecto, o siga uno en la configuración.',
  },
  projectNotFound: {
    en: 'No project has this name or identifier in OpenProject (for this user).',
    fr: 'Aucun projet ne porte ce nom ou cet identifiant dans OpenProject (pour cet utilisateur).',
    de: 'Kein Projekt in OpenProject hat diesen Namen oder diese Kennung (für diesen Benutzer).',
    es: 'Ningún proyecto tiene este nombre o identificador en OpenProject (para este usuario).',
  },
  projectAmbiguous: {
    en: 'Several projects have this name: give its identifier (in its address) instead.',
    fr: 'Plusieurs projets portent ce nom : indiquez plutôt son identifiant (dans son adresse).',
    de: 'Mehrere Projekte haben diesen Namen: Gib stattdessen seine Kennung an (in seiner Adresse).',
    es: 'Varios proyectos tienen este nombre: indique su identificador (en su dirección).',
  },
  noType: {
    en: 'This project has no work package type enabled.',
    fr: "Ce projet n'a aucun type de lot activé.",
    de: 'In diesem Projekt ist kein Arbeitspaket-Typ aktiviert.',
    es: 'Este proyecto no tiene ningún tipo de paquete de trabajo activado.',
  },
  typeNotFound: {
    en: 'No type of this project has this name (Task, Milestone…).',
    fr: 'Aucun type de ce projet ne porte ce nom (Tâche, Jalon…).',
    de: 'Kein Typ dieses Projekts hat diesen Namen (Aufgabe, Meilenstein…).',
    es: 'Ningún tipo de este proyecto tiene este nombre (Tarea, Hito…).',
  },
  typeAmbiguous: {
    en: 'Several types have this name: give its id instead.',
    fr: 'Plusieurs types portent ce nom : indiquez plutôt son identifiant.',
    de: 'Mehrere Typen haben diesen Namen: Gib stattdessen seine ID an.',
    es: 'Varios tipos tienen este nombre: indique su identificador.',
  },
};

// The sentence of the "Read today's work packages" scene action, for a
// message or a voice announcement.
const join = (names, and) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;

export const TODAY_TEXT = {
  en: {
    none: 'No work package due today.',
    list: (count, names) => `${count} work package(s) due by tonight: ${join(names, 'and')}.`,
    overdue: (count) => ` ${count} overdue.`,
  },
  fr: {
    none: "Aucun lot à échéance aujourd'hui.",
    list: (count, names) => `${count} lot(s) à finir ce soir : ${join(names, 'et')}.`,
    overdue: (count) => ` ${count} en retard.`,
  },
  de: {
    none: 'Heute ist kein Arbeitspaket fällig.',
    list: (count, names) =>
      `${count} Arbeitspaket(e) bis heute Abend fällig: ${join(names, 'und')}.`,
    overdue: (count) => ` ${count} überfällig.`,
  },
  es: {
    none: 'Ningún paquete de trabajo vence hoy.',
    list: (count, names) => `${count} paquete(s) de trabajo para esta noche: ${join(names, 'y')}.`,
    overdue: (count) => ` ${count} atrasado(s).`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, render(language)]));
