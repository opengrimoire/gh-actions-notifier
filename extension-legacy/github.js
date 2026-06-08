imports.gi.versions.Soup = '3.0';

const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Core = Me.imports.core;

const API_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'github-actions-notifier-gnome-extension';
const DEFAULT_PER_PAGE = 100;

var GitHubApiError = class GitHubApiError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'GitHubApiError';
    this.statusCode = options.statusCode;
    this.responseText = options.responseText;
    this.rateLimitReset = options.rateLimitReset;
  }
};

var GitHubClient = class GitHubClient {
  constructor(token, cancellable) {
    this._token = token;
    this._session = new Soup.Session({
      user_agent: USER_AGENT
    });
    this._cancellable = cancellable || null;
  }

  async listRepositories() {
    const repos = [];
    let page = 1;

    while (page <= 10) {
      const payload = await this._requestJson(`/user/repos?per_page=${DEFAULT_PER_PAGE}&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`);
      if (!Array.isArray(payload.body) || payload.body.length === 0) {
        break;
      }

      for (const rawRepo of payload.body) {
        const repo = Core.normalizeRepository(rawRepo);
        if (repo !== null && !repo.archived) {
          repos.push(repo);
        }
      }

      if (!payload.hasNextPage) {
        break;
      }

      page += 1;
    }

    return repos.sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  async listWorkflowRuns(repoFullName, etag) {
    const path = `/repos/${encodeRepoFullName(repoFullName)}/actions/runs?per_page=20`;
    const payload = await this._requestJson(path, { etag: etag || null });

    if (payload.notModified) {
      return { runs: [], etag: payload.etag, notModified: true };
    }

    const body = payload.body;
    const rawRuns = body && typeof body === 'object' && Array.isArray(body.workflow_runs)
      ? body.workflow_runs
      : [];
    const runs = rawRuns
      .map(rawRun => Core.normalizeRun(rawRun, repoFullName))
      .filter(run => run !== null);

    return { runs, etag: payload.etag, notModified: false };
  }

  async listJobs(repoFullName, runId) {
    const jobs = [];
    let page = 1;

    while (page <= 5) {
      const payload = await this._requestJson(`/repos/${encodeRepoFullName(repoFullName)}/actions/runs/${runId}/jobs?per_page=${DEFAULT_PER_PAGE}&page=${page}&filter=latest`);
      const rawJobs = payload.body && typeof payload.body === 'object' && Array.isArray(payload.body.jobs)
        ? payload.body.jobs
        : [];

      for (const rawJob of rawJobs) {
        const job = Core.normalizeJob(rawJob);
        if (job !== null) {
          jobs.push(job);
        }
      }

      if (!payload.hasNextPage) {
        break;
      }

      page += 1;
    }

    return jobs;
  }

  async downloadJobLog(repoFullName, jobId) {
    const payload = await this._requestText(`/repos/${encodeRepoFullName(repoFullName)}/actions/jobs/${jobId}/logs`);
    return payload.body;
  }

  async _requestJson(path, options) {
    const response = await this._request('GET', path, options || {});

    if (response.statusCode === 304) {
      return {
        body: null,
        etag: response.etag,
        hasNextPage: false,
        notModified: true
      };
    }

    if (response.bodyText.trim() === '') {
      return {
        body: null,
        etag: response.etag,
        hasNextPage: response.hasNextPage,
        notModified: false
      };
    }

    try {
      return {
        body: JSON.parse(response.bodyText),
        etag: response.etag,
        hasNextPage: response.hasNextPage,
        notModified: false
      };
    } catch (error) {
      throw new GitHubApiError('GitHub returned invalid JSON.', {
        statusCode: response.statusCode,
        responseText: String(error),
        rateLimitReset: response.rateLimitReset
      });
    }
  }

  async _requestText(path) {
    const response = await this._request('GET', path, {});
    return { body: response.bodyText };
  }

  async _request(method, path, options) {
    const message = Soup.Message.new(method, `${API_BASE_URL}${path}`);

    message.request_headers.append('Accept', 'application/vnd.github+json');
    message.request_headers.append('Authorization', `Bearer ${this._token}`);
    message.request_headers.append('X-GitHub-Api-Version', API_VERSION);

    if (options.etag) {
      message.request_headers.append('If-None-Match', options.etag);
    }

    const bytes = await this._sendAndRead(message);
    const statusCode = message.status_code;
    const responseHeaders = message.response_headers;
    const bodyText = new TextDecoder().decode(bytes.get_data());
    const rateLimitReset = parseRateLimitReset(responseHeaders);

    if (statusCode !== 304 && (statusCode < 200 || statusCode >= 300)) {
      throw new GitHubApiError(formatHttpError(statusCode, bodyText), {
        statusCode,
        responseText: bodyText,
        rateLimitReset
      });
    }

    return {
      statusCode,
      bodyText,
      etag: responseHeaders.get_one('ETag') || responseHeaders.get_one('etag') || null,
      hasNextPage: linkHasNextPage(responseHeaders.get_one('Link') || responseHeaders.get_one('link') || ''),
      rateLimitReset
    };
  }

  _sendAndRead(message) {
    return new Promise((resolve, reject) => {
      this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        this._cancellable,
        (session, result) => {
          try {
            resolve(session.send_and_read_finish(result));
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }
};

function encodeRepoFullName(repoFullName) {
  return repoFullName
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

function parseRateLimitReset(headers) {
  const value = headers.get_one('X-RateLimit-Reset') || headers.get_one('x-ratelimit-reset');
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function linkHasNextPage(linkHeader) {
  return linkHeader.split(',').some(part => part.includes('rel="next"'));
}

function formatHttpError(statusCode, bodyText) {
  if (statusCode === 401) {
    return 'GitHub authentication failed. Check the token in preferences.';
  }

  if (statusCode === 403) {
    return 'GitHub rejected the request. Check token permissions or rate limits.';
  }

  if (statusCode === 404) {
    return 'GitHub resource was not found. Check repository access.';
  }

  if (bodyText.trim()) {
    return `GitHub request failed with HTTP ${statusCode}: ${bodyText.slice(0, 160)}`;
  }

  return `GitHub request failed with HTTP ${statusCode}.`;
}
