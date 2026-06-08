import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
  durationSeconds,
  extractRelevantLog,
  formatDuration,
  formatRunTitle,
  isActiveRun,
  isNegativeConclusion,
  mergeRunHistory,
  notificationKey,
  pruneRunHistory,
  runKey,
  runSeverity,
  shouldNotifyRun
} from './core.js';
import { GitHubApiError, GitHubClient } from './github.js';
import { readToken } from './secrets.js';
import { loadState, saveState } from './state.js';

const MAX_RUNS_PER_REPOSITORY = 6;
const MAX_BACKOFF_SECONDS = 3600;
const CONFIGURATION_RETRY_SECONDS = 30;
const MENU_REFRESH_MIN_AGE_SECONDS = 30;

const GitHubActionsIndicator = GObject.registerClass(
class GitHubActionsIndicator extends PanelMenu.Button {
  _init(extension) {
    super._init(0.0, _('GitHub Actions Notifier'));

    this._extension = extension;
    this._box = new St.BoxLayout({
      style_class: 'panel-status-menu-box'
    });
    this._icon = new St.Icon({
      icon_name: 'media-playback-start-symbolic',
      style_class: 'system-status-icon'
    });
    this._label = new St.Label({
      text: '',
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'gha-status-label'
    });

    this._box.add_child(this._icon);
    this._box.add_child(this._label);
    this.add_child(this._box);
  }

  update(snapshot) {
    this._snapshot = snapshot;
    this._updatePanel(snapshot);
    this._rebuildMenu(snapshot);
  }

  _updatePanel(snapshot) {
    if (!snapshot.tokenPresent) {
      this._icon.icon_name = snapshot.tokenExpected
        ? 'view-refresh-symbolic'
        : 'preferences-system-symbolic';
      this._setPanelCount('');
      return;
    }

    if (snapshot.selectedRepos.length === 0) {
      this._icon.icon_name = 'folder-symbolic';
      this._setPanelCount('');
      return;
    }

    const activeCount = snapshot.history.filter(isActiveRun).length;
    const failureCount = snapshot.history.filter(run => isNegativeConclusion(run.conclusion)).length;

    if (failureCount > 0) {
      this._icon.icon_name = 'dialog-error-symbolic';
      this._setPanelCount(String(failureCount));
    } else if (activeCount > 0) {
      this._icon.icon_name = 'media-playback-start-symbolic';
      this._setPanelCount(String(activeCount));
    } else {
      this._icon.icon_name = 'emblem-ok-symbolic';
      this._setPanelCount('');
    }
  }

  _setPanelCount(text) {
    this._label.text = text;
    this._label.visible = text.length > 0;
  }

  _rebuildMenu(snapshot) {
    this.menu.removeAll();

    this._addHeader(snapshot);
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    if (!snapshot.tokenPresent || snapshot.selectedRepos.length === 0) {
      if (!snapshot.tokenPresent && snapshot.tokenExpected) {
        return;
      }

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const message = !snapshot.tokenPresent
        ? _('Add a GitHub token in preferences.')
        : _('Select repositories in preferences.');
      this._addInfo(message);
      return;
    }

    this._addRepositorySections(snapshot);
  }

  _addHeader(snapshot) {
    const statusText = !snapshot.tokenPresent && snapshot.tokenExpected
      ? _('Waiting for GNOME Keyring...')
      : snapshot.error
      ? snapshot.error
      : snapshot.isPolling
        ? _('Refreshing GitHub Actions...')
        : snapshot.lastRefreshText;

    this._addHeaderRow(statusText || _('GitHub Actions Notifier'));
  }

  _addHeaderRow(text) {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      style_class: 'gha-header-row'
    });
    const label = new St.Label({
      text,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      style_class: 'gha-header-label'
    });

    row.add_child(label);
    row.add_child(this._createIconButton('view-refresh-symbolic', _('Refresh now'), () => {
      this._extension.refreshNow();
    }));
    row.add_child(this._createIconButton('preferences-system-symbolic', _('Preferences'), () => {
      this._extension.openPreferences();
    }));
    this.menu.addMenuItem(row);
  }

  _createIconButton(iconName, tooltip, callback) {
    const button = new St.Button({
      can_focus: true,
      reactive: true,
      style_class: 'gha-header-button'
    });
    button.set_child(new St.Icon({
      icon_name: iconName,
      style_class: 'popup-menu-icon'
    }));
    button.connect('clicked', callback);
    return button;
  }

  _addRepositorySections(snapshot) {
    let visibleRunCount = 0;

    for (const repoFullName of snapshot.selectedRepos) {
      const repoRuns = snapshot.history
        .filter(run => run.repoFullName === repoFullName)
        .slice(0, MAX_RUNS_PER_REPOSITORY);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(repoFullName));

      if (repoRuns.length === 0) {
        this._addInfo(_('No recent runs.'));
        continue;
      }

      visibleRunCount += repoRuns.length;
      for (const run of repoRuns) {
        this._addRunItem(run, snapshot);
      }
    }

    if (visibleRunCount === 0 && snapshot.selectedRepos.length === 0) {
      this._addInfo(_('No repositories selected.'));
    }
  }

  _addRunItem(run, snapshot) {
    const severity = runSeverity(run);
    const duration = formatDuration(durationSeconds(run));
    const item = new PopupMenu.PopupSubMenuMenuItem(formatProjectRunTitle(run), true);
    setRunItemIcon(item, severity);

    this._addRunDetails(item, run, duration);

    if (isActiveRun(run)) {
      const watched = snapshot.watchedRunKeys.has(runKey(run));
      const watchItem = new PopupMenu.PopupMenuItem(watched ? _('Unwatch success notification') : _('Watch success notification'));
      watchItem.connect('activate', () => {
        this._extension.toggleWatch(run);
      });
      item.menu.addMenuItem(watchItem);
    }

    const actionButtons = [{
      label: _('Copy summary'),
      callback: () => this._extension.copyText(this._extension.formatRunSummary(run))
    }];

    if (run.htmlUrl) {
      actionButtons.push({
        label: _('Open in GitHub'),
        callback: () => this._extension.openUri(run.htmlUrl)
      });
    }

    this._addButtonRow(item.menu, actionButtons);

    if (isNegativeConclusion(run.conclusion)) {
      const logExcerpt = snapshot.logExcerpts.get(runKey(run));

      this._addSubmenuCommand(item, logExcerpt ? _('Reload failed log') : _('Load failed log'), () => {
        this._extension.loadFailedLog(run);
      });

      if (logExcerpt) {
        this._addSubmenuCommand(item, _('Copy failed output'), () => {
          this._extension.copyText(logExcerpt);
        });
        item.menu.addMenuItem(new PopupMenu.PopupMenuItem(logExcerpt, {
          reactive: false,
          style_class: 'gha-log-preview'
        }));
      }
    }

    this.menu.addMenuItem(item);
  }

  _addRunDetails(parentItem, run, duration) {
    parentItem.menu.addMenuItem(new PopupMenu.PopupMenuItem(formatProjectWorkflowLine(run), {
      reactive: false,
      style_class: 'gha-muted'
    }));

    const metadata = formatProjectRunMetadata(run, duration);
    if (metadata) {
      parentItem.menu.addMenuItem(new PopupMenu.PopupMenuItem(metadata, {
        reactive: false,
        style_class: 'gha-muted'
      }));
    }
  }

  _addButtonRow(menu, buttons) {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      style_class: 'gha-action-row'
    });

    for (const buttonConfig of buttons) {
      const button = new St.Button({
        label: buttonConfig.label,
        can_focus: true,
        x_expand: true,
        style_class: 'gha-action-button'
      });
      button.connect('clicked', buttonConfig.callback);
      row.add_child(button);
    }

    menu.addMenuItem(row);
  }

  _addSubmenuCommand(parentItem, label, callback) {
    const command = new PopupMenu.PopupMenuItem(label);
    command.connect('activate', callback);
    parentItem.menu.addMenuItem(command);
  }

  _addInfo(text) {
    this.menu.addMenuItem(new PopupMenu.PopupMenuItem(text, {
      reactive: false
    }));
  }
});

