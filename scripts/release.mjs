#!/usr/bin/env node
// Works out the next version from Conventional Commits and writes it.
//
//   npm run release -- --dry-run          show what would happen
//   npm run release -- --bump patch       force a bump (patch, minor, major)
//   npm run release -- --notes 0.3.0      print that version's changelog section
//
// It edits the version files and CHANGELOG.md only. Committing, tagging and
// pushing is done by .github/workflows/prepare-release.yml.

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  VERSION_FILES,
  bumpVersion,
  changelogEntry,
  decideBump,
  isNoise,
  parseCommit,
  prependChangelog,
  sectionFor,
} from "./release-lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const read = (f) => readFileSync(f, "utf8");

function finish(result) {
  const lines = Object.entries(result).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
}

if (value("notes") !== undefined) {
  const text = existsSync("CHANGELOG.md")
    ? sectionFor(read("CHANGELOG.md"), value("notes").replace(/^v/, ""))
    : "";
  process.stdout.write(text);
  process.exit(0);
}

const current = JSON.parse(read("package.json")).version;

// The last release is the newest v* tag; before any tag exists, fall back to the
// release commit itself ("Fogtrail vX" or "chore(release): vX").
function lastRelease() {
  try {
    const tag = git("describe", "--tags", "--abbrev=0", "--match", "v*");
    return { ref: tag, time: Number(git("log", "-1", "--format=%ct", tag)) };
  } catch {
    const sha = git(
      "log",
      "-1",
      "--format=%H",
      "-E",
      "--grep",
      "^(Fogtrail v|chore\\(release\\): v)[0-9]",
    );
    if (!sha)
      throw new Error(
        "No v* tag and no release commit found; tag the last release first.",
      );
    return { ref: sha, time: Number(git("log", "-1", "--format=%ct", sha)) };
  }
}

const base = lastRelease();
const raw = git("log", `${base.ref}..HEAD`, "--format=%s%x1f%b%x1e");
const commits = raw
  .split("\x1e")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [subject, body = ""] = r.split("\x1f");
    return { subject, body };
  })
  .filter((c) => !isNoise(c.subject))
  .map(parseCommit);

const forced = value("bump") ?? "auto";
let level = forced === "auto" ? decideBump(commits, current) : forced;
let reason = "";

if (!["patch", "minor", "major", null].includes(level)) {
  console.error(`--bump must be auto, patch, minor or major (got ${forced})`);
  process.exit(2);
}
if (commits.length === 0) {
  level = null;
  reason = "nothing has changed since the last release";
} else if (level === null) {
  reason = `no feat: or fix: commits since ${base.ref} (${commits.length} housekeeping)`;
} else if (forced === "auto" && value("min-hours")) {
  const age = (Date.now() / 1000 - base.time) / 3600;
  if (age < Number(value("min-hours"))) {
    level = null;
    reason = `last release was ${age.toFixed(1)} h ago, waiting for ${value("min-hours")} h`;
  }
}

if (level === null) {
  finish({ released: false, reason });
  process.exit(0);
}

const version = bumpVersion(current, level);
const date = new Date().toISOString().slice(0, 10);
const entry = changelogEntry(version, date, commits);

if (!flag("dry-run")) {
  const files = Object.fromEntries(VERSION_FILES.map((f) => [f, read(f)]));
  const { writeVersion } = await import("./release-lib.mjs");
  for (const [f, text] of Object.entries(writeVersion(files, version))) {
    if (text !== files[f]) writeFileSync(f, text);
  }
  writeFileSync(
    "CHANGELOG.md",
    prependChangelog(
      existsSync("CHANGELOG.md") ? read("CHANGELOG.md") : "",
      entry,
    ),
  );
}

console.error(
  `${flag("dry-run") ? "[dry run] " : ""}${current} -> ${version} (${level}, ${commits.length} commits)\n\n${entry}`,
);
finish({
  released: true,
  version,
  tag: `v${version}`,
  bump: level,
  commits: commits.length,
});
