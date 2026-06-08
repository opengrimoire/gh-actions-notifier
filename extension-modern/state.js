import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const STATE_DIRECTORY_NAME = 'github-actions-notifier';
const STATE_FILE_NAME = 'state.json';

/**
 * Returns the extension state path.
 *
 * @returns {string} State file path.
 */
export function getStatePath() {
  return GLib.build_filenamev([
    GLib.get_user_state_dir(),
    STATE_DIRECTORY_NAME,
    STATE_FILE_NAME
  ]);
}

/**
 * Creates an empty state object.
 *
 * @returns {{history: object[], notifiedKeys: string[], watchedRunKeys: string[], repoEtags: Record<string, string>, firstSyncComplete: boolean}}
 */
export function createDefaultState() {
  return {
    history: [],
    notifiedKeys: [],
    watchedRunKeys: [],
    repoEtags: {},
    firstSyncComplete: false
  };
}

/**
 * Loads state from disk.
 *
 * @returns {{history: object[], notifiedKeys: string[], watchedRunKeys: string[], repoEtags: Record<string, string>, firstSyncComplete: boolean}}
 */
export function loadState() {
  const path = getStatePath();

  try {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) {
      return createDefaultState();
    }

    const [, contents] = GLib.file_get_contents(path);
    const parsed = JSON.parse(new TextDecoder().decode(contents));
    return normalizeState(parsed);
  } catch (error) {
    logError(error, 'Failed to load GitHub Actions Notifier state.');
    return createDefaultState();
  }
}

/**
 * Saves state to disk.
 *
 * @param {object} state Extension state.
 */
export function saveState(state) {
  const path = getStatePath();
  const directory = GLib.path_get_dirname(path);

  try {
    GLib.mkdir_with_parents(directory, 0o700);
    GLib.file_set_contents(path, JSON.stringify(normalizeState(state), null, 2));
  } catch (error) {
    logError(error, 'Failed to save GitHub Actions Notifier state.');
  }
}

/**
 * Normalizes unknown state data.
 *
 * @param {unknown} value Raw state.
 * @returns {{history: object[], notifiedKeys: string[], watchedRunKeys: string[], repoEtags: Record<string, string>, firstSyncComplete: boolean}}
 */
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
    for (const [key, etag] of Object.entries(value.repoEtags)) {
      if (typeof key === 'string' && typeof etag === 'string') {
        state.repoEtags[key] = etag;
      }
    }
  }

  state.firstSyncComplete = value.firstSyncComplete === true;
  return state;
}
