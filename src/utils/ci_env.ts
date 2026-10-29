/**
 * Repository metadata read from the CI system the CLI runs in, so a Maestro
 * run can link back to its repository, branch, commit and pull request
 * without the user passing --repo-owner / --repo-name / --commit-sha.
 *
 * `repoUrl` is the repository's web URL on whatever host it lives on (GitHub,
 * GitLab, Bitbucket, Azure Repos, a self-hosted server); the dashboard builds
 * the branch / commit / PR links from it. `repoOwner` / `repoName` are only
 * filled in for github.com, because the API reads them as a GitHub repository
 * (status checks via the TestingBot GitHub App).
 *
 * Explicit CLI flags always win over anything detected here.
 */

import fs from 'node:fs';

export interface CiRepoMetadata {
  repoUrl?: string;
  repoOwner?: string;
  repoName?: string;
  commitSha?: string;
  branch?: string;
  pullRequestId?: string;
  pullRequestUrl?: string;
}

type Env = NodeJS.ProcessEnv;

/**
 * Turns a clone URL into the repository's web URL: SSH (`git@host:o/r.git`,
 * `ssh://git@host/o/r`) becomes https, credentials and a trailing `.git` are
 * dropped. Returns undefined for anything that is not an http(s) URL after that.
 */
export function webRepoUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  const scp = value.match(/^[^@\s/]+@([^:\s/]+):(.+)$/);
  if (scp) value = `https://${scp[1]}/${scp[2]}`;
  value = value.replace(/^ssh:\/\//, 'https://');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return undefined;
  url.username = '';
  url.password = '';
  url.port = '';
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  if (path === '' || path === '/') return undefined;
  return `${url.origin}${path}`;
}

/** `refs/heads/feature/x` → `feature/x`; other refs are returned as given. */
function stripHeads(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.replace(/^refs\/heads\//, '');
}

function githubOwnerName(
  repoUrl: string | undefined,
): Pick<CiRepoMetadata, 'repoOwner' | 'repoName'> {
  const m = repoUrl?.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  return m ? { repoOwner: m[1], repoName: m[2] } : {};
}

function readJson(path: string | undefined): Record<string, unknown> | null {
  if (!path) return null;
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function githubActions(env: Env): CiRepoMetadata {
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  const repoUrl = env.GITHUB_REPOSITORY
    ? webRepoUrl(`${server}/${env.GITHUB_REPOSITORY}`)
    : undefined;
  // On pull_request events GITHUB_SHA is the throwaway merge commit; the
  // event payload carries the PR's head commit, which is what the user pushed.
  const event = readJson(env.GITHUB_EVENT_PATH);
  const pr = event?.pull_request as
    | { number?: number; head?: { sha?: string }; html_url?: string }
    | undefined;
  const prFromRef = env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)?.[1];
  return {
    repoUrl,
    ...githubOwnerName(repoUrl),
    commitSha: pr?.head?.sha || env.GITHUB_SHA,
    branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
    pullRequestId: pr?.number ? String(pr.number) : prFromRef,
    pullRequestUrl: pr?.html_url,
  };
}

function gitlab(env: Env): CiRepoMetadata {
  const repoUrl = webRepoUrl(env.CI_PROJECT_URL);
  return {
    repoUrl,
    commitSha: env.CI_COMMIT_SHA,
    branch:
      env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME ||
      env.CI_COMMIT_BRANCH ||
      env.CI_COMMIT_REF_NAME,
    pullRequestId: env.CI_MERGE_REQUEST_IID,
  };
}

function bitbucket(env: Env): CiRepoMetadata {
  const repoUrl = webRepoUrl(env.BITBUCKET_GIT_HTTP_ORIGIN);
  return {
    repoUrl,
    commitSha: env.BITBUCKET_COMMIT,
    branch: env.BITBUCKET_BRANCH,
    pullRequestId: env.BITBUCKET_PR_ID,
  };
}

function azurePipelines(env: Env): CiRepoMetadata {
  const repoUrl = webRepoUrl(env.BUILD_REPOSITORY_URI);
  // PR builds check out a merge commit; for GitHub-hosted repositories Azure
  // also exposes the PR's own head commit. Azure Repos PRs use the ID, GitHub
  // PRs the number.
  const isPr = !!env.SYSTEM_PULLREQUEST_PULLREQUESTID;
  const prId =
    env.BUILD_REPOSITORY_PROVIDER === 'GitHub'
      ? env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER
      : env.SYSTEM_PULLREQUEST_PULLREQUESTID;
  return {
    repoUrl,
    ...githubOwnerName(repoUrl),
    commitSha: env.SYSTEM_PULLREQUEST_SOURCECOMMITID || env.BUILD_SOURCEVERSION,
    branch: isPr
      ? stripHeads(env.SYSTEM_PULLREQUEST_SOURCEBRANCH)
      : stripHeads(env.BUILD_SOURCEBRANCH) || env.BUILD_SOURCEBRANCHNAME,
    pullRequestId: isPr ? prId : undefined,
  };
}

function circleci(env: Env): CiRepoMetadata {
  const repoUrl = webRepoUrl(env.CIRCLE_REPOSITORY_URL);
  const prUrl = env.CIRCLE_PULL_REQUEST;
  return {
    repoUrl,
    ...githubOwnerName(repoUrl),
    commitSha: env.CIRCLE_SHA1,
    branch: env.CIRCLE_BRANCH,
    pullRequestId: prUrl?.match(/\/(\d+)$/)?.[1],
    pullRequestUrl: prUrl,
  };
}

/** Detects the CI system from `env` and returns what it knows; {} outside CI. */
export function ciRepoMetadata(env: Env = process.env): CiRepoMetadata {
  let detected: CiRepoMetadata = {};
  if (env.GITHUB_ACTIONS === 'true') detected = githubActions(env);
  else if (env.GITLAB_CI === 'true') detected = gitlab(env);
  else if (env.BITBUCKET_BUILD_NUMBER) detected = bitbucket(env);
  else if (env.TF_BUILD?.toLowerCase() === 'true')
    detected = azurePipelines(env);
  else if (env.CIRCLECI === 'true') detected = circleci(env);

  const result: CiRepoMetadata = {};
  for (const [key, value] of Object.entries(detected)) {
    if (value) result[key as keyof CiRepoMetadata] = value;
  }
  return result;
}
