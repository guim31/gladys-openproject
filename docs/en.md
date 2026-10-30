# OpenProject

The work packages of your [OpenProject](https://www.openproject.org) in
Gladys: the open ones, those due today, the overdue ones, those assigned to
you, those done today and the next due date, for the whole instance and for
the projects you choose. A scene reacts when a work package is assigned to
you, comes due or becomes overdue, another one creates "check the smoke
detectors" every month, and Gladys can read today's work packages every
morning.

> **Feedback welcome.** This integration was tested against a real OpenProject
> server (Docker image `openproject/openproject:16`, Community edition, October
> 2026), not yet in daily use. If something does not work as described, say so
> on the [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-openproject/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- An **OpenProject** Gladys can reach: self-hosted (the Community edition is
  enough) or in OpenProject's cloud.
- An **API key** of an OpenProject user: in OpenProject, avatar → **My
  account** → **Access tokens** → **API** → **+ API token**. If the API
  section is missing, an administrator turns it on in **Administration** →
  **API and webhooks** ("Enable REST web service").

The integration sees the projects and work packages this user sees, and acts
**in their name**: the work packages created from Gladys have them as author,
and "Assigned to me" counts the work packages assigned to them. A dedicated
user, member of the projects to follow, is a good idea.

## Set up

1. In Gladys, **Integrations** → install **OpenProject**.
2. On the **Configuration** screen, fill in:
   - **Address**: the address of OpenProject as in the browser, for example
     `http://192.168.1.20:8080`, or `https://projects.example.org` behind a
     reverse proxy (a prefix such as `/openproject` is kept);
   - **API key**.
3. Options:
   - **Followed projects**: names or identifiers (the one in the project's
     address, `/projects/home`) separated by commas, 20 at most. Each gets its
     device, besides the one of the whole instance. Empty: the instance device
     only;
   - **Time of the "due" event**: the time of the **OpenProject work package
     due** trigger, on the due day (08:00 by default);
   - **Accept self-signed certificates**: for an `https://` address with a
     self-signed certificate, on your own server only;
   - **Refresh interval**: 1 to 10 minutes (5 by default). Event times and
     midnight are always followed on time, whatever the interval;
   - **Language of the feature names**: the names given to the features when
     a device is added (French by default), and the texts sent to scenes.
4. Save, then **Test the connection**: it reads OpenProject and reports the
   user of the key, the number of open work packages and of followed projects.
5. In the **Discovery** tab, add the devices you want.

## Devices

**OpenProject**, for the whole instance (every project the user sees), and
**OpenProject _project_** for each followed project, with these features:

| Feature              | What it shows                                                                   |
| -------------------- | ------------------------------------------------------------------------------- |
| `Open work packages` | the work packages whose status is not a closed one                              |
| `Due today`          | the open work packages whose finish date is today                               |
| `Overdue`            | the open work packages whose finish date has passed                             |
| `Assigned to me`     | the open work packages assigned to the user of the key                          |
| `Done today`         | the closed work packages last changed today                                     |
| `Next due date`      | the open work package with the nearest finish date, today included; `None` else |

A work package is **open** as long as its status is not marked "closed" in
OpenProject (`Closed`, `Rejected` in the default setup). Its due date is its
**finish date**, or the date of a **milestone**. "Today" is the day in the
time zone of Gladys. OpenProject keeps no closing date: "Done today" counts
the closed work packages changed today, so also one closed earlier and
commented on today. The counters of a project do not include its subprojects;
the instance device counts everything.

## Dashboard

The **Today's work packages** widget shows two tiles (today, overdue) and the
list of the work packages to finish by tonight (10 at most), the overdue ones
first with their date, then today's, with their project. Choose a project
device in the widget settings to see only its work packages, and tick **Only
those assigned to me** to see only yours. When nothing is due, the widget says
so and gives the next due date. Projects carry the name given in Gladys once
their device is added.

The counters can also go on the dashboard like any device feature.

## Scenes

### Triggers

- **OpenProject work package assigned to me**: an open work package is now
  assigned to the user of the key: it was just assigned to them, they created
  it in their name, or one assigned to them was reopened.
- **OpenProject work package due**: on its due day, at the time chosen in the
  configuration, a work package is still open.
- **OpenProject work package overdue**: at midnight, a work package due that
  day is still open. Once per work package and due date.

Filter: the project (a project device, not the instance one). Data passed to
the actions: the work package, its id, its project, its type, its status, the
assignee, its due date (`YYYY-MM-DD`) and its address in OpenProject.

A change is seen at the next reading: within the refresh interval. A due date
moved by hand to a day already over, or to today after the time of the "due"
event, fires no "due" event (the "overdue" one still comes at midnight); the
same goes for a later time chosen in the configuration once today's has
passed. A restart fires nothing
twice; a work package assigned while the integration was stopped fires at its
restart, as does a due date less than an hour old.

### Actions

- **Create an OpenProject work package**: a subject; the project by its name
  or identifier (empty: the first followed project); the type by its name,
  exactly as in OpenProject (empty: the project's first type that is not a
  milestone, `Task` by default); an optional **due date**: `2026-10-24`, or
  `+3d` for in three days. The work package is created in the name of the
  user of the key, unassigned. OpenProject moves a due date on a non-working
  day (the weekend, by default) to the next working day: the result gives the
  date kept. Results: the work package, its id, its address, its project, its
  type, its due date.
- **Read today's OpenProject work packages**: the work packages to finish by
  tonight as a sentence (`3 work package(s) due by tonight: …. 1 overdue.`),
  for the whole instance or a project, and for every work package or those
  assigned to the user. Results: the sentence, the number of work packages
  due by tonight, of overdue ones. Send the sentence in a message, or have
  Gladys say it.

The fields accept scene variables, for example
`{{triggerEvent.data.work_package}}`.

### Scene ideas

- At 08:00, **Read today's OpenProject work packages** (assigned to me), then
  send the sentence on Telegram.
- **OpenProject work package assigned to me**: send the subject and the
  address of the work package in a message.
- **OpenProject work package overdue** in the `Home` project: turn the
  reminder lamp orange.
- On the first of the month, **Create an OpenProject work package**
  `Check the smoke detectors` in `home`, due `+7d`.

## Troubleshooting

- **"OpenProject does not answer"**: check the address and port from the
  Gladys machine (the address opens OpenProject in a browser).
- **"API key refused"**: the key was revoked, or its user is locked: create a
  new key.
- **"No OpenProject API at this address"**: the address answers, but not with
  the OpenProject API: check the port and the prefix.
- **"The address redirects"**: enter the `https://` address.
- **"This user may not do this"**: their role in the project does not allow
  creating work packages.
- **"Values refused"**: OpenProject refused the work package; the rest of the
  message is its explanation (a badly written date, a required custom
  field…).
- **A project is missing**: the user must be a member; a name typed in
  **Followed projects** that matches no project is ignored, and **Test the
  connection** reports it. Archived projects are left out.
- **"Several projects have this name"**: give its identifier.
- Logs: `LOG_LEVEL=debug` on the container shows each reading.

## Limits

- OpenProject is read every 1 to 10 minutes (and at the event times and at
  midnight): a change in OpenProject shows in Gladys within that delay.
  OpenProject's webhooks are not used. Each reading makes seven requests
  (projects, three counts, overdue, dated and assigned work packages).
- Every overdue work package is counted; the lists hold the 1000 most recent
  overdue ones, 1000 due from yesterday to 60 days ahead and 1000 assigned
  ones at most; beyond, the logs say so.
- The integration creates work packages; it does not change, close, assign or
  delete them, and reads neither their comments, nor their attachments, nor
  the time spent.
- The API key is kept by Gladys in the configuration of the integration and
  sent only to the configured address. Gladys keeps no OpenProject data
  outside `/data/openproject-state.json` (the time of the last reading and the
  ids of the assigned work packages, so no event fires twice).
- Not affiliated with OpenProject GmbH. OpenProject is a trademark of
  OpenProject GmbH.
