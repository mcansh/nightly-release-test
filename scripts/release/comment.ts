import {
  VERSION,
  OWNER,
  REPO,
  PR_FILES_STARTS_WITH,
  isNightlyRelease,
  AWAITING_RELEASE_LABEL,
} from "./constants";
import {
  closeIssue,
  commentOnIssue,
  commentOnPullRequest,
  getIssuesClosedByPullRequests,
  prsMergedSinceLastTag,
  removeLabel,
} from "./github";
import { getGitHubUrl } from "./utils";

async function commentOnIssuesAndPrsAboutRelease() {
  if (VERSION.includes("experimental")) {
    return;
  }

  let { merged, previousTag } = await prsMergedSinceLastTag({
    owner: OWNER,
    repo: REPO,
    githubRef: VERSION,
  });

  let suffix = merged.length === 1 ? "" : "s";
  let prFilesDirs = PR_FILES_STARTS_WITH.join(", ");
  console.log(
    `Found ${merged.length} PR${suffix} merged ` +
      `that touched \`${prFilesDirs}\` since ` +
      `previous release (current: ${VERSION}, previous: ${previousTag})`
  );

  let promises: Array<ReturnType<typeof commentOnIssue>> = [];
  let issuesCommentedOn = new Set();

  for (let pr of merged) {
    console.log(`commenting on pr ${getGitHubUrl("pull", pr.number)}`);

    promises.push(
      commentOnPullRequest({
        owner: OWNER,
        repo: REPO,
        pr: pr.number,
        version: VERSION,
      })
    );

    let prLabels = pr.labels.map((label) => label.name);
    let prIsAwaitingRelease = prLabels.includes(AWAITING_RELEASE_LABEL);

    if (prIsAwaitingRelease) {
      promises.push(
        removeLabel({ owner: OWNER, repo: REPO, issue: pr.number })
      );
    }

    let issuesClosed = await getIssuesClosedByPullRequests(
      pr.html_url,
      pr.body
    );

    for (let issue of issuesClosed) {
      if (issuesCommentedOn.has(issue.number)) {
        // we already commented on this issue
        // so we don't need to do it again
        continue;
      }

      issuesCommentedOn.add(issue.number);
      let issueUrl = getGitHubUrl("issue", issue.number);

      if (isNightlyRelease || !prIsAwaitingRelease) {
        console.log(`commenting on ${issueUrl}`);
        promises.push(
          commentOnIssue({
            owner: OWNER,
            repo: REPO,
            issue: issue.number,
            version: VERSION,
          })
        );
      } else {
        console.log(`commenting on and closing ${issueUrl}`);
        promises.push(
          commentOnIssue({
            owner: OWNER,
            repo: REPO,
            issue: issue.number,
            version: VERSION,
          })
        );
        promises.push(
          closeIssue({ owner: OWNER, repo: REPO, issue: issue.number })
        );
      }
    }
  }

  await Promise.all(promises);
}

commentOnIssuesAndPrsAboutRelease();
