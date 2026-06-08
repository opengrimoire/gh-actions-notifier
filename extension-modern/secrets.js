import Secret from 'gi://Secret?version=1';

const TOKEN_SERVICE = 'github-actions-notifier';
const TOKEN_ACCOUNT = 'github.com';
const TOKEN_LABEL = 'GitHub Actions Notifier token';

const TOKEN_SCHEMA = new Secret.Schema(
  'org.gnome.shell.extensions.github-actions-notifier.token',
  Secret.SchemaFlags.NONE,
  {
    service: Secret.SchemaAttributeType.STRING,
    account: Secret.SchemaAttributeType.STRING
  }
);

const TOKEN_ATTRIBUTES = {
  service: TOKEN_SERVICE,
  account: TOKEN_ACCOUNT
};

/**
 * Reads the GitHub token from GNOME Keyring.
 *
 * @returns {string} Stored token, or an empty string.
 */
export function readToken() {
  return Secret.password_lookup_sync(TOKEN_SCHEMA, TOKEN_ATTRIBUTES, null) ?? '';
}

/**
 * Stores the GitHub token in GNOME Keyring.
 *
 * @param {string} token GitHub token.
 */
export function storeToken(token) {
  Secret.password_store_sync(
    TOKEN_SCHEMA,
    TOKEN_ATTRIBUTES,
    Secret.COLLECTION_DEFAULT,
    TOKEN_LABEL,
    token.trim(),
    null
  );
}

/**
 * Deletes the GitHub token from GNOME Keyring.
 */
export function clearToken() {
  Secret.password_clear_sync(TOKEN_SCHEMA, TOKEN_ATTRIBUTES, null);
}
