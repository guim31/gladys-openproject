# OpenProject for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the work packages of an [OpenProject](https://www.openproject.org)
(self-hosted Community edition, or OpenProject's cloud) into Gladys: the open
ones, those due today, the overdue ones, those assigned to you, those done
today and the next due date, scene triggers when a work package is assigned to
you, comes due or becomes overdue, and work packages created from a scene.

> **Feedback welcome.** The integration was checked against a real OpenProject
> server (Docker image `openproject/openproject:16`, Community edition, October
> 2026), but not yet in everyday use with a real Gladys. Please report what
> works and what does not in the
> [issues](https://github.com/guim31/gladys-openproject/issues).

## Features

- **One device for the whole instance**, and **one per followed project** (by
  name or identifier, 20 at most), with _open work packages_, _due today_,
  _overdue_, _assigned to me_, _done today_ and the _next due date_ (text).
- **Dashboard widget** "Today's work packages": two tiles and the work packages
  due by tonight (10 at most, overdue first), for the instance or a project,
  optionally only those assigned to you.
- **Scene triggers**: _OpenProject work package assigned to me_,
  _OpenProject work package due_ (on the due day, at a time chosen in the
  configuration) and _OpenProject work package overdue_ (at midnight), with
  the work package, its project, type, status, assignee, due date and address
  as variables. Once each, across restarts.
- **Scene actions**: _Create an OpenProject work package_ (project, type,
  subject, optional due date such as `2026-10-24` or `+3d`) and _Read today's
  OpenProject work packages_ (a sentence for a message or a voice
  announcement).
- On time: besides the refresh interval (1 to 10 minutes, 5 by default), the
  integration reads OpenProject at the time of the "due" events and at local
  midnight (the time zone of Gladys).
- A **Test the connection** button, a connection status that names the
  problem (key refused, no OpenProject API at this address, certificate…), and
  a transport badge per device (local for a home address, cloud otherwise).
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- An **OpenProject** reachable from Gladys, and the **API key** of one of its
  users (My account → Access tokens → API). The integration sees what this
  user sees and acts as this user.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-openproject`
   (or install **OpenProject** from the catalog once it is listed).
2. In **Configuration**, enter the address of OpenProject
   (`http://192.168.1.20:8080`, `https://projects.example.org`…) and the API
   key, and optionally the projects to follow. Save, then click **Test the
   connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration uses the [API v3](https://www.openproject.org/docs/api/) of
OpenProject (HAL+JSON), with the API key in HTTP Basic (`apikey:<key>`):

| Request                                                      | Use                                                |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `GET /api/v3/users/me`                                       | the user of the key (once)                         |
| `GET /api/v3/projects` (active)                              | the projects, to follow some by name or identifier |
| `GET /api/v3/work_packages` open, `groupBy=project`, page 0  | the open work packages, per project                |
| `GET /api/v3/work_packages` closed, updated today, `groupBy` | the work packages done today, per project          |
| `GET /api/v3/work_packages` open, overdue, `groupBy`         | every overdue one, per project                     |
| `GET /api/v3/work_packages` open, overdue, most recent first | the overdue ones of the widget and of the sentence |
| `GET /api/v3/work_packages` open, due yesterday to 60 days   | due today, next due date, the due events           |
| `GET /api/v3/work_packages` open, assignee `me`              | assigned to me, and its trigger                    |
| `GET /api/v3/projects/{id}/types`, `POST …/work_packages`    | create a work package                              |

OpenProject is read on a timer of the container; the devices are published
with `should_poll: false`. States are published only when they change, and
every 12 hours otherwise. The due events are the moments (the chosen time on
the due day, the end of the due day) crossed since the previous reading; an
assignment is an open work package assigned to the user that was not at the
previous reading. The time of the last reading and the ids of the assigned
work packages are kept in `/data/openproject-state.json`. OpenProject's
webhooks are not used: a reading every few minutes is enough for these uses,
and needs no change on the OpenProject side.

## Checked on a real OpenProject, and what was not

Checked against `openproject/openproject:16` (all-in-one image, Community
edition) in a Docker network, on 30 October 2026: two projects, a second user,
tasks due in the past, today, after a weekend, a milestone, undated ones, two
closed today; the work package queries of a reading, creation of tasks and
milestones, the error answers (wrong key, no key, unknown project, invalid
date, the HTML page outside the API). The real answers are in
`test/fixtures/openproject/` and drive the tests, and a test checks that the
in-memory OpenProject of the tests answers the captured queries exactly like
the server. The whole integration then ran in its own container under the
Gladys sandbox limits (read-only root, no capabilities, 256 MB, 86 MB used)
against that server and the SDK's fake Gladys: counters, the "assigned to me"
trigger (once, not again after a restart), creation, the widget, the errors.

Not checked: a real Gladys instance, OpenProject's cloud, an Enterprise
edition, older OpenProject versions (API v3 and the filters used have existed
for years), an OpenProject behind a reverse proxy with a path prefix, an
instance with more than 1000 open dated work packages.

## Limitations

- Creates work packages; does not change, close, assign or delete them, nor
  read their comments, attachments or time entries.
- A change made in OpenProject shows up within the refresh interval.
- OpenProject keeps no closing date: "done today" counts the closed work
  packages last updated today.
- The counters of a project do not include its subprojects.
- OpenProject moves a due date on a non-working day to the next working day:
  the scene action returns the date kept.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory OpenProject (`test/helpers/fakeOpenProject.js`) built from
real answers. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [OpenProject](https://github.com/opf/openproject) by OpenProject GmbH and
  its contributors (GPL-3.0): the integration only talks to its API; no code
  was copied. The cover uses the official white OpenProject logo shipped with
  the application (`app/assets/images/logo_openproject_white_big.png`), to
  name the service.
- The architecture, the scene triggers and actions, the widget and the
  conformity tests follow [gladys-wekan](https://github.com/guim31/gladys-wekan),
  itself built on [gladys-planka](https://github.com/guim31/gladys-planka) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by OpenProject
GmbH. OpenProject and its logo are trademarks of OpenProject GmbH.

## License

Apache-2.0
