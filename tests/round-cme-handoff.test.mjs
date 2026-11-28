import test from "node:test";
import assert from "node:assert/strict";
import { roundCmeAttendeeUrl, roundCmeSpeakerUrl } from "../src/roundCme.js";

test("only official attendee event QR links can be opened", () => {
  const attendeeUrl = "https://score.ccme.or.th/event/sample123/audience/join";
  assert.equal(roundCmeAttendeeUrl(attendeeUrl), attendeeUrl);
  for (const invalid of [
    "https://score.ccme.or.th/event/sample123/speaker/join",
    "https://score.ccme.or.th/event/sample123/join",
    "https://score.ccme.or.th@other.test/event/sample123/audience/join",
    "https://score.ccme.or.th.other.test/event/sample123/audience/join",
    "http://score.ccme.or.th/event/sample123/audience/join",
    "https://score.ccme.or.th/event/sample123/audience/join?redirect=https://other.test",
    "javascript:alert(1)",
  ]) assert.equal(roundCmeAttendeeUrl(invalid), "");
});

test("speaker QR and attendee QR cannot be assigned to each other's slots", () => {
  const speaker = "https://score.ccme.or.th/event/sample123/speaker/join";
  const attendee = "https://score.ccme.or.th/event/sample123/audience/join";
  assert.equal(roundCmeSpeakerUrl(speaker), speaker);
  assert.equal(roundCmeSpeakerUrl(attendee), "");
  assert.equal(roundCmeAttendeeUrl(speaker), "");
});
