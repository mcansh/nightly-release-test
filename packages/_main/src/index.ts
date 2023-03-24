import { one } from "@mcansh/nightly-release-test-one";
import { two } from "@mcansh/nightly-release-test-two";
import { three } from "@mcansh/nightly-release-test-three";
import { four } from "@mcansh/nightly-release-test-four";

export { one, two, three, four };

export function main() {
  one();
  two();
  three();
  four();
}
