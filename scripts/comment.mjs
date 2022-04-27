import {
  commentOnIssue,
  commentOnPullRequest,
  getIssuesClosedByPullRequests,
  prsMergedSinceLast,
} from "./octokit.mjs";
import { LATEST_RELEASE, OWNER, REPO } from "./constants.mjs";

async function commentOnIssuesAndPrsAboutRelease() {
  let pullRequests = await prsMergedSinceLast({
    owner: OWNER,
    repo: REPO,
    lastRelease: LATEST_RELEASE,
  });
  let suffix = pullRequests.length === 1 ? "" : "s";
  console.log(
    `Found ${pullRequests.length} PR${suffix} merged since last release (${LATEST_RELEASE})`
  );

  let promises = [];
  let issuesCommentedOn = new Set();

  for (let pr of pullRequests) {
    console.log(`commenting on pr #${pr.number}`);

    promises.push(
      commentOnPullRequest({
        owner: OWNER,
        repo: REPO,
        pr: pr.number,
        version: LATEST_RELEASE,
      })
    );

    let issuesClosed = await getIssuesClosedByPullRequests(
      pr.html_url,
      pr.body
    );

    for (let issue of issuesClosed) {
      if (issuesCommentedOn.has(issue.number)) {
        // already commented on this issue
        continue;
      }
      issuesCommentedOn.add(issue.number);
      console.log(`commenting on issue #${issue.number}`);
      promises.push(
        commentOnIssue({
          issue: issue.number,
          owner: OWNER,
          repo: REPO,
          version: LATEST_RELEASE,
        })
      );
    }
  }

  await Promise.all(promises);
}

commentOnIssuesAndPrsAboutRelease();
