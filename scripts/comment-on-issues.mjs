import { Octokit as RestOctokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import {
  paginateRest,
  composePaginateRest,
} from "@octokit/plugin-paginate-rest";
import prsMergedSince from "prs-merged-since";

const Octokit = RestOctokit.plugin(paginateRest);

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

let gql = String.raw;

async function getCommitsSinceLastStable() {
  let releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner: "mcansh",
    repo: "nightly-release-test",
    per_page: 100,
  });

  let sorted = releases.sort((a, b) => {
    return new Date(b.published_at) - new Date(a.published_at);
  });

  // we sorted, so we can safely assume the first one we find is the latest stable
  let lastStableIndex = sorted.findIndex((release) => {
    return release.prerelease === false && release.draft === false;
  });

  let lastStable = sorted[lastStableIndex];

  if (!lastStable) {
    throw new Error("Could not find last stable release");
  }

  let latestRelease = sorted.at(0);

  if (!latestRelease) {
    throw new Error("Could not find latest release");
  }

  if (
    latestRelease.prerelease === true &&
    lastStable.target_commitish === latestRelease.target_commitish
  ) {
    console.log("No commits since last stable release");
    return;
  }

  let prs = await prsMergedSince({
    repo: "mcansh/nightly-release-test",
    tag: lastStable.tag_name,
  });

  let latestReleaseDate = new Date(latestRelease.published_at);
  let prsBetweenReleases = prs.filter((pr) => {
    return pr.merged_at != null && latestReleaseDate > new Date(pr.merged_at);
  });

  for (let pr of prsBetweenReleases) {
    await octokit.issues.createComment({
      owner: "mcansh",
      repo: "nightly-release-test",
      issue_number: pr.number,
      body: `🤖 Hello there,\n\nWe just published version \`${latestRelease.tag_name}\` which includes this pull request. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
    });

    let res = await graphqlWithAuth(gql`
      {
        resource(url: "${pr.html_url}") {
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

    console.dir(res, { depth: null });
    for (let issue of res.resource.closingIssuesReferences.nodes) {
      console.log(`commenting on issue #${issue.number}`);
      await octokit.issues.createComment({
        owner: "mcansh",
        repo: "nightly-release-test",
        issue_number: issue.number,
        body: `🤖 Hello there,\n\nWe just published version \`${latestRelease.tag_name}\` which involves this issue. If you'd like to take it for a test run please try it out and let us know what you think!\n\nThanks!`,
      });
    }
  }
}

getCommitsSinceLastStable();
