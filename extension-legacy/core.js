var TERMINAL_STATUS = 'completed';
var ACTIVE_STATUSES = ['queued', 'in_progress', 'requested', 'waiting', 'pending'];
var NEGATIVE_CONCLUSIONS = ['action_required', 'cancelled', 'failure', 'startup_failure', 'timed_out'];
var NEUTRAL_CONCLUSIONS = ['neutral', 'skipped', 'stale'];
var MAX_LOG_PREVIEW_LINES = 80;
var MAX_LOG_LINE_LENGTH = 320;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record, key, fallback) {
  const value = record[key];
  return typeof value === 'string' ? value : fallback || '';
}

function readNumber(record, key, fallback) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback || 0;
}

function parseDateMs(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRepository(raw) {
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

function normalizeRun(raw, fallbackRepoFullName) {
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
  const conclusionValue = raw.conclusion;

  return {
    id,
    runAttempt: Math.max(1, readNumber(raw, 'run_attempt', 1)),
    repoFullName,
    workflowName,
    displayTitle,
    status: readString(raw, 'status', 'unknown'),
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

function normalizeJob(raw) {
  if (!isRecord(raw)) {
    return null;
  }

  const id = readNumber(raw, 'id');
  if (id <= 0) {
    return null;
  }

  const failedStepNames = [];
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];

  for (const step of stepsRaw) {
    if (!isRecord(step)) {
      continue;
    }

    const stepConclusion = readString(step, 'conclusion');
    if (NEGATIVE_CONCLUSIONS.includes(stepConclusion)) {
      failedStepNames.push(readString(step, 'name', 'Failed step'));
    }
  }

  return {
    id,
    name: readString(raw, 'name', 'Job'),
    status: readString(raw, 'status', 'unknown'),
    conclusion: typeof raw.conclusion === 'string' ? raw.conclusion : null,
    htmlUrl: readString(raw, 'html_url'),
    startedAt: readString(raw, 'started_at'),
    completedAt: readString(raw, 'completed_at'),
    failedStepNames
  };
}

function runKey(run) {
  return `${run.repoFullName}#${run.id}#${run.runAttempt}`;
}

function notificationKey(run) {
  return `${runKey(run)}#${run.conclusion || 'unknown'}`;
}

function isActiveRun(run) {
  return ACTIVE_STATUSES.includes(run.status);
}

function isCompletedRun(run) {
  return run.status === TERMINAL_STATUS;
}

function isNegativeConclusion(conclusion) {
  return typeof conclusion === 'string' && NEGATIVE_CONCLUSIONS.includes(conclusion);
}

function runSeverity(run) {
  if (isActiveRun(run)) {
    return 'running';
  }

  if (run.conclusion === 'success') {
    return 'success';
  }

  if (isNegativeConclusion(run.conclusion)) {
    return 'failure';
  }

  if (typeof run.conclusion === 'string' && NEUTRAL_CONCLUSIONS.includes(run.conclusion)) {
    return 'neutral';
  }

  return 'unknown';
}

function durationSeconds(run, nowMs) {
  const startMs = parseDateMs(run.startedAt) || parseDateMs(run.createdAt);
  if (startMs === null) {
    return null;
  }

  const endMs = isCompletedRun(run) ? parseDateMs(run.updatedAt) : nowMs || Date.now();
  if (endMs === null || endMs < startMs) {
    return null;
  }

  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function formatDuration(seconds) {
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

function formatRunTitle(run) {
  const branch = run.headBranch ? ` on ${run.headBranch}` : '';
  return `${run.repoFullName}: ${run.workflowName}${branch}`;
}

function formatRunSubtitle(run, duration) {
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

function shouldNotifyRun(input) {
  if (!input.firstSyncComplete || !isCompletedRun(input.run) || input.run.conclusion === null) {
    return { notify: false, reason: 'not-ready' };
  }

  const key = notificationKey(input.run);
  if (input.notifiedKeys.has(key)) {
    return { notify: false, reason: 'already-notified' };
  }

  if (input.previousRun && input.previousRun.status === TERMINAL_STATUS && input.previousRun.conclusion === input.run.conclusion) {
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

function mergeRunHistory(history, nextRuns) {
  const byKey = new Map();

  for (const run of history) {
    if (isRecord(run) && typeof run.repoFullName === 'string' && typeof run.id === 'number') {
      byKey.set(runKey(run), run);
    }
  }

  for (const run of nextRuns) {
    byKey.set(runKey(run), run);
  }

  return Array.from(byKey.values()).sort((left, right) => {
    const leftMs = parseDateMs(left.updatedAt) || parseDateMs(left.createdAt) || 0;
    const rightMs = parseDateMs(right.updatedAt) || parseDateMs(right.createdAt) || 0;
    return rightMs - leftMs;
  });
}

function pruneRunHistory(history, days, nowMs) {
  const retentionMs = Math.max(1, days) * 24 * 60 * 60 * 1000;
  const cutoffMs = (nowMs || Date.now()) - retentionMs;

  return history.filter(run => {
    if (!isRecord(run)) {
      return false;
    }

    const updatedMs = parseDateMs(readString(run, 'updatedAt')) || parseDateMs(readString(run, 'createdAt'));
    return updatedMs !== null && updatedMs >= cutoffMs;
  });
}

function cleanLogLine(line) {
  const withoutAnsi = line.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
  if (withoutAnsi.length <= MAX_LOG_LINE_LENGTH) {
    return withoutAnsi;
  }

  return `${withoutAnsi.slice(0, MAX_LOG_LINE_LENGTH - 3)}...`;
}

function extractRelevantLog(logText, failedStepNames, maxLines) {
  const lines = logText.split('\n').map(cleanLogLine);
  const lowerStepNames = (failedStepNames || [])
    .map(name => name.toLowerCase())
    .filter(name => name.length > 0);
  const interestingIndexes = new Set();
  const lineLimit = maxLines || MAX_LOG_PREVIEW_LINES;

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
    return lines.slice(Math.max(0, lines.length - lineLimit)).join('\n').trim();
  }

  return Array.from(interestingIndexes)
    .sort((left, right) => left - right)
    .slice(0, lineLimit)
    .map(index => lines[index])
    .join('\n')
    .trim();
}
