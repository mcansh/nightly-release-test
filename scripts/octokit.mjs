import { Octokit as RestOctokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { graphql } from "@octokit/graphql";
import invariant from "tiny-invariant";

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

let gql = String.raw;

const Octokit = RestOctokit.plugin(paginateRest);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function prsMergedSinceStable({ owner, repo, defaultBranch }) {
  let releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });

  let sorted = releases.sort((a, b) => {
    return new Date(b.published_at) - new Date(a.published_at);
  });

  // we sorted, so we can safely assume the first one we find is the latest stable
  let lastStableIndex = sorted.findIndex((release) => {
    return release.prerelease === false && release.draft === false;
  });

  let lastStable = sorted.at(lastStableIndex);
  invariant(lastStable, "Could not find last stable release");

  let latestRelease = sorted.at(0);
  invariant(latestRelease, "Could not find latest release");

  if (lastStable.target_commitish === defaultBranch) {
    let commit = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: defaultBranch,
    });
    lastStable.target_commitish = commit.data.sha;
  }

  console.log({
    lastStable: lastStable.target_commitish,
    latestRelease: latestRelease.target_commitish,
  });

  if (
    latestRelease.prerelease === true &&
    lastStable.target_commitish === latestRelease.target_commitish
  ) {
    console.log("No commits since last stable release");
    return [];
  }

  let [startCommit, endCommit] = await Promise.all([
    octokit.repos.getCommit({
      owner,
      repo,
      sha: lastStable.target_commitish,
    }),
    octokit.repos.getCommit({
      owner,
      repo,
      sha: latestRelease.target_commitish,
    }),
  ]);

  let startDate = new Date(startCommit.commit.committer.date);
  let endDate = new Date(endCommit.data.commit.committer.date);

  const prs = await octokit.paginate(octokit.pullRequests.getAll, {
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
  });

  return prs.filter((pullRequest) => {
    if (!pullRequest.merged_at) return false;
    let mergedDate = new Date(pullRequest.merged_at);
    return mergedDate > startDate && mergedDate < endDate;
  });
}

export async function commentOnPullRequest({ owner, repo, pr, version }) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pr,
    body: `🤖 Hello there,\n\nWe just published version \`${version}\` which includes this pull request. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
  });
}

export async function commentOnIssue({ owner, repo, issue, version }) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issue,
    body: `🤖 Hello there,\n\nWe just published version \`${version}\` which involves this issue. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
  });
}

export async function getIssuesClosedByPullRequests(prHtmlUrl) {
  let res = await graphqlWithAuth(gql`
    {
      resource(url: "${prHtmlUrl}") {
        ... on PullRequest {
          closingIssuesReferences(first: 100) {
            nodes {
              number
            }
          }
        }
      }
    }
  `);

  return res?.resource?.closingIssuesReferences?.nodes;
}

export async function getDefaultBranch({ owner, repo }) {
  let response = await octokit.repos.get({ owner, repo });
  return response.data.default_branch;
}