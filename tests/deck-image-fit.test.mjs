import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/resident.css", import.meta.url), "utf8");

test("Friday conference Deck: pictures are scaled to fit the frame and never cropped", () => {
  const frame = css.match(/\.case-present-image\s*\{[^}]*\}/)?.[0] || "";
  const picture = css.match(/\.case-present-image img\s*\{[^}]*\}/)?.[0] || "";
  assert.match(frame, /position:\s*relative/, "the frame must be the positioning box for the picture");
  assert.match(picture, /position:\s*absolute/);
  assert.match(picture, /inset:\s*0/);
  assert.match(picture, /width:\s*100%/);
  assert.match(picture, /height:\s*100%/);
  assert.match(picture, /object-fit:\s*contain/);
  assert.doesNotMatch(picture, /object-fit:\s*cover/);
});
