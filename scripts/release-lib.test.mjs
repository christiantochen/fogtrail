import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  changelogEntry,
  decideBump,
  isNoise,
  parseCommit,
  prependChangelog,
  sectionFor,
  writeVersion,
} from "./release-lib.mjs";

const c = (subject, body = "") => parseCommit({ subject, body });

describe("parseCommit", () => {
  it("reads type, scope and text", () => {
    expect(c("feat(ui): add quick open")).toEqual({
      type: "feat",
      scope: "ui",
      breaking: false,
      text: "add quick open",
    });
  });
  it("sees ! and BREAKING CHANGE footers", () => {
    expect(c("feat!: drop old profiles").breaking).toBe(true);
    expect(
      c("fix: x", "details\n\nBREAKING CHANGE: format moved").breaking,
    ).toBe(true);
  });
  it("treats unprefixed subjects as other", () => {
    expect(c("Shorten the switch button label").type).toBe("other");
  });
});

describe("decideBump", () => {
  it("is null for housekeeping only", () => {
    expect(
      decideBump(
        [c("chore: bump deps"), c("docs: readme"), c("Fix typo")],
        "0.2.0",
      ),
    ).toBeNull();
  });
  it("asks for a patch on fix and perf", () => {
    expect(decideBump([c("chore: x"), c("fix: y")], "0.2.0")).toBe("patch");
    expect(decideBump([c("perf: faster scan")], "0.2.0")).toBe("patch");
  });
  it("lets a feature beat a fix", () => {
    expect(decideBump([c("fix: a"), c("feat: b")], "0.2.0")).toBe("minor");
  });
  it("bumps the minor for a breaking change below 1.0, the major after", () => {
    expect(decideBump([c("feat!: x")], "0.2.0")).toBe("minor");
    expect(decideBump([c("feat!: x")], "1.4.0")).toBe("major");
  });
});

describe("bumpVersion", () => {
  it("resets lower parts", () => {
    expect(bumpVersion("0.2.7", "minor")).toBe("0.3.0");
    expect(bumpVersion("0.3.0", "patch")).toBe("0.3.1");
    expect(bumpVersion("0.9.4", "major")).toBe("1.0.0");
  });
  it("rejects junk", () => {
    expect(() => bumpVersion("nope", "patch")).toThrow();
  });
});

describe("isNoise", () => {
  it("skips the bot's own commits", () => {
    expect(isNoise("chore(release): v0.3.0")).toBe(true);
    expect(isNoise("Update visual baselines")).toBe(true);
    expect(isNoise("feat: x")).toBe(false);
  });
});

describe("changelog", () => {
  const commits = [
    c("feat: quick open"),
    c("fix(ui): header wraps"),
    c("chore: bump vite"),
    c("Plain old subject"),
  ];
  it("groups each commit once", () => {
    const e = changelogEntry("0.3.0", "2026-11-07", commits);
    expect(e).toBe(
      [
        "## v0.3.0 (2026-11-07)",
        "",
        "### Features",
        "",
        "- quick open",
        "",
        "### Fixes",
        "",
        "- **ui:** header wraps",
        "",
        "### Maintenance",
        "",
        "- bump vite",
        "- Plain old subject",
        "",
      ].join("\n"),
    );
  });
  it("puts new entries on top and keeps old ones", () => {
    const first = prependChangelog(
      "",
      changelogEntry("0.3.0", "2026-11-07", [c("feat: a")]),
    );
    const second = prependChangelog(
      first,
      changelogEntry("0.3.1", "2026-11-08", [c("fix: b")]),
    );
    expect(second.indexOf("v0.3.1")).toBeLessThan(second.indexOf("v0.3.0"));
    expect(second.startsWith("# Changelog")).toBe(true);
    expect(second.match(/# Changelog/g)).toHaveLength(1);
    expect(second.endsWith("\n")).toBe(true);
  });
  it("extracts one section for the release notes", () => {
    const log = prependChangelog(
      prependChangelog(
        "",
        changelogEntry("0.3.0", "2026-11-07", [c("feat: a")]),
      ),
      changelogEntry("0.3.1", "2026-11-08", [c("fix: b")]),
    );
    expect(sectionFor(log, "0.3.0")).toBe("### Features\n\n- a");
    expect(sectionFor(log, "9.9.9")).toBe("");
  });
});

describe("writeVersion", () => {
  const files = {
    "package.json":
      '{\n  "name": "x",\n  "version": "0.2.0",\n  "a": { "version": "1" }\n}\n',
    "src-tauri/tauri.conf.json":
      '{\n  "productName": "x",\n  "version": "0.2.0"\n}\n',
    "src-tauri/Cargo.toml":
      '[package]\nname = "fogtrail"\nversion = "0.2.0"\n\n[dependencies]\nserde = { version = "1" }\n',
    "src-tauri/Cargo.lock":
      '[[package]]\nname = "aaa"\nversion = "1.0.0"\n\n[[package]]\nname = "fogtrail"\nversion = "0.2.0"\n',
    "package-lock.json":
      JSON.stringify(
        { name: "x", version: "0.2.0", packages: { "": { version: "0.2.0" } } },
        null,
        2,
      ) + "\n",
  };
  it("changes only the app version", () => {
    const out = writeVersion(files, "0.3.0");
    expect(out["package.json"]).toContain('"version": "0.3.0"');
    expect(out["package.json"]).toContain('"a": { "version": "1" }');
    expect(out["src-tauri/Cargo.toml"]).toContain('version = "0.3.0"');
    expect(out["src-tauri/Cargo.toml"]).toContain('serde = { version = "1" }');
    expect(out["src-tauri/Cargo.lock"]).toContain(
      'name = "aaa"\nversion = "1.0.0"',
    );
    expect(out["src-tauri/Cargo.lock"]).toContain(
      'name = "fogtrail"\nversion = "0.3.0"',
    );
    const lock = JSON.parse(out["package-lock.json"]);
    expect([lock.version, lock.packages[""].version]).toEqual([
      "0.3.0",
      "0.3.0",
    ]);
  });
});
