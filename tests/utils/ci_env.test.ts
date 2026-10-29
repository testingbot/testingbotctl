import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ciRepoMetadata, webRepoUrl } from '../../src/utils/ci_env';

const SHA = 'a'.repeat(40);
const HEAD = 'c'.repeat(40);

describe('webRepoUrl', () => {
  test.each([
    ['https://github.com/acme/app.git', 'https://github.com/acme/app'],
    ['git@github.com:acme/app.git', 'https://github.com/acme/app'],
    [
      'ssh://git@gitlab.example.com/grp/sub/app',
      'https://gitlab.example.com/grp/sub/app',
    ],
    ['http://bitbucket.org/acme/app', 'https://bitbucket.org/acme/app'],
    [
      'https://acme@dev.azure.com/acme/Mobile%20App/_git/app',
      'https://dev.azure.com/acme/Mobile%20App/_git/app',
    ],
    ['https://user:token@github.com/acme/app/', 'https://github.com/acme/app'],
  ])('%s → %s', (raw, expected) => {
    expect(webRepoUrl(raw)).toBe(expected);
  });

  test.each([
    undefined,
    '',
    'javascript:alert(1)',
    'file:///repo',
    'https://github.com/',
  ])('rejects %p', (raw) => {
    expect(webRepoUrl(raw)).toBeUndefined();
  });
});

describe('ciRepoMetadata', () => {
  test('outside CI returns nothing', () => {
    expect(ciRepoMetadata({})).toEqual({});
  });

  test('GitHub Actions push', () => {
    expect(
      ciRepoMetadata({
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/app',
        GITHUB_SHA: SHA,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REF_NAME: 'main',
      }),
    ).toEqual({
      repoUrl: 'https://github.com/acme/app',
      repoOwner: 'acme',
      repoName: 'app',
      commitSha: SHA,
      branch: 'main',
    });
  });

  test('GitHub Actions pull_request uses the PR head, not the merge commit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-env-'));
    const eventPath = path.join(dir, 'event.json');
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 42,
          head: { sha: HEAD },
          html_url: 'https://github.com/acme/app/pull/42',
        },
      }),
    );
    expect(
      ciRepoMetadata({
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'acme/app',
        GITHUB_SHA: SHA,
        GITHUB_REF: 'refs/pull/42/merge',
        GITHUB_REF_NAME: '42/merge',
        GITHUB_HEAD_REF: 'feature/login',
        GITHUB_EVENT_PATH: eventPath,
      }),
    ).toEqual({
      repoUrl: 'https://github.com/acme/app',
      repoOwner: 'acme',
      repoName: 'app',
      commitSha: HEAD,
      branch: 'feature/login',
      pullRequestId: '42',
      pullRequestUrl: 'https://github.com/acme/app/pull/42',
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('GitHub Enterprise gets a repoUrl but no GitHub owner/name', () => {
    const meta = ciRepoMetadata({
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://git.acme.corp',
      GITHUB_REPOSITORY: 'acme/app',
      GITHUB_SHA: SHA,
    });
    expect(meta.repoUrl).toBe('https://git.acme.corp/acme/app');
    expect(meta.repoOwner).toBeUndefined();
  });

  test('GitLab merge request', () => {
    expect(
      ciRepoMetadata({
        GITLAB_CI: 'true',
        CI_PROJECT_URL: 'https://gitlab.com/acme/mobile/app',
        CI_COMMIT_SHA: SHA,
        CI_COMMIT_REF_NAME: 'feature/x',
        CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature/x',
        CI_MERGE_REQUEST_IID: '9',
      }),
    ).toEqual({
      repoUrl: 'https://gitlab.com/acme/mobile/app',
      commitSha: SHA,
      branch: 'feature/x',
      pullRequestId: '9',
    });
  });

  test('Bitbucket Pipelines', () => {
    expect(
      ciRepoMetadata({
        BITBUCKET_BUILD_NUMBER: '17',
        BITBUCKET_GIT_HTTP_ORIGIN: 'http://bitbucket.org/acme/app',
        BITBUCKET_COMMIT: SHA,
        BITBUCKET_BRANCH: 'develop',
      }),
    ).toEqual({
      repoUrl: 'https://bitbucket.org/acme/app',
      commitSha: SHA,
      branch: 'develop',
    });
  });

  test('Azure Pipelines with Azure Repos, branch build', () => {
    expect(
      ciRepoMetadata({
        TF_BUILD: 'True',
        BUILD_REPOSITORY_PROVIDER: 'TfsGit',
        BUILD_REPOSITORY_URI: 'https://acme@dev.azure.com/acme/Mobile/_git/app',
        BUILD_SOURCEVERSION: SHA,
        BUILD_SOURCEBRANCH: 'refs/heads/feature/login',
        BUILD_SOURCEBRANCHNAME: 'login',
      }),
    ).toEqual({
      repoUrl: 'https://dev.azure.com/acme/Mobile/_git/app',
      commitSha: SHA,
      branch: 'feature/login',
    });
  });

  test('Azure Pipelines with a GitHub repository, PR build', () => {
    expect(
      ciRepoMetadata({
        TF_BUILD: 'True',
        BUILD_REPOSITORY_PROVIDER: 'GitHub',
        BUILD_REPOSITORY_URI: 'https://github.com/acme/app',
        BUILD_SOURCEVERSION: SHA,
        BUILD_SOURCEBRANCH: 'refs/pull/5/merge',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '1234567',
        SYSTEM_PULLREQUEST_PULLREQUESTNUMBER: '5',
        SYSTEM_PULLREQUEST_SOURCEBRANCH: 'feature/login',
        SYSTEM_PULLREQUEST_SOURCECOMMITID: HEAD,
      }),
    ).toEqual({
      repoUrl: 'https://github.com/acme/app',
      repoOwner: 'acme',
      repoName: 'app',
      commitSha: HEAD,
      branch: 'feature/login',
      pullRequestId: '5',
    });
  });

  test('CircleCI with an SSH remote', () => {
    expect(
      ciRepoMetadata({
        CIRCLECI: 'true',
        CIRCLE_REPOSITORY_URL: 'git@github.com:acme/app.git',
        CIRCLE_SHA1: SHA,
        CIRCLE_BRANCH: 'main',
        CIRCLE_PULL_REQUEST: 'https://github.com/acme/app/pull/3',
      }),
    ).toEqual({
      repoUrl: 'https://github.com/acme/app',
      repoOwner: 'acme',
      repoName: 'app',
      commitSha: SHA,
      branch: 'main',
      pullRequestId: '3',
      pullRequestUrl: 'https://github.com/acme/app/pull/3',
    });
  });
});
