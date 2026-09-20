import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles, pageFromSource, parseArgs } from "../src/cli.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

function run(args: string[], input?: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, JEV_ENV_FILE: "/nonexistent/jev.env" },
  });
}

const CHROME_SNAPSHOT = [
  'uid=1_2 textbox "Search Wikipedia" value=""',
  'uid=1_3 button "Search"',
  'uid=1_4 link "Main page"',
  'uid=1_5 button "Hidden" disabled',
  "",
].join("\n");

const PLAYWRIGHT_SNAPSHOT = [
  '- textbox "Search" [ref=e23]: ',
  '- button "Search" [ref=e24]',
  '- link "Main page" [ref=e25]',
  "",
].join("\n");

describe("parseArgs", () => {
  it("parses --key value, --key=value, and bare flags", () => {
    const { command, flags } = parseArgs(["step", "--goal", "g", "--page=-", "--verbose"]);
    assert.equal(command, "step");
    assert.deepEqual(flags, { goal: "g", page: "-", verbose: "true" });
  });
});

describe("loadEnvFiles", () => {
  it("fills unset keys and never overrides the real environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, '# comment\nexport JEV_TEST_A="quoted"\nJEV_TEST_B=plain\nTYPESAFE_API_KEY=from-file\n');
    process.env.TYPESAFE_API_KEY = "from-env";
    loadEnvFiles([file]);
    assert.equal(process.env.JEV_TEST_A, "quoted");
    assert.equal(process.env.JEV_TEST_B, "plain");
    assert.equal(process.env.TYPESAFE_API_KEY, "from-env");
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_TEST_A;
    delete process.env.JEV_TEST_B;
  });
});

describe("pageFromSource", () => {
  it("parses a raw snapshot string", () => {
    const page = pageFromSource(CHROME_SNAPSHOT, "https://en.wikipedia.org", "Wikipedia");
    assert.equal(page.url, "https://en.wikipedia.org");
    assert.equal(page.actions.filter((a) => a.kind === "fill").length, 1);
    assert.equal(page.actions.filter((a) => a.kind === "click").length, 2);
    assert.ok(page.fingerprint);
  });

  it("accepts an observe envelope and a bare page", () => {
    const envelope = { page: { url: "u", title: "t", text: "x", actions: [] }, counts: {} };
    assert.equal(pageFromSource(envelope).title, "t");
    assert.equal(pageFromSource({ url: "u", title: "t", text: "x", actions: [] }).url, "u");
  });

  it("rejects unrelated JSON", () => {
    assert.throws(() => pageFromSource({ nope: true }));
  });
});

describe("jev observe", () => {
  it("reads a chrome snapshot from stdin and prints one JSON line", () => {
    const result = run(["observe", "--snapshot", "-", "--url", "https://en.wikipedia.org", "--title", "Wikipedia"], CHROME_SNAPSHOT);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const output = JSON.parse(lines[0]);
    assert.equal(output.page.url, "https://en.wikipedia.org");
    assert.equal(output.counts.click, 2);
    assert.equal(output.counts.control, 3);
    assert.ok(output.page.fingerprint);
  });

  it("parses Playwright snapshots too", () => {
    const result = run(["observe", "--snapshot", "-"], PLAYWRIGHT_SNAPSHOT);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.counts.fill, 1);
    assert.equal(output.counts.click, 2);
  });

  it("reads the visible text from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-text-"));
    const textFile = join(dir, "page.txt");
    writeFileSync(textFile, "VISIBLE TEXT");
    const result = run(["observe", "--snapshot", "-", "--text", textFile], CHROME_SNAPSHOT);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).page.text, "VISIBLE TEXT");
  });
});

describe("jev failures", () => {
  it("exits 2 with a JSON error and no stdout", () => {
    const missing = run(["observe", "--snapshot", "/nonexistent/snapshot.txt"]);
    assert.equal(missing.status, 2);
    assert.equal(missing.stdout, "");
    assert.ok(JSON.parse(missing.stderr).error);

    const unknown = run(["nope"]);
    assert.equal(unknown.status, 2);
    assert.match(JSON.parse(unknown.stderr).error, /Unknown command/);

    const noGoal = run(["decide", "--page", "-"], CHROME_SNAPSHOT);
    assert.equal(noGoal.status, 2);
    assert.match(JSON.parse(noGoal.stderr).error, /Missing --goal/);
  });

  it("help prints usage and exits 0", () => {
    const result = run(["help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /jev observe/);
  });
});
