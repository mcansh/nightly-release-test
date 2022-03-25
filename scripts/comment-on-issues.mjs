import invariant from "tiny-invariant";
import {
  commentOnIssue,
  commentOnPullRequest,
  getDefaultBranch,
  prsMergedSinceStable,
} from "./octokit.mjs";

invariant(process.env.GITHUB_TOKEN, "GITHUB_TOKEN is required");
invariant(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY is required");

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

async function commentOnIssuesAndPrsAboutRelease() {
  let defaultBranch = await getDefaultBranch({ owner, repo });
  invariant(defaultBranch, "Could not find default branch");

  let pullRequests = await prsMergedSinceStable({ owner, repo, defaultBranch });

  for (let pr of pullRequests) {
    await commentOnPullRequest({
      owner,
      repo,
      issue_number: pr.number,
      version: latestRelease.tag_name,
    });

    let issuesClosed = await getIssuesClosedByPullRequests(pr.html_url);

    console.dir(res, { depth: null });
    for (let issue of issuesClosed) {
      console.log(`commenting on issue #${issue.number}`);
      await commentOnIssue({
        issue: issue.number,
        owner,
        repo,
        version: latestRelease.tag_name,
      });
    }
  }
}

commentOnIssuesAndPrsAboutRelease();
