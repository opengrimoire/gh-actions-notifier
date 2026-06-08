# GitHub Actions Notifier

GitHub Actions Notifier is a GNOME Shell extension that shows selected GitHub Actions workflow runs in the top panel and sends desktop notifications when important runs finish.

The main target is Ubuntu 24.04 LTS with GNOME 46 on Wayland. The project also ships a legacy package path for GNOME 42-44 and a modern package path for GNOME 45-49, because GNOME 45 changed the extension import system.

## Features

- Monitor selected repositories from your user account, collaborator access, and organization memberships.
- Show active runs, recent failures, workflow names, branches, conclusions, and durations.
- Notify failures, cancellations, timed-out runs, action-required runs, and successful completion for watched runs.
- Fetch failed job logs on demand and copy bounded error excerpts to the clipboard.
- Store the GitHub token in GNOME Keyring through libsecret.
- Store non-secret preferences in GSettings.

## GitHub token

Use a fine-grained personal access token with the minimum repositories you want to monitor.

Required repository permissions:

- Metadata: read
- Actions: read

The token is stored locally in GNOME Keyring. It is not stored in GSettings, logs, or the repository.

## Development

All work should happen on the `dev` branch.

Useful commands:

```sh
pnpm test
pnpm run check:schemas
pnpm run check:js
pnpm run pack:modern
pnpm run install:modern
```

After installing locally, log out and back in if GNOME Shell does not pick up the extension immediately on Wayland.

## Publishing

Upload separate bundles to extensions.gnome.org:

- `dist/github-actions-notifier-modern@opengrimoire.github.io.shell-extension.zip`: GNOME Shell 45, 46, 47, 48, and 49.
- `dist/github-actions-notifier-legacy@opengrimoire.github.io.shell-extension.zip`: GNOME Shell 42, 43, and 44.

Do not add future GNOME Shell versions to `metadata.json` until they have been tested.