export default class GitHubActionsNotifierExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._settingsSignals = [];
    this._timeoutId = 0;
    this._polling = false;
    this._backoffSeconds = 0;
    this._lastRefreshMs = 0;
    this._error = '';
    this._configurationError = false;
    this._token = '';
    this._expectsToken = false;
    this._selectedRepos = [];
    this._logExcerpts = new Map();
    this._cancellable = new Gio.Cancellable();
    this._state = loadState();
    this._indicator = new GitHubActionsIndicator(this);
    this._menuOpenSignalId = this._indicator.menu.connect('open-state-changed', (_menu, isOpen) => {
      if (isOpen) {
        this._onMenuOpened();
      }
    });

    Main.panel.addToStatusArea(this.uuid, this._indicator);
    this._connectSettings();
    this._reloadConfiguration();
    this._updateIndicator();
    this.refreshNow();
  }

  disable() {
    this._clearTimer();

    if (this._cancellable) {
      this._cancellable.cancel();
      this._cancellable = null;
    }

    for (const signalId of this._settingsSignals ?? []) {
      this._settings.disconnect(signalId);
    }

    this._settingsSignals = [];

    if (this._indicator && this._menuOpenSignalId) {
      this._indicator.menu.disconnect(this._menuOpenSignalId);
      this._menuOpenSignalId = 0;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    if (this._state) {
      saveState(this._state);
    }

    this._settings = null;
    this._state = null;
  }

  openPreferences() {
    super.openPreferences();
  }

  refreshNow() {
    this._pollNow(true).catch(error => {
      logError(error, 'Failed to refresh GitHub Actions.');
    });
  }

  _onMenuOpened() {
    this._reloadConfiguration();
    this._updateIndicator();

    if (this._shouldRefreshOnMenuOpen()) {
      this._pollNow(false).catch(error => {
        logError(error, 'Failed to refresh GitHub Actions after opening the menu.');
      });
    } else if (!this._token && this._expectsToken) {
      this._scheduleNextPoll();
    }
  }

  toggleWatch(run) {
    const watchedKeys = new Set(this._state.watchedRunKeys);
    const key = runKey(run);

    if (watchedKeys.has(key)) {
      watchedKeys.delete(key);
    } else {
      watchedKeys.add(key);
    }

    this._state.watchedRunKeys = [...watchedKeys];
    saveState(this._state);
    this._updateIndicator();
  }

  async loadFailedLog(run) {
    if (!this._token) {
      const message = this._expectsToken
        ? _('Waiting for GNOME Keyring.')
        : _('Add a GitHub token in preferences.');
      Main.notify(_('GitHub Actions Notifier'), message);
      return;
    }

    this._error = _('Loading failed log...');
    this._updateIndicator();

    try {
      const client = new GitHubClient(this._token, this._cancellable);
      const jobs = await client.listJobs(run.repoFullName, run.id);
      const failedJobs = jobs.filter(job => isNegativeConclusion(job.conclusion));

      if (failedJobs.length === 0) {
        this._error = _('No failed jobs were found.');
        this._updateIndicator();
        return;
      }

      const excerpts = [];

      for (const job of failedJobs.slice(0, 3)) {
        const logText = await client.downloadJobLog(run.repoFullName, job.id);
        const excerpt = extractRelevantLog(logText, job.failedStepNames);
        if (excerpt) {
          excerpts.push(`${job.name}\n${excerpt}`);
        }
      }

      const joinedExcerpt = excerpts.join('\n\n');
      this._logExcerpts.set(runKey(run), joinedExcerpt || _('No relevant failed log lines were found.'));
      this._error = '';
      this._updateIndicator();
    } catch (error) {
      this._error = userVisibleError(error);
      this._updateIndicator();
      logError(error, 'Failed to load GitHub Actions job logs.');
    }
  }

  copyText(text) {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    Main.notify(_('GitHub Actions Notifier'), _('Copied to clipboard.'));
  }

  openUri(uri) {
    try {
      Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (error) {
      this._error = _('Could not open link.');
      this._updateIndicator();
      logError(error, 'Failed to open GitHub URL.');
    }
  }

  formatRunSummary(run) {
    const duration = formatDuration(durationSeconds(run));
    const lines = [
      formatRunTitle(run),
      `Status: ${run.conclusion ?? run.status}`
    ];

    if (duration) {
      lines.push(`Duration: ${duration}`);
    }

    if (run.displayTitle) {
      lines.push(`Run: ${run.displayTitle}`);
    }

    if (run.htmlUrl) {
      lines.push(`URL: ${run.htmlUrl}`);
    }

    return lines.join('\n');
  }

  _connectSettings() {
    const settingKeys = [
      'selected-repositories',
      'has-token',
      'active-poll-interval',
      'idle-poll-interval',
      'history-days',
      'notify-failures',
      'notify-watched-success',
      'notify-all-completions'
    ];

    for (const key of settingKeys) {
      this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => {
        this._reloadConfiguration();
        this.refreshNow();
      }));
    }
  }

  _reloadConfiguration() {
    this._selectedRepos = this._settings.get_strv('selected-repositories');
    this._expectsToken = this._settings.get_boolean('has-token') || this._selectedRepos.length > 0;

    try {
      this._token = readToken();
      if (this._token) {
        this._expectsToken = true;
        if (!this._settings.get_boolean('has-token')) {
          this._settings.set_boolean('has-token', true);
        }
      }

      if (this._configurationError) {
        this._error = '';
        this._configurationError = false;
      }
    } catch (error) {
      this._token = '';
      this._configurationError = true;
      this._error = _('Could not read GitHub token from keyring.');
      logError(error, 'Failed to read GitHub Actions Notifier token.');
    }
  }

  async _pollNow(userInitiated) {
    this._clearTimer();

    if (this._polling) {
      return;
    }

    this._reloadConfiguration();

    if (!this._token || this._selectedRepos.length === 0) {
      this._updateIndicator();
      this._scheduleNextPoll();
      return;
    }

    this._polling = true;
    this._error = userInitiated ? _('Refreshing GitHub Actions...') : '';
    this._updateIndicator();

    try {
      const client = new GitHubClient(this._token, this._cancellable);
      const fetchedRuns = [];

      for (const repoFullName of this._selectedRepos) {
        const result = await client.listWorkflowRuns(repoFullName, this._state.repoEtags[repoFullName] ?? null);
        if (result.etag) {
          this._state.repoEtags[repoFullName] = result.etag;
        }

        if (!result.notModified) {
          fetchedRuns.push(...result.runs);
        }
      }

      this._processRuns(fetchedRuns);
      this._backoffSeconds = 0;
      this._lastRefreshMs = Date.now();
      this._error = '';
      saveState(this._state);
    } catch (error) {
      this._handlePollError(error);
    } finally {
      this._polling = false;
      this._updateIndicator();
      this._scheduleNextPoll();
    }
  }

  _processRuns(fetchedRuns) {
    const previousRuns = new Map();
    for (const run of this._state.history) {
      previousRuns.set(runKey(run), run);
    }

    const watchedRunKeys = new Set(this._state.watchedRunKeys);
    const notifiedKeys = new Set(this._state.notifiedKeys);

    for (const run of fetchedRuns) {
      const decision = shouldNotifyRun({
        run,
        previousRun: previousRuns.get(runKey(run)) ?? null,
        watchedRunKeys,
        notifiedKeys,
        firstSyncComplete: this._state.firstSyncComplete,
        notifyFailures: this._settings.get_boolean('notify-failures'),
        notifyWatchedSuccess: this._settings.get_boolean('notify-watched-success'),
        notifyAllCompletions: this._settings.get_boolean('notify-all-completions')
      });

      if (decision.notify) {
        this._notifyRun(run, decision.reason);
        notifiedKeys.add(notificationKey(run));
      }
    }

    const historyDays = this._settings.get_uint('history-days');
    this._state.history = pruneRunHistory(
      mergeRunHistory(this._state.history, fetchedRuns),
      historyDays
    );

    const liveRunKeys = new Set(this._state.history.map(runKey));
    this._state.watchedRunKeys = [...watchedRunKeys].filter(key => liveRunKeys.has(key));
    this._state.notifiedKeys = [...notifiedKeys].slice(-1000);
    this._state.firstSyncComplete = true;
  }

  _notifyRun(run, reason) {
    const conclusion = run.conclusion ?? run.status;
    const duration = formatDuration(durationSeconds(run));
    const title = reason === 'watched-success'
      ? _('Watched workflow finished')
      : _('GitHub Actions workflow needs attention');
    const bodyParts = [
      `${run.repoFullName}: ${run.workflowName}`,
      conclusion
    ];

    if (duration) {
      bodyParts.push(duration);
    }

    Main.notify(title, bodyParts.join(' | '));
  }

  _handlePollError(error) {
    this._error = userVisibleError(error);
    this._backoffSeconds = nextBackoffSeconds(this._backoffSeconds);

    if (error instanceof GitHubApiError && error.rateLimitReset !== null) {
      const resetDelay = Math.max(60, error.rateLimitReset - Math.floor(Date.now() / 1000));
      this._backoffSeconds = Math.min(MAX_BACKOFF_SECONDS, Math.max(this._backoffSeconds, resetDelay));
    }

    logError(error, 'Failed to poll GitHub Actions.');
  }

  _scheduleNextPoll() {
    this._clearTimer();

    if (!this._token) {
      if (!this._expectsToken) {
        return;
      }

      this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CONFIGURATION_RETRY_SECONDS, () => {
        this._timeoutId = 0;
        this.refreshNow();
        return GLib.SOURCE_REMOVE;
      });
      return;
    }

    if (this._selectedRepos.length === 0) {
      return;
    }

    const interval = this._backoffSeconds > 0
      ? this._backoffSeconds
      : this._getNormalPollInterval();

    this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
      this._timeoutId = 0;
      this.refreshNow();
      return GLib.SOURCE_REMOVE;
    });
  }

  _getNormalPollInterval() {
    const hasActiveRuns = this._state.history.some(run => {
      return this._selectedRepos.includes(run.repoFullName) && isActiveRun(run);
    });

    return hasActiveRuns
      ? this._settings.get_uint('active-poll-interval')
      : this._settings.get_uint('idle-poll-interval');
  }

  _shouldRefreshOnMenuOpen() {
    if (!this._token || this._selectedRepos.length === 0 || this._polling) {
      return false;
    }

    if (this._lastRefreshMs <= 0) {
      return true;
    }

    return Date.now() - this._lastRefreshMs >= MENU_REFRESH_MIN_AGE_SECONDS * 1000;
  }

  _clearTimer() {
    if (this._timeoutId) {
      GLib.Source.remove(this._timeoutId);
      this._timeoutId = 0;
    }
  }

  _updateIndicator() {
    if (!this._indicator) {
      return;
    }

    this._indicator.update({
      tokenPresent: Boolean(this._token),
      tokenExpected: this._expectsToken,
      selectedRepos: this._selectedRepos,
      history: (this._state?.history ?? []).filter(run => this._selectedRepos.includes(run.repoFullName)),
      watchedRunKeys: new Set(this._state?.watchedRunKeys ?? []),
      logExcerpts: this._logExcerpts,
      error: this._error,
      isPolling: this._polling,
      lastRefreshText: formatRefreshTimestamp(this._lastRefreshMs)
    });
  }
}

