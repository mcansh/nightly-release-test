import {
  commentOnIssue,
  commentOnPullRequest,
  getIssuesClosedByPullRequests,
  prsMergedSinceLastTag,
} from "./octokit.mjs";
import {
  LATEST_RELEASE,
  OWNER,
  PR_FILES_STARTS_WITH,
  REPO,
} from "./constants.mjs";

async function commentOnIssuesAndPrsAboutRelease() {
  if (LATEST_RELEASE.includes("experimental")) {
    return;
  }

  let { merged, previousTag } = await prsMergedSinceLastTag({
    owner: OWNER,
    repo: REPO,
    lastTag: LATEST_RELEASE,
  });

  let suffix = merged.length === 1 ? "" : "s";
  let prFilesDirs = PR_FILES_STARTS_WITH.join(", ");
  console.log(
    `Found ${merged.length} PR${suffix} merged ` +
      `that touched \`${prFilesDirs}\` since ` +
      `previous release (current: ${LATEST_RELEASE}, previous: ${previousTag})`
  );

  let promises = [];
  let issuesCommentedOn = new Set();

  for (let pr of merged) {
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
