import { one } from "@mcansh/nightly-release-test-one";
import { two } from "@mcansh/nightly-release-test-two";
import { three } from "@mcansh/nightly-release-test-three";

export { one, two, three };

export function main() {
  one();
  two();
  three();
}
