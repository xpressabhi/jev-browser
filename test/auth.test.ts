import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAuthFile, readProviderKey } from "../src/core/auth.ts";

describe("auth fallback", () => {
  it("reads a provider key from a JSON file", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-"));
    const file = join(dir, "auth.json");
    writeFileSync(file, JSON.stringify({ typesafe: { type: "api", key: "apikey-xyz" } }));
    assert.equal((readAuthFile(file) as any).typesafe.key, "apikey-xyz");
    assert.equal(readAuthFile(join(dir, "missing.json")), undefined);
    assert.equal(readAuthFile("/dev/null/impossible"), undefined);
  });

  it("returns undefined when provider missing", () => {
    assert.equal(readProviderKey(["__definitely_not_there__"]), undefined);
  });
});
