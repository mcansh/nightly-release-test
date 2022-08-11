import type { RestEndpointMethodTypes } from "@octokit/rest";
import * as semver from "semver";

import {
  PR_FILES_STARTS_WITH,
  NIGHTLY_BRANCH,
  DEFAULT_BRANCH,
  PACKAGE_VERSION_TO_FOLLOW,
  OWNER,
  REPO,
} from "./constants";
import { gql, graphqlWithAuth, octokit } from "./octokit";
import { cleanupRef, cleanupTagName, MinimalTag } from "./utils";
import { checkIfStringStartsWith, sortByDate } from "./utils";

type PullRequest =
  RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];

type PullRequestFiles =
  RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"];

interface PrsMergedSinceLastTagResult {
  merged: Awaited<ReturnType<typeof getPullRequestWithFiles>>;
  previousTag: string;
}

export async function prsMergedSinceLastTag(
  githubRef: string
): Promise<PrsMergedSinceLastTagResult> {
  let { currentTag, previousTag } = await getPreviousTagFromCurrentTag(
    githubRef
  );

  let prs: Awaited<ReturnType<typeof getMergedPRsBetweenTags>> = [];

  if (currentTag.isPrerelease && previousTag.isPrerelease) {
    prs = await getMergedPRsBetweenTags(
      previousTag,
      currentTag,
      currentTag.isPrerelease && previousTag.isPrerelease
        ? NIGHTLY_BRANCH
        : DEFAULT_BRANCH
    );
  } else {
    let [nightly, stable] = await Promise.all([
      getMergedPRsBetweenTags(previousTag, currentTag, NIGHTLY_BRANCH),
      getMergedPRsBetweenTags(previousTag, currentTag, DEFAULT_BRANCH),
    ]);
    prs = nightly.concat(stable);
  }

  let prsThatTouchedFiles = await getPullRequestWithFiles(prs);

  return {
    merged: prsThatTouchedFiles,
    previousTag: previousTag.tag,
  };
}

type PullRequestWithFiles = PullRequest & {
  files: PullRequestFiles;
};

async function getPullRequestWithFiles(
  prs: Array<PullRequest>
): Promise<Array<PullRequestWithFiles>> {
  let prsWithFiles = await Promise.all(
    prs.map(async (pr) => {
      let files = await octokit.paginate(octokit.pulls.listFiles, {
        owner: OWNER,
        repo: REPO,
        per_page: 100,
        pull_number: pr.number,
      });

      return { ...pr, files };
    })
  );

  return prsWithFiles.filter((pr) => {
    return pr.files.some((file) => {
      return checkIfStringStartsWith(file.filename, PR_FILES_STARTS_WITH);
    });
  });
}

function filterTags(tags: Array<Tag>) {
  return tags.filter((tag) => {
    if (PACKAGE_VERSION_TO_FOLLOW) {
      return tag.ref.startsWith(`refs/tags/${PACKAGE_VERSION_TO_FOLLOW}`);
    }
    return true;
  });
}

function createMinimalTags(tags: Array<TagWithCommit>): Array<MinimalTag> {
  return tags
    .map((tag) => {
      let tagName = cleanupTagName(cleanupRef(tag.ref));
      let isPrerelease = semver.prerelease(tagName) !== null;

      if (!tag.commit.committer?.date) return null;

      return {
        tag: tagName,
        date: new Date(tag.commit.committer.date),
        isPrerelease,
      };
    })
    .filter((v: unknown): v is MinimalTag => typeof v !== "undefined")
    .sort(sortByDate);
}

async function getCommitFromTag(tag: Tag) {
  let { data: fullTag } = await octokit.git.getTag({
    owner: OWNER,
    repo: REPO,
    tag_sha: tag.object.sha,
  });

  let { data: commit } = await octokit.git.getCommit({
    owner: OWNER,
    repo: REPO,
    commit_sha: fullTag.object.sha,
  });

  return { ...tag, commit };
}

type Tag = Awaited<
  ReturnType<typeof octokit.rest.git.listMatchingRefs>
>["data"][number];
type TagWithCommit = Awaited<ReturnType<typeof getCommitFromTag>>;

