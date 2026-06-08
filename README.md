# GitHub Actions Notifier

GitHub Actions Notifier is a GNOME Shell extension that monitors GitHub Actions runs for selected repositories and surfaces the results directly in the desktop panel.

The extension is designed for developers who work with many workflows and want operating system notifications, quick status checks, run duration, GitHub links, and copyable summaries without keeping the Actions page open.

The main target is Ubuntu 24.04 LTS with GNOME 46 on Wayland. The repository also ships a legacy build for GNOME 42, 43, and 44, plus a modern build for GNOME 45, 46, 47, 48, and 49.

## What it does

- Monitors selected repositories from the authenticated GitHub account, collaborator access, and organization memberships.
- Shows recent workflow runs grouped by repository.
- Uses status dots for running, successful, failed, neutral, and unknown runs.
- Shows display title, workflow name, branch, duration, actor, and event.
- Sends desktop notifications for failures and other negative conclusions.
- Can notify successful completion for runs explicitly watched from the panel menu.
- Can notify every completion when enabled in preferences.
- Opens workflow runs in GitHub.
- Copies a compact run summary to the clipboard.
- Loads failed job logs on demand and copies bounded error excerpts.
- Stores the GitHub token in GNOME Keyring through libsecret.
- Stores non-secret preferences in GSettings.

## Compatibility

GNOME 45 changed the extension import system, so the project keeps two extension source trees:

- `extension-modern`: GNOME Shell 45, 46, 47, 48, and 49.
- `extension-legacy`: GNOME Shell 42, 43, and 44.

The two trees intentionally contain similar logic. Keep both in sync when changing shared behavior.

Do not add future GNOME Shell versions to `metadata.json` until they have been tested locally or by a reliable user on that Shell version.

## Requirements

For running the extension:

- GNOME Shell.
- GNOME Keyring or another Secret Service implementation supported by libsecret.
- A GitHub fine-grained personal access token.

For development and packaging:

- `pnpm`.
- `gjs`.
- `glib-compile-schemas`.
- `gnome-extensions`.

On Ubuntu 24.04, these GNOME tools are usually available from the GNOME Shell and GLib packages.

## GitHub token

Create a fine-grained personal access token with access only to the repositories you want to monitor.

Required repository permissions:

- Metadata: read.
- Actions: read.

The token is stored locally in GNOME Keyring. It is not stored in GSettings, logs, the local state file, or this repository.

Organization repositories may require the token to be created for the organization resource owner or approved by organization policy. If a repository does not appear in preferences, check the token resource owner, repository access, and organization token rules.

## Local installation

Install dependencies first:

```sh
pnpm install
```

Build and install the modern extension on GNOME 45 or newer:

```sh
pnpm run install:modern
```

Then enable the extension from GNOME Extensions, Extension Manager, or this command:

```sh
gnome-extensions enable github-actions-notifier@opengrimoire.github.io
```

On Wayland, GNOME Shell may not fully reload an extension after local installation. If the extension does not appear or old code is still running, log out and back in.

## Configuration

Open extension preferences and:

1. Save a GitHub token.
2. Refresh the repository list.
3. Select the repositories to monitor.
4. Adjust notification and polling settings.

The panel menu refreshes when opened if the last refresh is old enough. It also polls automatically. If the token exists but GNOME Keyring is still starting after login, the menu shows that it is waiting for GNOME Keyring and retries.

## Panel behavior

The panel indicator reflects the current state:

- Setup icon: no token has been configured.
- Refresh icon: a token is expected, but GNOME Keyring is not ready or the token cannot be read yet.
- Folder icon: a token exists, but no repositories are selected.
- Error icon with a count: recent selected runs include failures or other negative conclusions.
- Running icon with a count: selected runs are active.
- Success icon: selected repositories have recent runs and no active or failing runs.

The menu groups runs by repository. Each run can be expanded to show details, copy a summary, open GitHub, watch active runs for success notifications, and load failed logs when available.

## Data storage

Secret data:

- GitHub token: GNOME Keyring, under the extension token schema.

Non-secret settings:

- GSettings schema: `org.gnome.shell.extensions.github-actions-notifier`.
- Selected repositories.
- Polling intervals.
- History retention.
- Notification toggles.
- A `has-token` boolean used only to know whether a token is expected while keyring startup is delayed.

Local state:

- Path: `~/.local/state/github-actions-notifier/state.json`.
- Recent run history.
- Notification dedupe keys.
- Watched active runs.
- ETags for GitHub API caching.
- First sync completion flag.

The local state file does not contain the GitHub token.

## Development

All implementation work should start from the updated `dev` branch. Use descriptive branch prefixes such as `feature/`, `fix/`, or `docs/`.

Useful checks:

```sh
pnpm test
pnpm run check:schemas
pnpm run check:js
pnpm run pack
```

Useful development command:

```sh
pnpm run install:modern
```

After code changes, prefer testing the modern extension on GNOME 46 first, then package both modern and legacy bundles before publishing.

## Architecture

Important files:

- `extension-modern/extension.js`: GNOME 45 and newer panel indicator, menu, polling, notifications, clipboard, and run actions.
- `extension-modern/prefs.js`: libadwaita preferences window for token, repositories, polling, and notification settings.
- `extension-modern/core.js`: pure helpers for normalization, severity, duration, notification policy, history, and log excerpts.
- `extension-modern/github.js`: GitHub REST client using libsoup.
- `extension-modern/secrets.js`: GNOME Keyring token reads and writes through libsecret.
- `extension-modern/state.js`: local JSON state loading and saving.
- `extension-modern/schemas`: GSettings schema.
- `extension-legacy`: equivalent source tree for GNOME 42 through 44.
- `tests/core.test.mjs`: Node tests for pure helper behavior.

Keep logic that can be tested outside GNOME Shell in `core.js`. GNOME Shell APIs should stay in `extension.js` and preferences APIs should stay in `prefs.js`.

## GitHub API behavior

The extension uses GitHub REST API version `2022-11-28`.

Repository discovery uses the authenticated account repositories endpoint with owner, collaborator, and organization membership affiliations. Workflow runs are fetched per selected repository. ETags are stored per repository to reduce response size and rate-limit pressure.

Failed logs are not downloaded during normal polling. They are loaded only when requested from an expanded failed run.

## Packaging

Build both GNOME extension bundles:

```sh
pnpm run pack
```

Generated files are written to `dist`:

- `github-actions-notifier-modern@opengrimoire.github.io.shell-extension.zip`.
- `github-actions-notifier-legacy@opengrimoire.github.io.shell-extension.zip`.

The `dist` directory is generated output and should not be committed.

## Publishing

Upload separate bundles to extensions.gnome.org:

- Modern bundle for GNOME Shell 45 through 49.
- Legacy bundle for GNOME Shell 42 through 44.

Before publishing:

1. Run all checks.
2. Install and smoke test the modern bundle locally.
3. Confirm `metadata.json` Shell versions match the bundle being uploaded.
4. Confirm no token or local state file is included in the package.
5. Keep future Shell versions out of metadata until tested.

## Troubleshooting

If the extension shows that it is waiting for GNOME Keyring after login, wait briefly, open the menu again, or open preferences. GNOME Keyring can start later than GNOME Shell.

If repositories do not load, check that the token has Metadata read and Actions read for the repositories and that organization token policies allow access.

If notifications do not appear, check GNOME notification settings and confirm the relevant notification toggles are enabled in preferences.

If runs are stale, use the refresh button in the panel menu and check for GitHub API errors in Looking Glass or GNOME Shell logs.

If local install appears unchanged on Wayland, log out and back in after installing the bundle.
