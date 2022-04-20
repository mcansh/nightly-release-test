if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}
if (!process.env.GITHUB_REPOSITORY) {
  throw new Error("GITHUB_REPOSITORY is required");
}
if (!process.env.GITHUB_REF) {
  throw new Error("GITHUB_REF is required");
}
if (!process.env.GITHUB_REF.startsWith("refs/tags/")) {
  throw new Error(
    "GITHUB_REF must be a tag received " + process.env.GITHUB_REF
  );
}

export const [OWNER, REPO] = process.env.GITHUB_REPOSITORY.split("/");
export const LATEST_RELEASE = process.env.GITHUB_REF.replace("refs/tags/", "");
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
export const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

/**
  if you're changing the paths to be counted, make sure you also update
  /.github/workflows/release.yml
 */
export const PR_FILES_STARTS_WITH = ["src/"];
