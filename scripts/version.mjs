import { execSync } from "node:child_process";
import path from "node:path";
import semver from "semver";
import PackageJson from "@npmcli/package-json";
import { globSync } from "glob";

let packagesDir = path.join(process.cwd(), "packages");
let packages = globSync("packages/*");

/**
 * @returns {void}
 */
function ensureCleanWorkingDirectory() {
  let status = execSync(`git status --porcelain`).toString().trim();
  let lines = status.split("\n");
  if (!lines.every((line) => line === "" || line.startsWith("?"))) {
    console.error(
      "Working directory is not clean. Please commit or stash your changes."
    );
    process.exit(1);
  }
}

run(process.argv.slice(2)).then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

/**
 * @param {string[]} args
 */
async function run(args) {
  let givenVersion = args[0];
  let prereleaseId = args[1];

  // ensureCleanWorkingDirectory();

  // Get the next version number
  let pkgJson = await PackageJson.load(path.join(packagesDir, "_main"));
  let currentVersion = pkgJson.version;
  let nextVersion = semver.valid(givenVersion);
  if (nextVersion == null) {
    nextVersion = getNextVersion(currentVersion, givenVersion, prereleaseId);
  }

  await incrementVersion(nextVersion);

  // Commit and tag
  // execSync(`git commit --all --message="Version ${nextVersion}"`);
  // execSync(`git tag -a -m "Version ${nextVersion}" v${nextVersion}`);
  console.log(`✅ Committed and tagged version ${nextVersion}`);
}

function getMonoRepoPackages(pkgJson, nextVersion) {
  let dependencies = Object.keys(pkgJson.content.dependencies || {});
  let devDependencies = Object.keys(pkgJson.content.devDependencies || {});
  let peerDependencies = Object.keys(pkgJson.content.peerDependencies || {});
  let filter = (name) => name.startsWith("@mcansh/nightly-release-test-");

  return {
    dependencies: dependencies.filter(filter),
    devDependencies: devDependencies.filter(filter),
    peerDependencies: peerDependencies.filter(filter),
  };
}
/**
 * @param {string} nextVersion
 */
async function incrementVersion(nextVersion) {
  for (let dir of packages) {
    let pkgJson = await PackageJson.load(dir);

    let dependencies = getMonoRepoPackages(pkgJson);

    pkgJson.update({
      version: nextVersion,
      dependencies: dependencies.dependencies.reduce(
        (acc, name) => ({ ...acc, [name]: nextVersion }),
        {}
      ),
      devDependencies: dependencies.devDependencies.reduce(
        (acc, name) => ({ ...acc, [name]: nextVersion }),
        {}
      ),
      peerDependencies: dependencies.peerDependencies.reduce(
        (acc, name) => ({ ...acc, [name]: nextVersion }),
        {}
      ),
    });
    await pkgJson.save();
  }
}

/**
 * @param {string|undefined} currentVersion
 * @param {string} givenVersion
 * @param {string} [prereleaseId]
 * @returns
 */
function getNextVersion(currentVersion, givenVersion, prereleaseId = "pre") {
  if (givenVersion == null) {
    console.error("Missing next version. Usage: node version.js [nextVersion]");
    process.exit(1);
  }

  let nextVersion;
  if (givenVersion === "experimental") {
    let hash = execSync(`git rev-parse --short HEAD`).toString().trim();
    nextVersion = `0.0.0-experimental-${hash}`;
  } else {
    nextVersion = semver.inc(currentVersion, givenVersion, prereleaseId);
  }

  if (nextVersion == null) {
    console.error(`Invalid version specifier: ${givenVersion}`);
    process.exit(1);
  }

  return nextVersion;
}
