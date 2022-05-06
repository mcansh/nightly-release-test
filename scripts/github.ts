import semver from "semver";
import { PR_FILES_STARTS_WITH } from "./constants";
import { gql, graphqlWithAuth, octokit } from "./octokit";
import { checkIfStringStartsWith, MinimalTag, sortByDate } from "./utils";

export async function prsMergedSinceLastTag({
  owner,
  repo,
  githubRef,
}: {
  owner: string;
  repo: string;
  githubRef: string;
}): Promise<{ merged: Array<any>; previousTag: string }> {
  let tags = await getAllTags(owner, repo);
  let { currentTag, previousTag } = getPreviousTagFromCurrentTag(
    githubRef,
    tags
  );

  let prs = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  });

  let startDate = previousTag.date;
  let endDate = currentTag.date;

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
    previousTag: previousTag.tag,
    merged: prsWithFiles.filter((pr) => {
      return pr.files.some((file) => {
        return checkIfStringStartsWith(file.filename, PR_FILES_STARTS_WITH);
      });
    }),
  };
}

function getPreviousTagFromCurrentTag(
  currentTag: string,
  tags: Array<GitHubTagNode>
): {
  previousTag: MinimalTag;
  currentTag: MinimalTag;
} {
  let validTags = tags
    .map((tag) => {
      if (!tag.node.target.tagger?.date) return;
      let isPrerelease = semver.prerelease(tag.node.name) !== null;
      return {
        tag: tag.node.name,
        date: new Date(tag.node.target.tagger.date),
        isPrerelease,
      };
    })
    .filter((v: any): v is MinimalTag => typeof v !== "undefined")
    .sort(sortByDate);

  let tmpCurrentTagIndex = validTags.findIndex((tag) => tag.tag === currentTag);
  let tmpCurrentTagInfo = validTags.at(tmpCurrentTagIndex);

  if (!tmpCurrentTagInfo) {
    throw new Error(`Could not find last tag ${currentTag}`);
  }

  let currentTagInfo: MinimalTag | undefined;
  let previousTagInfo: MinimalTag | undefined;

  // if the currentTag was a stable tag, then we want to find the previous stable tag
  if (!tmpCurrentTagInfo.isPrerelease) {
    let stableTags = validTags
      .filter((tag) => !tag.isPrerelease)
      .sort((a, b) => semver.rcompare(a.tag, b.tag));

    let stableTagIndex = stableTags.findIndex((tag) => tag.tag === currentTag);
    currentTagInfo = stableTags.at(stableTagIndex);
    if (!currentTagInfo) {
      throw new Error(`Could not find last stable tag ${currentTag}`);
    }

    previousTagInfo = stableTags.at(stableTagIndex + 1);
    if (!previousTagInfo) {
      throw new Error(`Could not find previous stable tag from ${currentTag}`);
    }

    console.log({ currentTag: currentTagInfo, previousTag: previousTagInfo });

    return { currentTag: currentTagInfo, previousTag: previousTagInfo };
  }

  currentTagInfo = tmpCurrentTagInfo;
  if (!currentTagInfo) {
    throw new Error(`Could not find last tag ${currentTag}`);
  }

  previousTagInfo = validTags.at(tmpCurrentTagIndex + 1);
  if (!previousTagInfo) {
    throw new Error(
      `Could not find previous prerelease tag from ${currentTag}`
    );
  }

  console.log({ currentTag: currentTagInfo, previousTag: previousTagInfo });

  if (previousTagInfo.date > tmpCurrentTagInfo.date) {
    console.log("previous tag is newer");
  }

  return {
    currentTag: currentTagInfo,
    previousTag: previousTagInfo,
  };
}

interface GitHubTagNode {
  node: {
    name: string;
    target: {
      tagger?: {
        date: string;
      };
    };
  };
}

interface GitHubTagsResponse {
  repository: {
    refs: {
      pageInfo: {
        endCursor: string;
        hasNextPage: boolean;
      };
      edges: Array<GitHubTagNode>;
    };
  };
}

// TODO: only fetch until we get to the last stable
async function getAllTags(
  owner: string,
  repo: string,
  nodes: Array<GitHubTagNode> = [],
  after?: string
): Promise<Array<GitHubTagNode>> {
  let res: GitHubTagsResponse = await graphqlWithAuth(
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

export async function getIssuesClosedByPullRequests(
  prHtmlUrl: string,
  prBody: string | undefined
): Promise<Array<number>> {
  let linkedIssues = await getIssuesLinkedToPullRequest(prHtmlUrl);
  if (!prBody) return linkedIssues.map((issue) => issue.number);

  /**
   * This regex matches for one of github's issue references for auto linking an issue to a PR
   * as that only happens when the PR is sent to the default branch of the repo
   * https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue#linking-a-pull-request-to-an-issue-using-a-keyword
   */
  let regex =
    /([close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved]*.?\s+).?#([0-9]+)/gi;
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
  owner,
  repo,
  pr,
  version,
}: {
  owner: string;
  repo: string;
  pr: number;
  version: string;
}) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pr,
    body: `🤖 Hello there,\n\nWe just published version \`${version}\` which includes this pull request. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
  });
}

export async function commentOnIssue({
  owner,
  repo,
  issue,
  version,
}: {
  owner: string;
  repo: string;
  issue: number;
  version: string;
}) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issue,
    body: `🤖 Hello there,\n\nWe just published version \`${version}\` which involves this issue. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
  });
}
