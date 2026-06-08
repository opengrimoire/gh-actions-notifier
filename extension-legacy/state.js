const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const STATE_DIRECTORY_NAME = 'github-actions-notifier';
const STATE_FILE_NAME = 'state.json';

function getStatePath() {
  return GLib.build_filenamev([
    GLib.get_user_state_dir(),
    STATE_DIRECTORY_NAME,
    STATE_FILE_NAME
  ]);
}

function createDefaultState() {
  return {
    history: [],
    notifiedKeys: [],
    watchedRunKeys: [],
    repoEtags: {},
    firstSyncComplete: false
  };
}

function loadState() {
  const path = getStatePath();

  try {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) {
      return createDefaultState();
    }

    const result = GLib.file_get_contents(path);
    const parsed = JSON.parse(new TextDecoder().decode(result[1]));
    return normalizeState(parsed);
  } catch (error) {
    logError(error, 'Failed to load GitHub Actions Notifier state.');
    return createDefaultState();
  }
}

function saveState(state) {
  const path = getStatePath();
  const directory = GLib.path_get_dirname(path);

  try {
    GLib.mkdir_with_parents(directory, 0o700);
    GLib.file_set_contents(path, JSON.stringify(normalizeState(state), null, 2));
  } catch (error) {
    logError(error, 'Failed to save GitHub Actions Notifier state.');
  }
}

function normalizeState(value) {
  const state = createDefaultState();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return state;
  }

  if (Array.isArray(value.history)) {
    state.history = value.history.filter(item => typeof item === 'object' && item !== null);
  }

  if (Array.isArray(value.notifiedKeys)) {
    state.notifiedKeys = value.notifiedKeys.filter(item => typeof item === 'string');
  }

  if (Array.isArray(value.watchedRunKeys)) {
    state.watchedRunKeys = value.watchedRunKeys.filter(item => typeof item === 'string');
  }

  if (typeof value.repoEtags === 'object' && value.repoEtags !== null && !Array.isArray(value.repoEtags)) {
    for (const key in value.repoEtags) {
      if (typeof value.repoEtags[key] === 'string') {
        state.repoEtags[key] = value.repoEtags[key];
      }
    }
  }

  state.firstSyncComplete = value.firstSyncComplete === true;
  return state;
}