async function getPreviousTagFromCurrentTag(currentTag: string): Promise<{
  previousTag: MinimalTag;
  currentTag: MinimalTag;
}> {
  let isPrerelease = semver.prerelease(currentTag) !== null;
  let { data: tags }: { data: Array<Tag> } = await octokit.request(
    "GET /repos/{owner}/{repo}/git/refs/tags/{ref}",
    {
      owner: OWNER,
      repo: REPO,
      ref: isPrerelease ? "v0.0.0-nightly-" : `remix`,
    }
  );

  let validTags = filterTags(tags);
  let tagCommitPromises = validTags.map((tag) => getCommitFromTag(tag));
  let validTagsWithCommit = await Promise.all(tagCommitPromises);
  let minimalTags = createMinimalTags(validTagsWithCommit);
  let tmpCurrentTagIndex = minimalTags.findIndex((tag) => {
    return tag.tag === currentTag;
  });

  if (isPrerelease) {
    minimalTags = minimalTags.sort((a, b) => {
      return b.date.getTime() - a.date.getTime();
    });
  }

  let tmpCurrentTagInfo = minimalTags.at(tmpCurrentTagIndex);

  if (!tmpCurrentTagInfo) {
    throw new Error(`Could not find last tag ${currentTag}`);
  }

  let currentTagInfo: MinimalTag | undefined;
  let previousTagInfo: MinimalTag | undefined;

  // if the currentTag was a stable tag, then we want to find the previous stable tag
  if (!tmpCurrentTagInfo.isPrerelease) {
    let stableTags = minimalTags
      .filter((tag) => !tag.isPrerelease)
      .sort((a, b) => semver.rcompare(a.tag, b.tag));

    let stableTagIndex = stableTags.findIndex((tag) => tag.tag === currentTag);
    currentTagInfo = stableTags.at(stableTagIndex);
    if (!currentTagInfo) {
      throw new Error(`Could not find last stable tag ${currentTag}`);
    }

    previousTagInfo = stableTags.at(stableTagIndex + 1);
    if (!previousTagInfo) {
      throw new Error(`No previous stable tag found from ${currentTag}`);
    }

    return { currentTag: currentTagInfo, previousTag: previousTagInfo };
  }

  currentTagInfo = tmpCurrentTagInfo;
  if (!currentTagInfo) {
    throw new Error(`Could not find last tag ${currentTag}`);
  }

  previousTagInfo = minimalTags.at(tmpCurrentTagIndex + 1);

  if (!previousTagInfo) {
    throw new Error(
      `Could not find previous prerelease tag from ${currentTag}`
    );
  }

  return {
    currentTag: currentTagInfo,
    previousTag: previousTagInfo,
  };
}

async function getMergedPRsBetweenTags(
  startTag: MinimalTag,
  endTag: MinimalTag,
  baseRef: string,
  page: number = 1,
  nodes: Array<PullRequest> = []
): Promise<Array<PullRequest>> {
  let pulls = await octokit.pulls.list({
    owner: OWNER,
    repo: REPO,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 100,
    page,
    base: baseRef,
  });

  let merged = pulls.data.filter((pull) => {
    if (!pull.merged_at) return false;
    let mergedDate = new Date(pull.merged_at);
    return mergedDate > startTag.date && mergedDate < endTag.date;
  });

  if (pulls.data.length !== 0) {
    return getMergedPRsBetweenTags(startTag, endTag, baseRef, page + 1, [
      ...nodes,
      ...merged,
    ]);
  }

  return [...nodes, ...merged];
}

export async function getIssuesClosedByPullRequests(
  prHtmlUrl: string,
  prBody: string | null
): Promise<Array<number>> {
  let linkedIssues = await getIssuesLinkedToPullRequest(prHtmlUrl);
  if (!prBody) return linkedIssues.map((issue) => issue.number);

  /**
   * This regex matches for one of github's issue references for auto linking an issue to a PR
   * as that only happens when the PR is sent to the default branch of the repo
   * https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue#linking-a-pull-request-to-an-issue-using-a-keyword
   */
  let regex =
    /(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s#([0-9]+)/gi;
  let matches = prBody.match(regex);
  if (!matches) return linkedIssues.map((issue) => issue.number);

  let issues = matches.map((match) => {
    let [, issueNumber] = match.split(" #");
    return { number: parseInt(issueNumber, 10) };
  });

  return [...linkedIssues, ...issues.filter((issue) => issue !== null)].map(
    (issue) => issue.number
  );
}

interface GitHubClosingIssueReference {
  resource: {
    closingIssuesReferences: {
      pageInfo: {
        endCursor: string;
        hasNextPage: boolean;
      };
      nodes: Array<{ number: number }>;
    };
  };
}

async function getIssuesLinkedToPullRequest(
  prHtmlUrl: string,
  nodes: Array<{ number: number }> = [],
  after?: string
): Promise<Array<{ number: number }>> {
  let res: GitHubClosingIssueReference = await graphqlWithAuth(
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

export async function commentOnPullRequest({
  pr,
  version,
}: {
  pr: number;
  version: string;
}) {
  await octokit.issues.createComment({
    owner: OWNER,
    repo: REPO,
    issue_number: pr,
    body: `🤖 Hello there,\n\nWe just published version \`${version}\` which includes this pull request. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
  });
}

export async function commentOnIssue({
  issue,
  version,
}: {
  issue: number;
  version: string;
}) {
  await octokit.issues.createComment({
    owner: OWNER,
    repo: REPO,
    issue_number: issue,
    body: `🤖 Hello there,\n\nWe just published version \`${version}\` which involves this issue. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
  });
}
