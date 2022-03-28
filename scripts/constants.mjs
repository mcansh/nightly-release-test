import invariant from "tiny-invariant";

invariant(process.env.GITHUB_TOKEN, "GITHUB_TOKEN is required");
invariant(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY is required");
invariant(process.env.GITHUB_REF, "GITHUB_REF is required");
invariant(
  process.env.GITHUB_REF.startsWith("refs/tags/"),
  "GITHUB_REF must be a tag"
);

export const [OWNER, REPO] = process.env.GITHUB_REPOSITORY.split("/");
export const LATEST_RELEASE = process.env.GITHUB_REF.replace("refs/tags/", "");
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
export const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
