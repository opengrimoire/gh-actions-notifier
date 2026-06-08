import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
  ExtensionPreferences,
  gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { GitHubClient } from './github.js';
import { clearToken, readToken, storeToken } from './secrets.js';

const TOKEN_CREATION_URL = 'https://github.com/settings/personal-access-tokens/new';

export default class GitHubActionsNotifierPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    Adw.init();

    this._settings = this.getSettings();
    this._repoRows = [];

    window.set_title(_('GitHub Actions Notifier'));
    window.set_default_size(760, 680);

    const page = new Adw.PreferencesPage({
      title: _('General'),
      icon_name: 'emblem-system-symbolic'
    });
    window.add(page);

    this._addAccountGroup(page);
    this._addRepositoryGroup(page);
    this._addNotificationGroup(page);
    this._addPollingGroup(page);
    this._updateTokenStatus();
  }

  _addAccountGroup(page) {
    const group = new Adw.PreferencesGroup({
      title: _('GitHub account')
    });
    page.add(group);

    this._tokenStatusRow = new Adw.ActionRow({
      title: _('Token status')
    });
    group.add(this._tokenStatusRow);

    this._tokenRow = new Adw.PasswordEntryRow({
      title: _('Fine-grained personal access token')
    });
    group.add(this._tokenRow);

    const saveButton = new Gtk.Button({
      label: _('Save token'),
      valign: Gtk.Align.CENTER
    });
    saveButton.add_css_class('suggested-action');
    saveButton.connect('clicked', () => this._saveToken());
    this._tokenRow.add_suffix(saveButton);

    const deleteRow = new Adw.ActionRow({
      title: _('Delete stored token'),
      subtitle: _('Removes the token from GNOME Keyring.')
    });
    const deleteButton = new Gtk.Button({
      label: _('Delete'),
      valign: Gtk.Align.CENTER
    });
    deleteButton.add_css_class('destructive-action');
    deleteButton.connect('clicked', () => this._deleteToken());
    deleteRow.add_suffix(deleteButton);
    deleteRow.activatable_widget = deleteButton;
    group.add(deleteRow);

    const tokenLinkRow = new Adw.ActionRow({
      title: _('Create token on GitHub'),
      subtitle: _('Required permissions: Metadata read and Actions read.')
    });
    const openButton = new Gtk.Button({
      icon_name: 'emblem-shared-symbolic',
      valign: Gtk.Align.CENTER
    });
    openButton.set_tooltip_text(_('Open GitHub token settings'));
    openButton.connect('clicked', () => {
      Gio.AppInfo.launch_default_for_uri(TOKEN_CREATION_URL, null);
    });
    tokenLinkRow.add_suffix(openButton);
    tokenLinkRow.activatable_widget = openButton;
    group.add(tokenLinkRow);
  }

  _addRepositoryGroup(page) {
    this._repoGroup = new Adw.PreferencesGroup({
      title: _('Repositories'),
      description: _('Monitor only selected repositories to control notifications and API usage.')
    });
    page.add(this._repoGroup);

    const refreshRow = new Adw.ActionRow({
      title: _('Repository list'),
      subtitle: _('Refresh from repositories your token can read.')
    });
    this._refreshReposButton = new Gtk.Button({
      label: _('Refresh'),
      valign: Gtk.Align.CENTER
    });
    this._refreshReposButton.connect('clicked', () => {
      this._refreshRepositories().catch(error => {
        this._setRepositoryStatus(error.message || _('Could not refresh repositories.'));
      });
    });
    refreshRow.add_suffix(this._refreshReposButton);
    refreshRow.activatable_widget = this._refreshReposButton;
    this._repoGroup.add(refreshRow);

    this._repositoryStatusRow = new Adw.ActionRow({
      title: _('Selection')
    });
    this._repoGroup.add(this._repositoryStatusRow);
    this._setRepositoryStatus(this._selectedReposText());
  }

  _addNotificationGroup(page) {
    const group = new Adw.PreferencesGroup({
      title: _('Notifications')
    });
    page.add(group);

    group.add(this._createSwitchRow(
      'notify-failures',
      _('Notify failures'),
      _('Failures, cancellations, timed-out runs, and action-required runs.')
    ));
    group.add(this._createSwitchRow(
      'notify-watched-success',
      _('Notify watched successes'),
      _('Successful completion for runs marked as watched from the panel menu.')
    ));
    group.add(this._createSwitchRow(
      'notify-all-completions',
      _('Notify every completion'),
      _('Useful for very small selections, noisy for many workflows.')
    ));
  }

  _addPollingGroup(page) {
    const group = new Adw.PreferencesGroup({
      title: _('Polling and history')
    });
    page.add(group);

    group.add(this._createSpinRow(
      'active-poll-interval',
      _('Active polling interval'),
      _('Seconds between refreshes while runs are active.'),
      30,
      900
    ));
    group.add(this._createSpinRow(
      'idle-poll-interval',
      _('Idle polling interval'),
      _('Seconds between refreshes while all selected repositories are idle.'),
      60,
      3600
    ));
    group.add(this._createSpinRow(
      'history-days',
      _('History days'),
      _('Local workflow history retention.'),
      1,
      30
    ));
  }

  _createSwitchRow(key, title, subtitle) {
    const row = new Adw.SwitchRow({
      title,
      subtitle
    });
    this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  _createSpinRow(key, title, subtitle, lower, upper) {
    const adjustment = new Gtk.Adjustment({
      lower,
      upper,
      step_increment: 1,
      page_increment: 10,
      value: this._settings.get_uint(key)
    });
    const row = new Adw.SpinRow({
      title,
      subtitle,
      adjustment,
      digits: 0
    });

    row.connect('notify::value', () => {
      const nextValue = Math.round(row.value);
      if (this._settings.get_uint(key) !== nextValue) {
        this._settings.set_uint(key, nextValue);
      }
    });
    this._settings.connect(`changed::${key}`, () => {
      const nextValue = this._settings.get_uint(key);
      if (Math.round(row.value) !== nextValue) {
        row.value = nextValue;
      }
    });

    return row;
  }

  _saveToken() {
    const token = this._tokenRow.text.trim();
    if (!token) {
      this._tokenStatusRow.subtitle = _('Paste a token before saving.');
      return;
    }

    storeToken(token);
    this._settings.set_boolean('has-token', true);
    this._tokenRow.text = '';
    this._updateTokenStatus();
    this._setRepositoryStatus(_('Token saved. Refresh repositories when ready.'));
  }

  _deleteToken() {
    clearToken();
    this._settings.set_boolean('has-token', false);
    this._updateTokenStatus();
    this._clearRepositoryRows();
    this._settings.set_strv('selected-repositories', []);
    this._setRepositoryStatus(_('No token stored.'));
  }

  _updateTokenStatus() {
    const token = readToken();
    if (token && !this._settings.get_boolean('has-token')) {
      this._settings.set_boolean('has-token', true);
    }

    this._tokenStatusRow.subtitle = token
      ? _('Token stored in GNOME Keyring.')
      : _('No token stored.');
  }

  async _refreshRepositories() {
    const token = readToken();
    if (!token) {
      this._setRepositoryStatus(_('Save a GitHub token first.'));
      return;
    }

    this._refreshReposButton.sensitive = false;
    this._setRepositoryStatus(_('Refreshing repositories...'));

    try {
      const client = new GitHubClient(token);
      const repos = await client.listRepositories();
      this._renderRepositories(repos);
      this._setRepositoryStatus(`${repos.length} repositories available. ${this._selectedReposText()}`);
    } finally {
      this._refreshReposButton.sensitive = true;
    }
  }

  _renderRepositories(repos) {
    this._clearRepositoryRows();
    const selectedRepos = new Set(this._settings.get_strv('selected-repositories'));

    for (const repo of repos) {
      const row = new Adw.SwitchRow({
        title: repo.fullName,
        subtitle: repo.private ? _('Private') : _('Public'),
        active: selectedRepos.has(repo.fullName)
      });

      row.connect('notify::active', () => {
        this._updateSelectedRepository(repo.fullName, row.active);
      });

      this._repoRows.push(row);
      this._repoGroup.add(row);
    }
  }

  _clearRepositoryRows() {
    for (const row of this._repoRows) {
      this._repoGroup.remove(row);
    }
    this._repoRows = [];
  }

  _updateSelectedRepository(repoFullName, active) {
    const selectedRepos = new Set(this._settings.get_strv('selected-repositories'));
    if (active) {
      selectedRepos.add(repoFullName);
    } else {
      selectedRepos.delete(repoFullName);
    }

    this._settings.set_strv('selected-repositories', [...selectedRepos].sort());
    this._setRepositoryStatus(this._selectedReposText());
  }

  _selectedReposText() {
    const count = this._settings.get_strv('selected-repositories').length;
    if (count === 0) {
      return _('No repositories selected.');
    }

    if (count === 1) {
      return _('1 repository selected.');
    }

    return _('%d repositories selected.').format(count);
  }

  _setRepositoryStatus(text) {
    this._repositoryStatusRow.subtitle = text;
  }
}
