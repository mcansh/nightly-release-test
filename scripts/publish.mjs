import path from "node:path";
import { execSync } from "node:child_process";
import fse from "fs-extra";
import semver from "semver";

let PACKAGES_DIR = path.join(process.cwd(), "packages");

function getTaggedVersion() {
  let output = process.env.NEXT_VERSION.toString().trim();
  return output.replace(/^v/g, "");
}

function publish(dir, tag) {
  execSync(`npm publish --access public --tag ${tag} ${dir}`, {
    stdio: "inherit",
  });
}

async function run() {
  // Make sure there's a current tag
  let taggedVersion = getTaggedVersion();
  if (taggedVersion === "") {
    console.error("Missing release version. Run the version script first.");
    process.exit(1);
  }

  let prerelease = semver.prerelease(taggedVersion);
  let prereleaseTag = prerelease ? String(prerelease[0]) : undefined;
  let tag = prereleaseTag
    ? prereleaseTag.includes("nightly")
      ? "nightly"
      : prereleaseTag.includes("experimental")
      ? "experimental"
      : prereleaseTag
    : "latest";

  let packages = await fse.readdir(PACKAGES_DIR);

  for (let pkg of packages) {
    publish(path.join(PACKAGES_DIR, pkg), tag);
  }
}

run().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
