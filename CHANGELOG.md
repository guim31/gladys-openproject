# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: the work packages of an OpenProject (self-hosted or cloud,
  API v3 with an API key) in Gladys 5.1.0 or later.
- One device for the whole instance and one per followed project: open work
  packages, due today, overdue, assigned to me, done today (counters) and the
  next due date (text).
- Scene triggers "OpenProject work package assigned to me", "OpenProject work
  package due" (at a chosen time on the due day) and "OpenProject work package
  overdue" (at midnight), once each, across restarts.
- Scene actions "Create an OpenProject work package" (project, type, subject,
  due date) and "Read today's OpenProject work packages" (a sentence for a
  message or a voice announcement).
- Dashboard widget "Today's work packages": due today and overdue ones, 10 at
  most, for the instance or a project, optionally only those assigned to me.
- "Test the connection" button, a connection status that names the problem,
  local or cloud transport badges, every text in English, French, German and
  Spanish.
