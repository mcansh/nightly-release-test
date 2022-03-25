import invariant from "tiny-invariant";
import {
  commentOnIssue,
  commentOnPullRequest,
  getIssuesClosedByPullRequests,
  prsMergedSinceStable,
} from "./octokit.mjs";

invariant(process.env.GITHUB_TOKEN, "GITHUB_TOKEN is required");
invariant(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY is required");

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

async function commentOnIssuesAndPrsAboutRelease() {
  let { latestRelease, pullRequests } = await prsMergedSinceStable({
    owner,
    repo,
  });

  let suffix = pullRequests.length === 1 ? "" : "s";
  console.log(`Found ${pullRequests.length} PR${suffix} merged since stable`);

  for (let pr of pullRequests) {
    console.log(`commenting on pr #${pr.number}`);
    await commentOnPullRequest({
      owner,
      repo,
      pr: pr.number,
      version: latestRelease,
    });

    let issuesClosed = await getIssuesClosedByPullRequests(pr.html_url);

    for (let issue of issuesClosed) {
      console.log(`commenting on issue #${issue.number}`);
      await commentOnIssue({
        issue: issue.number,
        owner,
        repo,
        version: latestRelease,
      });
    }
  }
}

commentOnIssuesAndPrsAboutRelease();
