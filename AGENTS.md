# Repository instructions

This repository builds a GNOME Shell extension named GitHub Actions Notifier. It monitors selected GitHub Actions workflow runs, shows them in the GNOME panel, sends desktop notifications, and exposes copy and GitHub navigation actions.

## Branch policy

- Start implementation work from an updated `dev` branch.
- Create focused branches from `dev`.
- Use descriptive branch prefixes such as `feature/`, `fix/`, or `docs/`.
- Ask before committing, pushing, deleting branches, or creating pull requests unless the developer has explicitly requested that exact operation.

## Package manager and commands

Use `pnpm`.

Primary checks:

```sh
pnpm test
pnpm run check:schemas
pnpm run check:js
pnpm run pack
```

Local modern install:

```sh
pnpm run install:modern
```

On GNOME Wayland, local extension updates may require logging out and back in.

## Architecture

The repository has two GNOME extension source trees because GNOME 45 changed extension imports.

- `extension-modern`: GNOME Shell 45 through 49.
- `extension-legacy`: GNOME Shell 42 through 44.

Keep both trees behaviorally aligned unless a GNOME version difference requires otherwise.

Important modules:

- `extension.js`: panel indicator, menu rendering, polling lifecycle, notifications, clipboard, URI opening, and user actions.
- `prefs.js`: preferences UI for token storage, repository selection, notification toggles, polling intervals, and history retention.
- `core.js`: pure helpers for API normalization, status classification, duration formatting, notification decisions, history merging, pruning, and failed log excerpts.
- `github.js`: GitHub REST API client using libsoup.
- `secrets.js`: GNOME Keyring access through libsecret.
- `state.js`: local JSON state storage.
- `schemas/org.gnome.shell.extensions.github-actions-notifier.gschema.xml`: GSettings schema.
- `tests/core.test.mjs`: Node tests for pure helper behavior.

Prefer putting testable logic in `core.js`. Keep GNOME Shell API usage inside `extension.js`. Keep preferences API usage inside `prefs.js`.

## Runtime behavior

The extension stores the GitHub token in GNOME Keyring. It does not store token values in GSettings, state files, logs, or docs.

GSettings stores non-secret preferences:

- Selected repositories.
- Polling intervals.
- History retention.
- Notification toggles.
- `has-token`, which only indicates that a token is expected while GNOME Keyring may still be starting.

Local state is saved at `~/.local/state/github-actions-notifier/state.json` and contains recent run history, notification dedupe keys, watched active runs, repository ETags, and first sync state.

## GitHub API notes

The extension uses GitHub REST API version `2022-11-28`.

Repository discovery lists repos available to the authenticated account through owner, collaborator, and organization membership affiliations.

Workflow runs are fetched per selected repository. ETags are stored per repository to reduce rate-limit pressure. Failed logs are downloaded only when the user requests them from an expanded failed run.

Token guidance:

- Fine-grained personal access token.
- Metadata read permission.
- Actions read permission.
- Repository access limited to monitored repositories when possible.

Organization repositories may require organization token approval or a token created for the organization resource owner.

## UI expectations

Keep the panel menu compact and practical. It should prioritize current developer workflow over explanation text.

Current menu structure:

- Header row with last refresh or current status.
- Icon button for refresh.
- Icon button for preferences.
- Repository sections.
- Recent run rows with colored status dots.
- Expanded run details with workflow line, metadata line, copy summary, GitHub link, watch action when active, and failed log actions when relevant.

Avoid adding extra instructional text inside the extension UI unless it directly resolves an empty or error state.

## GNOME compatibility

Ubuntu 24.04 LTS with GNOME 46 on Wayland is the primary target.

Do not add future GNOME Shell versions to `metadata.json` until tested. Keep modern and legacy metadata separate.

The modern extension uses ESM imports from GNOME 45 and newer. The legacy extension uses the older GNOME Shell import style.

## Editing rules

Use JSDoc for JavaScript.

Do not introduce TypeScript. If TypeScript is ever added later, do not use `any`.

Validate unknown GitHub API data before using it as normalized data. Existing helper functions in `core.js` should be reused or extended for this.

Avoid hardcoded repository names, user names, or organization names in extension behavior. Keep values configurable or derived from GitHub API responses.

Do not commit generated files:

- `dist`.
- `node_modules`.
- compiled GSettings schema files.

## Publishing notes

The project publishes two bundles to extensions.gnome.org:

- Modern bundle for GNOME Shell 45 through 49.
- Legacy bundle for GNOME Shell 42 through 44.

Before publishing, run all checks, install and smoke test the modern bundle locally, and inspect bundle contents for secrets or local state.
