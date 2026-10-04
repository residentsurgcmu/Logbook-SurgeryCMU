import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NAV_GROUPS, groupNav } from "../src/navGroups.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("menu items are grouped in their role order and nothing is dropped", () => {
  const staffNav = [["pending", "รอประเมิน (2)"], ["scan", "สแกน QR"], ["dashboard", "Dashboard"], ["history", "ผลการประเมิน"], ["attendance", "เช็กชื่อประชุม"], ["cases", "New admissions"], ["conference", "ประชุมวันศุกร์"], ["notifications", "Notification"], ["exams", "ผลการสอบ"]];
  const groups = groupNav(staffNav);
  assert.deepEqual(groups.map(([title]) => title), ["การประเมิน", "เคสและประชุม", "อื่นๆ"]);
  assert.deepEqual(groups[0][1].map(([id]) => id), ["pending", "scan", "dashboard", "history"]);
  assert.deepEqual(groups[1][1].map(([id]) => id), ["attendance", "cases", "conference"]);
  assert.equal(groups.flatMap(([, items]) => items).length, staffNav.length);
});

test("an unknown future tab still appears (under อื่นๆ) and empty groups are hidden", () => {
  const groups = groupNav([["dashboard", "Dashboard"], ["future-tab", "ใหม่"]]);
  assert.deepEqual(groups.map(([title]) => title), ["การประเมิน", "อื่นๆ"]);
  assert.deepEqual(groups[1][1], [["future-tab", "ใหม่"]]);
});

test("every tab the app can show belongs to a group", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  const ids = [...shell.matchAll(/\["([a-z-]+)", (?:"|`|workspace)/g)].map((match) => match[1]);
  const grouped = new Set(NAV_GROUPS.flatMap(([, list]) => list));
  for (const id of new Set(ids)) assert.ok(grouped.has(id), `${id} has no group`);
});

test("the shell is a sidebar with the original logo and a top bar with the user", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  assert.match(shell, /className=\{`app-sidebar\$\{menuOpen \? " open" : ""\}`\}/);
  assert.match(shell, /src="\/surgery-cmu-logo\.png"/);
  assert.match(shell, /groupNav\(nav\)/);
  assert.match(shell, /className="app-topbar"/);
  assert.match(shell, /aria-expanded=\{menuOpen\}/);
  assert.match(shell, /setMenuOpen\(false\)/);
  assert.match(shell, /className="header-user-name"/);
  assert.match(shell, /className="role-chip"/);
  // Old horizontal tab bar and its scroll-into-view effect are gone.
  assert.doesNotMatch(shell, /navRef/);
  assert.doesNotMatch(shell, /<header[\s>]/);
});

test("the shell is flat: a solid sidebar, and only the sticky top bar is translucent", async () => {
  const css = await read("src/resident.css");
  assert.doesNotMatch(css.match(/\.app-sidebar \{[^}]*\}/)[0], /backdrop-filter/);
  assert.match(css, /\.app-topbar \{[^}]*backdrop-filter:/);
  assert.match(css, /@media \(max-width:900px\) \{[^@]*\.app-sidebar \{[^}]*transform:translateX\(-120%\)/);
  assert.match(css, /Opaque information surfaces: never turn tables, forms, or clinical records into glass\./);
});

test("on phones the single column cannot grow wider than the screen and the top bar fits", async () => {
  const css = await read("src/resident.css");
  const mobile = css.slice(css.lastIndexOf("@media (max-width:900px) {"));
  assert.match(mobile, /\.app-shell-v2 \{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.app-user \{[^}]*min-width:0/);
  assert.match(css, /@media \(max-width:560px\) \{[^}]*\.app-shell-v2 \.header-user-name \{[^}]*max-width:10ch/);
});