function setRunItemIcon(item, severity) {
  const icon = item._icon ?? item.icon ?? null;
  if (icon) {
    icon.icon_name = 'media-record-symbolic';
    icon.style = `color: ${statusColor(severity)};`;
  }
}

function statusColor(severity) {
  switch (severity) {
    case 'failure':
      return '#ed333b';
    case 'success':
      return '#33d17a';
    case 'running':
      return '#f6c177';
    default:
      return '#9a9a9a';
  }
}

function formatProjectRunTitle(run) {
  if (run.displayTitle && run.displayTitle !== run.workflowName) {
    return run.displayTitle;
  }

  return run.workflowName || 'Workflow run';
}

function formatProjectWorkflowLine(run) {
  const branch = run.headBranch ? ` on ${run.headBranch}` : '';
  return `${run.workflowName}${branch}`;
}

function formatProjectRunMetadata(run, duration) {
  const parts = [];

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

function formatRefreshTimestamp(timestampMs) {
  if (timestampMs <= 0) {
    return _('Waiting for first refresh.');
  }

  const date = new Date(timestampMs);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `Last refreshed at ${hours}:${minutes}`;
}

function nextBackoffSeconds(current) {
  if (current <= 0) {
    return 60;
  }

  return Math.min(MAX_BACKOFF_SECONDS, current * 2);
}

function userVisibleError(error) {
  if (error instanceof GitHubApiError) {
    return error.message;
  }

  if (error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
    return '';
  }

  return _('Could not reach GitHub.');
}
