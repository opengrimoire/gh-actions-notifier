import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {
  normalizeJob,
  normalizeRepository,
  normalizeRun
} from './core.js';

const API_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'github-actions-notifier-gnome-extension';
const DEFAULT_PER_PAGE = 100;

/**
 * Error type carrying HTTP status and rate-limit context.
 */
export class GitHubApiError extends Error {
  /**
   * @param {string} message Error message.
   * @param {object} options Error options.
   * @param {number} options.statusCode HTTP status code.
   * @param {string} options.responseText Response body.
   * @param {number | null} options.rateLimitReset Rate-limit reset time.
   */
  constructor(message, options) {
    super(message);
    this.name = 'GitHubApiError';
    this.statusCode = options.statusCode;
    this.responseText = options.responseText;
    this.rateLimitReset = options.rateLimitReset;
  }
}

/**
 * Small GitHub REST client for the extension.
 */
export class GitHubClient {
  /**
   * @param {string} token GitHub token.
   * @param {Gio.Cancellable | null} cancellable Shared cancellable.
   */
  constructor(token, cancellable = null) {
    this._token = token;
    this._session = new Soup.Session({
      user_agent: USER_AGENT
    });
    this._cancellable = cancellable;
  }

  /**
   * Lists repositories accessible to the authenticated user.
   *
   * @returns {Promise<Array<{fullName: string, owner: string, name: string, private: boolean, htmlUrl: string, archived: boolean}>>}
   */
  async listRepositories() {
    const repos = [];
    let page = 1;

    while (page <= 10) {
      const payload = await this._requestJson(`/user/repos?per_page=${DEFAULT_PER_PAGE}&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`);
      if (!Array.isArray(payload.body) || payload.body.length === 0) {
        break;
      }

      for (const rawRepo of payload.body) {
        const repo = normalizeRepository(rawRepo);
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

  /**
   * Lists recent workflow runs for a repository.
   *
   * @param {string} repoFullName Repository full name.
   * @param {string | null} etag Previous ETag.
   * @returns {Promise<{runs: Array<object>, etag: string | null, notModified: boolean}>}
   */
  async listWorkflowRuns(repoFullName, etag = null) {
    const path = `/repos/${encodeRepoFullName(repoFullName)}/actions/runs?per_page=20`;
    const payload = await this._requestJson(path, { etag });

    if (payload.notModified) {
      return { runs: [], etag: payload.etag, notModified: true };
    }

    const body = payload.body;
    const rawRuns = body && typeof body === 'object' && Array.isArray(body.workflow_runs)
      ? body.workflow_runs
      : [];
    const runs = rawRuns
      .map(rawRun => normalizeRun(rawRun, repoFullName))
      .filter(run => run !== null);

    return { runs, etag: payload.etag, notModified: false };
  }

  /**
   * Lists jobs for a workflow run.
   *
   * @param {string} repoFullName Repository full name.
   * @param {number} runId Workflow run id.
   * @returns {Promise<Array<object>>} Normalized jobs.
   */
  async listJobs(repoFullName, runId) {
    const jobs = [];
    let page = 1;

    while (page <= 5) {
      const payload = await this._requestJson(`/repos/${encodeRepoFullName(repoFullName)}/actions/runs/${runId}/jobs?per_page=${DEFAULT_PER_PAGE}&page=${page}&filter=latest`);
      const rawJobs = payload.body && typeof payload.body === 'object' && Array.isArray(payload.body.jobs)
        ? payload.body.jobs
        : [];

      for (const rawJob of rawJobs) {
        const job = normalizeJob(rawJob);
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

  /**
   * Downloads log text for one workflow job.
   *
   * @param {string} repoFullName Repository full name.
   * @param {number} jobId Job id.
   * @returns {Promise<string>} Job logs.
   */
  async downloadJobLog(repoFullName, jobId) {
    const payload = await this._requestText(`/repos/${encodeRepoFullName(repoFullName)}/actions/jobs/${jobId}/logs`);
    return payload.body;
  }

  /**
   * Performs a JSON GET request.
   *
   * @param {string} path Request path.
   * @param {{etag?: string | null}} options Request options.
   * @returns {Promise<{body: unknown, etag: string | null, hasNextPage: boolean, notModified: boolean}>}
   */
  async _requestJson(path, options = {}) {
    const response = await this._request('GET', path, {
      etag: options.etag ?? null
    });

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

  /**
   * Performs a text GET request.
   *
   * @param {string} path Request path.
   * @returns {Promise<{body: string}>}
   */
  async _requestText(path) {
    const response = await this._request('GET', path);
    return { body: response.bodyText };
  }

  /**
   * Performs an HTTP request.
   *
   * @param {string} method HTTP method.
   * @param {string} path Request path.
   * @param {{etag?: string | null}} options Request options.
   * @returns {Promise<{statusCode: number, bodyText: string, etag: string | null, hasNextPage: boolean, rateLimitReset: number | null}>}
   */
  async _request(method, path, options = {}) {
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
      etag: responseHeaders.get_one('ETag') ?? responseHeaders.get_one('etag') ?? null,
      hasNextPage: linkHasNextPage(responseHeaders.get_one('Link') ?? responseHeaders.get_one('link') ?? ''),
      rateLimitReset
    };
  }

  /**
   * Sends a request and reads the full response body.
   *
   * @param {Soup.Message} message HTTP message.
   * @returns {Promise<GLib.Bytes>} Response bytes.
   */
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
}

/**
 * Encodes owner and repository segments while keeping the slash separator.
 *
 * @param {string} repoFullName Repository full name.
 * @returns {string} Encoded repository path.
 */
export function encodeRepoFullName(repoFullName) {
  return repoFullName
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

/**
 * Parses rate-limit reset headers.
 *
 * @param {Soup.MessageHeaders} headers Response headers.
 * @returns {number | null} Unix timestamp in seconds.
 */
function parseRateLimitReset(headers) {
  const value = headers.get_one('X-RateLimit-Reset') ?? headers.get_one('x-ratelimit-reset');
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Checks whether a Link header includes a next page.
 *
 * @param {string} linkHeader Link header value.
 * @returns {boolean} Whether a next page exists.
 */
function linkHasNextPage(linkHeader) {
  return linkHeader.split(',').some(part => part.includes('rel="next"'));
}

/**
 * Formats an HTTP error.
 *
 * @param {number} statusCode HTTP status.
 * @param {string} bodyText Response body.
 * @returns {string} Error message.
 */
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
