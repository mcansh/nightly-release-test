import { Octokit as RestOctokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";

import { LATEST_RELEASE, OWNER, REPO, GITHUB_TOKEN } from "./constants.mjs";

const Octokit = RestOctokit.plugin(paginateRest);
const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function deleteNightlies() {
  let releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner: OWNER,
    repo: REPO,
    per_page: 100,
  });

  let filtered = releases.filter((release) => {
    return release.tag_name.includes("nightly") === true;
  });

  for (let release of filtered) {
    if (release.tag_name === LATEST_RELEASE) {
      continue;
    }
    console.log(`deleting release ${release.tag_name}`);
    await octokit.rest.repos.deleteRelease({
      owner: OWNER,
      repo: REPO,
      release_id: release.id,
    });
  }
}

deleteNightlies();
