import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isInAppBrowser, parseRoundTokenInput } from "../src/roundSchedule.js";

const T = "0b9d6c9e-1f2a-4c3b-8d4e-5f6a7b8c9d0e";

test("parseRoundTokenInput accepts a full link, a path and a bare id", () => {
  assert.equal(parseRoundTokenInput(`https://resident-surgery-logbook.vercel.app/attendance/${T}`), T);
  assert.equal(parseRoundTokenInput(`/attendance/${T}`), T);
  assert.equal(parseRoundTokenInput(`https://x.test/attendance/${T}/?a=1#b`), T);
  assert.equal(parseRoundTokenInput(`  ${T.toUpperCase()}  `), T);
  assert.equal(parseRoundTokenInput(T), T);
});

test("isInAppBrowser flags Facebook, LINE and Instagram browsers only", () => {
  assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone) Mobile/15E148 Line/13.5.0"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (Linux; Android 14) Instagram 330.0"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone) Version/17 Mobile/15E148 Safari/604.1"), false);
  assert.equal(isInAppBrowser(""), false);
});

test("parseRoundTokenInput rejects other QR codes and garbage", () => {
  assert.equal(parseRoundTokenInput(`https://x.test/evaluate/${T}`), "");
  assert.equal(parseRoundTokenInput("https://forms.example/cme"), "");
  assert.equal(parseRoundTokenInput(""), "");
  assert.equal(parseRoundTokenInput(null), "");
  assert.equal(parseRoundTokenInput(`https://x.test/attendance/${T}/extra`), "");
  assert.equal(parseRoundTokenInput("not-a-uuid"), "");
});

test("RoundCheckIn offers the in-app scanner and reuses the existing token path", async () => {
  const page = await readFile(new URL("../src/features/RoundAttendance.jsx", import.meta.url), "utf8");
  const scanner = await readFile(new URL("../src/features/RoundQrScanner.jsx", import.meta.url), "utf8");
  assert.match(page, /import \{ RoundQrScanner \} from "\.\/RoundQrScanner"/);
  assert.match(page, /<RoundQrScanner[^>]*onToken=/);
  assert.match(page, /scannedToken/);
  assert.match(scanner, /import\("html5-qrcode"\)/);
  assert.match(scanner, /import \{ isInAppBrowser, parseRoundTokenInput \} from "\.\.\/roundSchedule"/);
  assert.match(scanner, /เปิดด้วย Safari|เปิดด้วย Chrome/);
  assert.match(scanner, /วางลิงก์/);
  assert.doesNotMatch(scanner, /supabase|rpc\(/);
});
