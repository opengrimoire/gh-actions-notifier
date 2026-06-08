imports.gi.versions.Adw = '1';
imports.gi.versions.Gtk = '4.0';

const Adw = imports.gi.Adw;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const GitHub = Me.imports.github;
const Secrets = Me.imports.secrets;

const TOKEN_CREATION_URL = 'https://github.com/settings/personal-access-tokens/new';

let settings = null;
let repoGroup = null;
let repoRows = [];
let tokenStatusRow = null;
let tokenRow = null;
let refreshReposButton = null;
let repositoryStatusRow = null;

function _(text) {
  return text;
}

function init() {
}

function fillPreferencesWindow(window) {
  Adw.init();

  settings = ExtensionUtils.getSettings();
  repoRows = [];

  window.set_title(_('GitHub Actions Notifier'));
  window.set_default_size(760, 680);

  const page = new Adw.PreferencesPage({
    title: _('General'),
    icon_name: 'emblem-system-symbolic'
  });
  window.add(page);

  addAccountGroup(page);
  addRepositoryGroup(page);
  addNotificationGroup(page);
  addPollingGroup(page);
  updateTokenStatus();
}

function addAccountGroup(page) {
  const group = new Adw.PreferencesGroup({
    title: _('GitHub account')
  });
  page.add(group);

  tokenStatusRow = new Adw.ActionRow({
    title: _('Token status')
  });
  group.add(tokenStatusRow);

  tokenRow = new Adw.PasswordEntryRow({
    title: _('Fine-grained personal access token')
  });
  group.add(tokenRow);

  const saveButton = new Gtk.Button({
    label: _('Save token'),
    valign: Gtk.Align.CENTER
  });
  saveButton.add_css_class('suggested-action');
  saveButton.connect('clicked', saveToken);
  tokenRow.add_suffix(saveButton);

  const deleteRow = new Adw.ActionRow({
    title: _('Delete stored token'),
    subtitle: _('Removes the token from GNOME Keyring.')
  });
  const deleteButton = new Gtk.Button({
    label: _('Delete'),
    valign: Gtk.Align.CENTER
  });
  deleteButton.add_css_class('destructive-action');
  deleteButton.connect('clicked', deleteToken);
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

function addRepositoryGroup(page) {
  repoGroup = new Adw.PreferencesGroup({
    title: _('Repositories'),
    description: _('Monitor only selected repositories to control notifications and API usage.')
  });
  page.add(repoGroup);

  const refreshRow = new Adw.ActionRow({
    title: _('Repository list'),
    subtitle: _('Refresh from repositories your token can read.')
  });
  refreshReposButton = new Gtk.Button({
    label: _('Refresh'),
    valign: Gtk.Align.CENTER
  });
  refreshReposButton.connect('clicked', () => {
    refreshRepositories().catch(error => {
      setRepositoryStatus(error.message || _('Could not refresh repositories.'));
    });
  });
  refreshRow.add_suffix(refreshReposButton);
  refreshRow.activatable_widget = refreshReposButton;
  repoGroup.add(refreshRow);

  repositoryStatusRow = new Adw.ActionRow({
    title: _('Selection')
  });
  repoGroup.add(repositoryStatusRow);
  setRepositoryStatus(selectedReposText());
}

function addNotificationGroup(page) {
  const group = new Adw.PreferencesGroup({
    title: _('Notifications')
  });
  page.add(group);

  group.add(createSwitchRow(
    'notify-failures',
    _('Notify failures'),
    _('Failures, cancellations, timed-out runs, and action-required runs.')
  ));
  group.add(createSwitchRow(
    'notify-watched-success',
    _('Notify watched successes'),
    _('Successful completion for runs marked as watched from the panel menu.')
  ));
  group.add(createSwitchRow(
    'notify-all-completions',
    _('Notify every completion'),
    _('Useful for very small selections, noisy for many workflows.')
  ));
}

function addPollingGroup(page) {
  const group = new Adw.PreferencesGroup({
    title: _('Polling and history')
  });
  page.add(group);

  group.add(createSpinRow(
    'active-poll-interval',
    _('Active polling interval'),
    _('Seconds between refreshes while runs are active.'),
    30,
    900
  ));
  group.add(createSpinRow(
    'idle-poll-interval',
    _('Idle polling interval'),
    _('Seconds between refreshes while all selected repositories are idle.'),
    60,
    3600
  ));
  group.add(createSpinRow(
    'history-days',
    _('History days'),
    _('Local workflow history retention.'),
    1,
    30
  ));
}

function createSwitchRow(key, title, subtitle) {
  const row = new Adw.SwitchRow({
    title,
    subtitle
  });
  settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
  return row;
}

function createSpinRow(key, title, subtitle, lower, upper) {
  const adjustment = new Gtk.Adjustment({
    lower,
    upper,
    step_increment: 1,
    page_increment: 10,
    value: settings.get_uint(key)
  });
  const row = new Adw.SpinRow({
    title,
    subtitle,
    adjustment,
    digits: 0
  });

  row.connect('notify::value', () => {
    const nextValue = Math.round(row.value);
    if (settings.get_uint(key) !== nextValue) {
      settings.set_uint(key, nextValue);
    }
  });
  settings.connect(`changed::${key}`, () => {
    const nextValue = settings.get_uint(key);
    if (Math.round(row.value) !== nextValue) {
      row.value = nextValue;
    }
  });

  return row;
}

function saveToken() {
  const token = tokenRow.text.trim();
  if (!token) {
    tokenStatusRow.subtitle = _('Paste a token before saving.');
    return;
  }

  Secrets.storeToken(token);
  settings.set_boolean('has-token', true);
  tokenRow.text = '';
  updateTokenStatus();
  setRepositoryStatus(_('Token saved. Refresh repositories when ready.'));
}

function deleteToken() {
  Secrets.clearToken();
  settings.set_boolean('has-token', false);
  updateTokenStatus();
  clearRepositoryRows();
  settings.set_strv('selected-repositories', []);
  setRepositoryStatus(_('No token stored.'));
}

function updateTokenStatus() {
  const token = Secrets.readToken();
  if (token && !settings.get_boolean('has-token')) {
    settings.set_boolean('has-token', true);
  }

  tokenStatusRow.subtitle = token
    ? _('Token stored in GNOME Keyring.')
    : _('No token stored.');
}

async function refreshRepositories() {
  const token = Secrets.readToken();
  if (!token) {
    setRepositoryStatus(_('Save a GitHub token first.'));
    return;
  }

  refreshReposButton.sensitive = false;
  setRepositoryStatus(_('Refreshing repositories...'));

  try {
    const client = new GitHub.GitHubClient(token);
    const repos = await client.listRepositories();
    renderRepositories(repos);
    setRepositoryStatus(`${repos.length} repositories available. ${selectedReposText()}`);
  } finally {
    refreshReposButton.sensitive = true;
  }
}

function renderRepositories(repos) {
  clearRepositoryRows();
  const selectedRepos = new Set(settings.get_strv('selected-repositories'));

  for (const repo of repos) {
    const row = new Adw.SwitchRow({
      title: repo.fullName,
      subtitle: repo.private ? _('Private') : _('Public'),
      active: selectedRepos.has(repo.fullName)
    });

    row.connect('notify::active', () => {
      updateSelectedRepository(repo.fullName, row.active);
    });

    repoRows.push(row);
    repoGroup.add(row);
  }
}

function clearRepositoryRows() {
  for (const row of repoRows) {
    repoGroup.remove(row);
  }
  repoRows = [];
}

function updateSelectedRepository(repoFullName, active) {
  const selectedRepos = new Set(settings.get_strv('selected-repositories'));
  if (active) {
    selectedRepos.add(repoFullName);
  } else {
    selectedRepos.delete(repoFullName);
  }

  settings.set_strv('selected-repositories', Array.from(selectedRepos).sort());
  setRepositoryStatus(selectedReposText());
}

function selectedReposText() {
  const count = settings.get_strv('selected-repositories').length;
  if (count === 0) {
    return _('No repositories selected.');
  }

  if (count === 1) {
    return _('1 repository selected.');
  }

  return `${count} repositories selected.`;
}

function setRepositoryStatus(text) {
  repositoryStatusRow.subtitle = text;
}
