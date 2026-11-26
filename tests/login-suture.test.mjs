import assert from "node:assert/strict";
import test from "node:test";
import { suturePose } from "../src/loginSuture.mjs";

test("the thread stays attached to the needle through the pull and returns to rest", () => {
  for (let n = 0; n <= 2350; n++) {
    const pose = suturePose(n / 2350);
    assert.deepEqual(pose.d.split(" ").slice(-2).map(Number), [pose.x, pose.y]);
  }
  assert.deepEqual(suturePose(0), suturePose(1));
  assert.notEqual(suturePose(.5).transform, suturePose(0).transform);
});
