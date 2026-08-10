# ADR-0017 — Multi-project workspaces

## Context

Users need separate library + arrangement spaces (e.g. different field sites or pieces).

## Decision

A `Project` is a workspace: `Session` and `Sample` carry `projectId`. Arrangement tracks/clips already hang off `Project`. `UserPrefs.currentProjectId` selects the active workspace; the header switcher creates / renames / switches projects.

## Consequences

Library, capture, and sequencer drawer filter by the current project. Existing data migrates to a default project (Dexie v5). Cross-project sample reuse is out of scope.
