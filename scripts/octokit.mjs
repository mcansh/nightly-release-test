import { Octokit as RestOctokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from "@octokit/plugin-throttling";
import { graphql } from "@octokit/graphql";
import semver from "semver";

import {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_FILES_STARTS_WITH,
  PRE_RELEASE_TAGS,
} from "./constants.mjs";

const graphqlWithAuth = graphql.defaults({
  headers: { authorization: `token ${GITHUB_TOKEN}` },
});

const Octokit = RestOctokit.plugin(paginateRest, throttling);
const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  throttle: {
    onRateLimit: (retryAfter, options, octokit) => {
      octokit.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`
      );

      if (options.request.retryCount === 0) {
        // only retries once
        octokit.log.info(`Retrying after ${retryAfter} seconds!`);
        return true;
      }
    },
    onSecondaryRateLimit: (retryAfter, options, octokit) => {
      // does not retry, only logs a warning
      octokit.log.warn(
        `SecondaryRateLimit detected for request ${options.method} ${options.url}`
      );
    },
  },
});

const gql = String.raw;

export async function prsMergedSinceLastTag({
  owner,
  repo,
  lastTag: lastTagVersion,
}) {
  let tags = await getAllTags(owner, repo);

  /** @type {Array<{ name: string, date: string }>} */
  let sorted = tags
    .map((tag) => {
      if (!tag.node.target?.tagger?.date) return;
      return { name: tag.node.name, date: tag.node.target.tagger.date };
    })
    .filter(Boolean)
    .sort((a, b) => {
      return semver.rcompare(a.name, b.name) && a.date - b.date;
    });

  let lastTagIndex = sorted.findIndex((tag) => {
    return tag.name === lastTagVersion;
  });

  let lastTag = sorted.at(lastTagIndex);
  if (!lastTag) {
    throw new Error(
      `Could not find last tag ${lastTag} in ${GITHUB_REPOSITORY}`
    );
  }

  // if the lastTag was a stable tag, then we want to find the previous stable tag
  let previousTag;
  if (!lastTag.name.includes("nightly")) {
    let stableTags = sorted.filter((tag) => {
      return !PRE_RELEASE_TAGS.some((type) => tag.name.includes(type));
    });
    previousTag = stableTags.at(1);
  } else {
    previousTag = sorted.at(lastTagIndex + 1);
  }

  if (!previousTag) {
    throw new Error(`Could not find previous tag in ${GITHUB_REPOSITORY}`);
  }

  let startDate = new Date(previousTag.date);
  let endDate = new Date(lastTag.date);

  let prs = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  });

  let mergedPullRequestsSinceLastTag = prs.filter((pullRequest) => {
    if (!pullRequest.merged_at) return false;
    let mergedDate = new Date(pullRequest.merged_at);
    return mergedDate > startDate && mergedDate < endDate;
  });

  let prsWithFiles = await Promise.all(
    mergedPullRequestsSinceLastTag.map(async (pr) => {
      let files = await octokit.paginate(octokit.pulls.listFiles, {
        owner,
        repo,
        per_page: 100,
        pull_number: pr.number,
      });

      return { ...pr, files };
    })
  );

  return {
    previousTag: previousTag.name,
    merged: prsWithFiles.filter((pr) => {
      return pr.files.some((file) => {
        return checkIfStringStartsWith(file.filename, PR_FILES_STARTS_WITH);
      });
    }),
  };
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

async function getIssuesLinkedToPullRequest(prHtmlUrl, nodes = [], after) {
  let res = await graphqlWithAuth(
    gql`
      query GET_ISSUES_CLOSED_BY_PR($prHtmlUrl: URI!, $after: String) {
        resource(url: $prHtmlUrl) {
          ... on PullRequest {
            closingIssuesReferences(first: 100, after: $after) {
              nodes {
                number
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `,
    { prHtmlUrl, after }
  );

  let newNodes = res?.resource?.closingIssuesReferences?.nodes ?? [];
  nodes.push(...newNodes);

  if (res?.resource?.closingIssuesReferences?.pageInfo?.hasNextPage) {
    return getIssuesLinkedToPullRequest(
      prHtmlUrl,
      nodes,
      res?.resource?.closingIssuesReferences?.pageInfo?.endCursor
    );
  }

  return nodes;
}

/**
 * @typedef {Object} Node
 * @property {string} name
 * @property {Object} [target]
 * @property {Object} target.tagger
 * @property {string} target.tagger.date
 */

/**
 * @param {string} owner
 * @param {string} repo
 * @param {Array<Node>} [nodes]
 * @param {string} [after]
 * @returns {Promise<Array<Node>>}
 */
// TODO: only fetch until we get to the last stable
async function getAllTags(owner, repo, nodes = [], after) {
  /**
   * @typedef {Object} TagsResponse
   * @property {Object} repository
   * @property {Object} repository.refs
   * @property {Object} repository.refs.pageInfo
   * @property {boolean} repository.refs.pageInfo.hasNextPage
   * @property {string} repository.refs.pageInfo.endCursor
   * @property {Array<Node>} repository.refs.edges
   */

  /** @type {TagsResponse} */
  let res = await graphqlWithAuth(
    gql`
      query GET_TAGS($owner: String!, $repo: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          refs(
            refPrefix: "refs/tags/"
            first: 100
            after: $after
            orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                name
                target {
                  ... on Tag {
                    tagger {
                      date
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { owner, repo, after }
  );

  let newNodes = res?.repository?.refs?.edges ?? [];
  nodes.push(...newNodes);

  if (res?.repository?.refs?.pageInfo?.hasNextPage) {
    return getAllTags(
      owner,
      repo,
      nodes,
      res?.repository?.refs?.pageInfo?.endCursor
    );
  }

  return nodes;
}

export async function getIssuesClosedByPullRequests(prHtmlUrl, prBody) {
  let linked = await getIssuesLinkedToPullRequest(prHtmlUrl);
  if (!prBody) return linked;

  /**
   * This regex matches for one of github's issue references for auto linking an issue to a PR
   * as that only happens when the PR is sent to the default branch of the repo
   * https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue#linking-a-pull-request-to-an-issue-using-a-keyword
   */
  let regex =
    /([close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved]*.?\s+).?#([0-9]+)/gi;
  let matches = prBody.match(regex);
  if (!matches) return linked;

  let issues = matches.map((match) => {
    let [, issueNumber] = match.split(" #");
    return { number: parseInt(issueNumber, 10) };
  });

  return [...linked, ...issues.filter((issue) => issue !== null)];
}

function checkIfStringStartsWith(string, substrings) {
  return substrings.some((substr) => string.startsWith(substr));
}
