import assert from 'node:assert/strict';
import test from 'node:test';

import {
  durationSeconds,
  extractRelevantLog,
  formatDuration,
  mergeRunHistory,
  normalizeJob,
  normalizeRepository,
  normalizeRun,
  pruneRunHistory,
  runKey,
  shouldNotifyRun
} from '../extension-modern/core.js';

test('normalizes repository payloads', () => {
  const repo = normalizeRepository({
    full_name: 'opengrimoire/example',
    name: 'example',
    private: true,
    html_url: 'https://github.com/opengrimoire/example',
    owner: { login: 'opengrimoire' }
  });

  assert.deepEqual(repo, {
    fullName: 'opengrimoire/example',
    owner: 'opengrimoire',
    name: 'example',
    private: true,
    htmlUrl: 'https://github.com/opengrimoire/example',
    archived: false
  });
});

test('normalizes workflow run payloads', () => {
  const run = normalizeRun({
    id: 123,
    run_attempt: 2,
    name: 'CI',
    display_title: 'fix: example',
    status: 'completed',
    conclusion: 'failure',
    event: 'push',
    head_branch: 'dev',
    actor: { login: 'name' },
    repository: { full_name: 'opengrimoire/example' },
    html_url: 'https://github.com/opengrimoire/example/actions/runs/123',
    created_at: '2026-06-07T10:00:00Z',
    run_started_at: '2026-06-07T10:01:00Z',
    updated_at: '2026-06-07T10:05:30Z'
  }, 'fallback/repo');

  assert.equal(runKey(run), 'opengrimoire/example#123#2');
  assert.equal(run.workflowName, 'CI');
  assert.equal(run.conclusion, 'failure');
  assert.equal(durationSeconds(run, Date.parse('2026-06-07T10:06:00Z')), 270);
});

test('normalizes failed job step names', () => {
  const job = normalizeJob({
    id: 321,
    name: 'test',
    status: 'completed',
    conclusion: 'failure',
    steps: [
      { name: 'Checkout', conclusion: 'success' },
      { name: 'Unit tests', conclusion: 'failure' }
    ]
  });

  assert.deepEqual(job.failedStepNames, ['Unit tests']);
});

test('formats durations compactly', () => {
  assert.equal(formatDuration(9), '9s');
  assert.equal(formatDuration(249), '4m 9s');
  assert.equal(formatDuration(3720), '1h 2m');
});

test('notifies failures after first sync', () => {
  const run = {
    repoFullName: 'opengrimoire/example',
    id: 123,
    runAttempt: 1,
    status: 'completed',
    conclusion: 'failure'
  };

  const decision = shouldNotifyRun({
    run,
    previousRun: { status: 'in_progress', conclusion: null },
    watchedRunKeys: new Set(),
    notifiedKeys: new Set(),
    firstSyncComplete: true,
    notifyFailures: true,
    notifyWatchedSuccess: true,
    notifyAllCompletions: false
  });

  assert.deepEqual(decision, { notify: true, reason: 'failure' });
});

test('notifies watched successful runs only when watched', () => {
  const run = {
    repoFullName: 'opengrimoire/example',
    id: 123,
    runAttempt: 1,
    status: 'completed',
    conclusion: 'success'
  };

  assert.equal(shouldNotifyRun({
    run,
    previousRun: { status: 'in_progress', conclusion: null },
    watchedRunKeys: new Set(),
    notifiedKeys: new Set(),
    firstSyncComplete: true,
    notifyFailures: true,
    notifyWatchedSuccess: true,
    notifyAllCompletions: false
  }).notify, false);

  assert.equal(shouldNotifyRun({
    run,
    previousRun: { status: 'in_progress', conclusion: null },
    watchedRunKeys: new Set([runKey(run)]),
    notifiedKeys: new Set(),
    firstSyncComplete: true,
    notifyFailures: true,
    notifyWatchedSuccess: true,
    notifyAllCompletions: false
  }).notify, true);
});

test('suppresses first sync notifications', () => {
  const run = {
    repoFullName: 'opengrimoire/example',
    id: 123,
    runAttempt: 1,
    status: 'completed',
    conclusion: 'failure'
  };

  assert.equal(shouldNotifyRun({
    run,
    previousRun: null,
    watchedRunKeys: new Set(),
    notifiedKeys: new Set(),
    firstSyncComplete: false,
    notifyFailures: true,
    notifyWatchedSuccess: true,
    notifyAllCompletions: false
  }).notify, false);
});

test('merges and prunes run history', () => {
  const oldRun = {
    repoFullName: 'opengrimoire/example',
    id: 1,
    runAttempt: 1,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:01:00Z'
  };
  const newRun = {
    repoFullName: 'opengrimoire/example',
    id: 2,
    runAttempt: 1,
    createdAt: '2026-06-07T00:00:00Z',
    updatedAt: '2026-06-07T00:01:00Z'
  };

  const merged = mergeRunHistory([oldRun], [newRun]);
  assert.equal(merged[0].id, 2);

  const pruned = pruneRunHistory(merged, 7, Date.parse('2026-06-07T12:00:00Z'));
  assert.deepEqual(pruned.map(run => run.id), [2]);
});

test('extracts relevant failed log output', () => {
  const log = [
    'setup',
    'install',
    'Unit tests',
    'running tests',
    'error: expected 1 got 2',
    'stack frame',
    'cleanup'
  ].join('\n');

  const excerpt = extractRelevantLog(log, ['Unit tests'], 20);

  assert.match(excerpt, /Unit tests/);
  assert.match(excerpt, /error: expected 1 got 2/);
});
