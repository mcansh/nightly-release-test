if (!process.env.DEFAULT_BRANCH) {
  throw new Error("DEFAULT_BRANCH is required");
}
if (!process.env.NIGHTLY_BRANCH) {
  throw new Error("NIGHTLY_BRANCH is required");
}
if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}
if (!process.env.GITHUB_REPOSITORY) {
  throw new Error("GITHUB_REPOSITORY is required");
}
if (!process.env.VERSION) {
  throw new Error("VERSION is required");
}

export const [OWNER, REPO] = process.env.GITHUB_REPOSITORY.split("/");
export const VERSION = process.env.VERSION;
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
export const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
export const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH;
export const NIGHTLY_BRANCH = process.env.NIGHTLY_BRANCH;
export const PR_FILES_STARTS_WITH = ["packages/"];
