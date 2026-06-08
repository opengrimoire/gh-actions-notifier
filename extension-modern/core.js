export const TERMINAL_STATUS = 'completed';
export const ACTIVE_STATUSES = new Set([
  'queued',
  'in_progress',
  'requested',
  'waiting',
  'pending'
]);

export const NEGATIVE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'timed_out'
]);

export const NEUTRAL_CONCLUSIONS = new Set([
  'neutral',
  'skipped',
  'stale'
]);

export const MAX_LOG_PREVIEW_LINES = 80;
export const MAX_LOG_LINE_LENGTH = 320;

/**
 * Returns true when value is a non-null object.
 *
 * @param {unknown} value Input value.
 * @returns {value is Record<string, unknown>} Whether the value is object-like.
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns a string field from an unknown object.
 *
 * @param {Record<string, unknown>} record Source object.
 * @param {string} key Field name.
 * @param {string} fallback Fallback string.
 * @returns {string} Field value.
 */
export function readString(record, key, fallback = '') {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Returns a number field from an unknown object.
 *
 * @param {Record<string, unknown>} record Source object.
 * @param {string} key Field name.
 * @param {number} fallback Fallback number.
 * @returns {number} Field value.
 */
export function readNumber(record, key, fallback = 0) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Parses an ISO date string into milliseconds.
 *
 * @param {string | null | undefined} value ISO date string.
 * @returns {number | null} Parsed milliseconds.
 */
export function parseDateMs(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalizes a GitHub repository API object.
 *
 * @param {unknown} raw Repository payload.
 * @returns {{fullName: string, owner: string, name: string, private: boolean, htmlUrl: string, archived: boolean} | null}
 */
export function normalizeRepository(raw) {
  if (!isRecord(raw)) {
    return null;
  }

  const fullName = readString(raw, 'full_name');
  const name = readString(raw, 'name');
  const ownerRecord = isRecord(raw.owner) ? raw.owner : {};
  const owner = readString(ownerRecord, 'login');

  if (!fullName || !name || !owner) {
    return null;
  }

  return {
    fullName,
    owner,
    name,
    private: raw.private === true,
    htmlUrl: readString(raw, 'html_url', `https://github.com/${fullName}`),
    archived: raw.archived === true
  };
}

/**
 * Normalizes a GitHub Actions workflow run API object.
 *
 * @param {unknown} raw Workflow run payload.
 * @param {string} fallbackRepoFullName Repository full name used when the payload omits it.
 * @returns {{
 *   id: number,
 *   runAttempt: number,
 *   repoFullName: string,
 *   workflowName: string,
 *   displayTitle: string,
 *   status: string,
 *   conclusion: string | null,
 *   event: string,
 *   headBranch: string,
 *   headSha: string,
 *   actor: string,
 *   htmlUrl: string,
 *   createdAt: string,
 *   startedAt: string,
 *   updatedAt: string
 * } | null}
 */
export function normalizeRun(raw, fallbackRepoFullName) {
  if (!isRecord(raw)) {
    return null;
  }

  const id = readNumber(raw, 'id');
  if (id <= 0) {
    return null;
  }

  const repositoryRecord = isRecord(raw.repository) ? raw.repository : {};
  const repoFullName = readString(repositoryRecord, 'full_name', fallbackRepoFullName);
  const actorRecord = isRecord(raw.actor) ? raw.actor : {};
  const workflowName = readString(raw, 'name', 'Workflow');
  const displayTitle = readString(raw, 'display_title', workflowName);
  const status = readString(raw, 'status', 'unknown');
  const conclusionValue = raw.conclusion;

  return {
    id,
    runAttempt: Math.max(1, readNumber(raw, 'run_attempt', 1)),
    repoFullName,
    workflowName,
    displayTitle,
    status,
    conclusion: typeof conclusionValue === 'string' ? conclusionValue : null,
    event: readString(raw, 'event'),
    headBranch: readString(raw, 'head_branch'),
    headSha: readString(raw, 'head_sha'),
    actor: readString(actorRecord, 'login'),
    htmlUrl: readString(raw, 'html_url', `https://github.com/${repoFullName}/actions/runs/${id}`),
    createdAt: readString(raw, 'created_at'),
    startedAt: readString(raw, 'run_started_at', readString(raw, 'created_at')),
    updatedAt: readString(raw, 'updated_at')
  };
}

/**
 * Normalizes a GitHub Actions job API object.
 *
 * @param {unknown} raw Job payload.
 * @returns {{
 *   id: number,
 *   name: string,
 *   status: string,
 *   conclusion: string | null,
 *   htmlUrl: string,
 *   startedAt: string,
 *   completedAt: string,
 *   failedStepNames: string[]
 * } | null}
 */
export function normalizeJob(raw) {
  if (!isRecord(raw)) {
    return null;
  }

  const id = readNumber(raw, 'id');
  if (id <= 0) {
    return null;
  }

  const conclusionValue = raw.conclusion;
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const failedStepNames = [];

  for (const step of stepsRaw) {
    if (!isRecord(step)) {
      continue;
    }

    const stepConclusion = readString(step, 'conclusion');
    if (NEGATIVE_CONCLUSIONS.has(stepConclusion)) {
      failedStepNames.push(readString(step, 'name', 'Failed step'));
    }
  }

  return {
    id,
    name: readString(raw, 'name', 'Job'),
    status: readString(raw, 'status', 'unknown'),
    conclusion: typeof conclusionValue === 'string' ? conclusionValue : null,
    htmlUrl: readString(raw, 'html_url'),
    startedAt: readString(raw, 'started_at'),
    completedAt: readString(raw, 'completed_at'),
    failedStepNames
  };
}

/**
 * Returns a stable key for a workflow run attempt.
 *
 * @param {{repoFullName: string, id: number, runAttempt: number}} run Workflow run.
 * @returns {string} Stable key.
 */
export function runKey(run) {
  return `${run.repoFullName}#${run.id}#${run.runAttempt}`;
}

/**
 * Returns a notification dedupe key for a completed workflow run.
 *
 * @param {{repoFullName: string, id: number, runAttempt: number, conclusion: string | null}} run Workflow run.
 * @returns {string} Stable notification key.
 */
export function notificationKey(run) {
  return `${runKey(run)}#${run.conclusion ?? 'unknown'}`;
}

/**
 * Returns true when the run is still active.
 *
 * @param {{status: string}} run Workflow run.
 * @returns {boolean} Whether the run is active.
 */
export function isActiveRun(run) {
  return ACTIVE_STATUSES.has(run.status);
}

/**
 * Returns true when the run has a terminal status.
 *
 * @param {{status: string}} run Workflow run.
 * @returns {boolean} Whether the run is completed.
 */
export function isCompletedRun(run) {
  return run.status === TERMINAL_STATUS;
}

/**
 * Returns true when the conclusion should be treated as a problem.
 *
 * @param {string | null} conclusion Workflow run conclusion.
 * @returns {boolean} Whether the conclusion is negative.
 */
export function isNegativeConclusion(conclusion) {
  return typeof conclusion === 'string' && NEGATIVE_CONCLUSIONS.has(conclusion);
}

/**
 * Returns a user-facing severity bucket.
 *
 * @param {{status: string, conclusion: string | null}} run Workflow run.
 * @returns {'running' | 'success' | 'failure' | 'neutral' | 'unknown'} Severity.
 */
export function runSeverity(run) {
  if (isActiveRun(run)) {
    return 'running';
  }

  if (run.conclusion === 'success') {
    return 'success';
  }

  if (isNegativeConclusion(run.conclusion)) {
    return 'failure';
  }

  if (typeof run.conclusion === 'string' && NEUTRAL_CONCLUSIONS.has(run.conclusion)) {
    return 'neutral';
  }

  return 'unknown';
}

/**
 * Computes run duration in seconds.
 *
 * @param {{createdAt: string, startedAt: string, updatedAt: string, status: string}} run Workflow run.
 * @param {number} nowMs Current time in milliseconds.
 * @returns {number | null} Duration in seconds.
 */
export function durationSeconds(run, nowMs = Date.now()) {
  const startMs = parseDateMs(run.startedAt) ?? parseDateMs(run.createdAt);
  if (startMs === null) {
    return null;
  }

  const endMs = isCompletedRun(run) ? parseDateMs(run.updatedAt) : nowMs;
  if (endMs === null || endMs < startMs) {
    return null;
  }

  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

/**
 * Formats a duration in a compact form.
 *
 * @param {number | null} seconds Duration in seconds.
 * @returns {string} Formatted duration.
 */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '';
  }

  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

/**
 * Returns a compact title for menu and notification rows.
 *
 * @param {{repoFullName: string, workflowName: string, displayTitle: string, headBranch: string}} run Workflow run.
 * @returns {string} Title.
 */
export function formatRunTitle(run) {
  const branch = run.headBranch ? ` on ${run.headBranch}` : '';
  return `${run.repoFullName}: ${run.workflowName}${branch}`;
}

/**
 * Returns a compact subtitle for menu rows.
 *
 * @param {{displayTitle: string, actor: string, event: string}} run Workflow run.
 * @param {string} duration Duration text.
 * @returns {string} Subtitle.
 */
export function formatRunSubtitle(run, duration) {
  const parts = [];

  if (run.displayTitle) {
    parts.push(run.displayTitle);
  }

  if (duration) {
    parts.push(duration);
  }

  if (run.actor) {
    parts.push(run.actor);
  }

  if (run.event) {
    parts.push(run.event);
  }

  return parts.join(' | ');
}

/**
 * Decides whether a completed run should emit a notification.
 *
 * @param {{
 *   run: {status: string, conclusion: string | null, repoFullName: string, id: number, runAttempt: number},
 *   previousRun: {status: string, conclusion: string | null} | null,
 *   watchedRunKeys: Set<string>,
 *   notifiedKeys: Set<string>,
 *   firstSyncComplete: boolean,
 *   notifyFailures: boolean,
 *   notifyWatchedSuccess: boolean,
 *   notifyAllCompletions: boolean
 * }} input Notification inputs.
 * @returns {{notify: boolean, reason: string}} Decision.
 */
export function shouldNotifyRun(input) {
  if (!input.firstSyncComplete || !isCompletedRun(input.run) || input.run.conclusion === null) {
    return { notify: false, reason: 'not-ready' };
  }

  const key = notificationKey(input.run);
  if (input.notifiedKeys.has(key)) {
    return { notify: false, reason: 'already-notified' };
  }

  if (input.previousRun?.status === TERMINAL_STATUS && input.previousRun.conclusion === input.run.conclusion) {
    return { notify: false, reason: 'unchanged' };
  }

  if (input.notifyAllCompletions) {
    return { notify: true, reason: 'all-completions' };
  }

  if (input.notifyFailures && isNegativeConclusion(input.run.conclusion)) {
    return { notify: true, reason: 'failure' };
  }

  if (input.notifyWatchedSuccess && input.run.conclusion === 'success' && input.watchedRunKeys.has(runKey(input.run))) {
    return { notify: true, reason: 'watched-success' };
  }

  return { notify: false, reason: 'policy' };
}

/**
 * Merges new workflow runs into existing history.
 *
 * @param {Array<object>} history Existing runs.
 * @param {Array<object>} nextRuns New runs.
 * @returns {Array<object>} Merged runs.
 */
export function mergeRunHistory(history, nextRuns) {
  const byKey = new Map();

  for (const run of history) {
    if (isRecord(run) && typeof run.repoFullName === 'string' && typeof run.id === 'number') {
      byKey.set(runKey(run), run);
    }
  }

  for (const run of nextRuns) {
    byKey.set(runKey(run), run);
  }

  return [...byKey.values()].sort((left, right) => {
    const leftMs = parseDateMs(left.updatedAt) ?? parseDateMs(left.createdAt) ?? 0;
    const rightMs = parseDateMs(right.updatedAt) ?? parseDateMs(right.createdAt) ?? 0;
    return rightMs - leftMs;
  });
}

/**
 * Prunes history by age.
 *
 * @param {Array<object>} history Existing history.
 * @param {number} days Retention in days.
 * @param {number} nowMs Current time in milliseconds.
 * @returns {Array<object>} Pruned history.
 */
export function pruneRunHistory(history, days, nowMs = Date.now()) {
  const retentionMs = Math.max(1, days) * 24 * 60 * 60 * 1000;
  const cutoffMs = nowMs - retentionMs;

  return history.filter(run => {
    if (!isRecord(run)) {
      return false;
    }

    const updatedMs = parseDateMs(readString(run, 'updatedAt')) ?? parseDateMs(readString(run, 'createdAt'));
    return updatedMs !== null && updatedMs >= cutoffMs;
  });
}

/**
 * Strips ANSI escape codes and limits line size.
 *
 * @param {string} line Log line.
 * @returns {string} Cleaned line.
 */
export function cleanLogLine(line) {
  const withoutAnsi = line.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
  if (withoutAnsi.length <= MAX_LOG_LINE_LENGTH) {
    return withoutAnsi;
  }

  return `${withoutAnsi.slice(0, MAX_LOG_LINE_LENGTH - 3)}...`;
}

/**
 * Extracts relevant failed log lines for preview and clipboard.
 *
 * @param {string} logText Raw job log.
 * @param {string[]} failedStepNames Failed step names.
 * @param {number} maxLines Maximum lines to return.
 * @returns {string} Extracted log text.
 */
export function extractRelevantLog(logText, failedStepNames = [], maxLines = MAX_LOG_PREVIEW_LINES) {
  const lines = logText.split('\n').map(cleanLogLine);
  const lowerStepNames = failedStepNames
    .map(name => name.toLowerCase())
    .filter(name => name.length > 0);
  const interestingIndexes = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const lowerLine = lines[index].toLowerCase();
    const hasErrorMarker = lowerLine.includes('##[error]')
      || lowerLine.includes('error:')
      || lowerLine.includes('failed')
      || lowerLine.includes('failure')
      || lowerLine.includes('traceback')
      || lowerLine.includes('panic');
    const matchesStep = lowerStepNames.some(name => lowerLine.includes(name));

    if (hasErrorMarker || matchesStep) {
      const start = Math.max(0, index - 4);
      const end = Math.min(lines.length - 1, index + 8);

      for (let windowIndex = start; windowIndex <= end; windowIndex += 1) {
        interestingIndexes.add(windowIndex);
      }
    }
  }

  if (interestingIndexes.size === 0) {
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n').trim();
  }

  const selected = [...interestingIndexes]
    .sort((left, right) => left - right)
    .slice(0, maxLines)
    .map(index => lines[index]);

  return selected.join('\n').trim();
}
