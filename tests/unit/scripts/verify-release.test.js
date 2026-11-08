import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectArtifactFiles,
  inspectLatestJson,
  parseMinisign,
  publicKeyId,
  readProjectConfig,
  renderNotes,
  requiredBuildArtifacts,
  requiredReleaseAssets,
  resolveUpdaterUrl,
  verify,
} from "../../../.github/scripts/verify-release.mjs";

const root = process.cwd();
const KEY_ID = "DA9204C4022B146C";
const OTHER_KEY_ID = "0000000000000000";

function minisignSignature(keyId = KEY_ID, algorithm = "ED") {
  const blob = Buffer.alloc(74);
  blob.write(algorithm, 0, 2, "ascii");
  Buffer.from(keyId, "hex").copy(blob, 2);
  return [
    "untrusted comment: signature from minisign secret key",
    blob.toString("base64"),
    "trusted comment: timestamp:1",
    Buffer.alloc(64, 7).toString("base64"),
    "",
  ].join("\n");
}

// Tauri stores .sig files as base64-wrapped minisign text.
const sigFile = (keyId = KEY_ID) =>
  Buffer.from(minisignSignature(keyId)).toString("base64");

function latestJson(overrides = {}) {
  const { platform = {}, ...rest } = overrides;
  const entry = {
    signature: sigFile(),
    url: "https://github.com/galivea/tockola/releases/download/v0.0.1/tockola_0.0.1_x64_en-US.msi",
    ...platform,
  };
  return JSON.stringify({
    version: "0.0.1",
    notes: "release",
    pub_date: "2026-11-08T00:00:00Z",
    platforms: { "windows-x86_64": entry },
    ...rest,
  });
}

const ctx = (overrides = {}) => ({
  version: "0.0.1",
  tag: "v0.0.1",
  assetNames: new Set([
    "tockola_0.0.1_x64_en-US.msi",
    "tockola_0.0.1_x64-setup.exe",
    "tockola_0.0.1_x64_portable.zip",
    "latest.json",
  ]),
  expectedKeyId: KEY_ID,
  assetIds: new Map([
    ["724453084", "tockola_0.0.1_x64_en-US.msi"],
    ["724453172", "tockola_0.0.1_x64-setup.exe"],
  ]),
  ...overrides,
});

const scratch = mkdtempSync(join(tmpdir(), "tockola-verify-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function buildArtifactDir(version, { omit = [] } = {}) {
  const dir = mkdtempSync(join(scratch, "assets-"));
  for (const name of requiredBuildArtifacts(version)) {
    if (omit.includes(name)) continue;
    const content = name.endsWith(".sig") ? sigFile() : `contents of ${name}`;
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("minisign parsing", () => {
  it("reads the key id from plain and base64-wrapped signatures", () => {
    expect(parseMinisign(minisignSignature()).keyId).toBe(KEY_ID);
    expect(parseMinisign(sigFile()).keyId).toBe(KEY_ID);
  });

  it("accepts a bare 74-byte ED signature blob", () => {
    const blob = Buffer.alloc(74);
    blob.write("ED", 0, 2, "ascii");
    Buffer.from(KEY_ID, "hex").copy(blob, 2);
    expect(parseMinisign(blob.toString("base64")).keyId).toBe(KEY_ID);
  });

  it("rejects a wrong algorithm, a short blob and arbitrary text", () => {
    expect(() => parseMinisign("not a signature")).toThrow();
    expect(() => parseMinisign(minisignSignature(KEY_ID, "XX"))).toThrow();
    expect(() => parseMinisign("dW50cnVzdGVkIGNvbW1lbnQ6IHgKbm90YmFzZTY0Cg==")).toThrow();
  });

  it("extracts the key id from the pubkey embedded in tauri.conf.json", () => {
    const config = readProjectConfig(root);
    expect(publicKeyId(config.pubkey)).toBe(KEY_ID);
  });

  it("rejects a malformed pubkey", () => {
    expect(() => publicKeyId(Buffer.from("garbage").toString("base64"))).toThrow();
  });
});

describe("project configuration", () => {
  it("keeps all four version declarations in sync", () => {
    const config = readProjectConfig(root);
    expect(Object.values(config.versions)).toEqual(
      Array(4).fill(config.version),
    );
  });

  it("points the updater at the canonical feed", () => {
    const config = readProjectConfig(root);
    expect(config.productName).toBe("tockola");
    expect(config.endpoints).toContain(
      "https://github.com/galivea/tockola/releases/latest/download/latest.json",
    );
  });
});

describe("asset sets", () => {
  it("requires all six draft-release assets", () => {
    expect(requiredReleaseAssets("1.2.3")).toEqual([
      "tockola_1.2.3_x64_en-US.msi",
      "tockola_1.2.3_x64_en-US.msi.sig",
      "tockola_1.2.3_x64-setup.exe",
      "tockola_1.2.3_x64-setup.exe.sig",
      "tockola_1.2.3_x64_portable.zip",
      "latest.json",
    ]);
  });

  it("requires only the four build artifacts in dry-run mode", () => {
    expect(requiredBuildArtifacts("1.2.3")).toHaveLength(4);
    expect(requiredBuildArtifacts("1.2.3")).not.toContain("latest.json");
  });

  it("collects files recursively and skips node_modules", () => {
    const base = mkdtempSync(join(scratch, "collect-"));
    writeFileSync(join(base, "a.sig"), "a");
    mkdirSync(join(base, "nested"));
    writeFileSync(join(base, "nested", "b.msi"), "b");
    mkdirSync(join(base, "node_modules"));
    writeFileSync(join(base, "node_modules", "ignored.sig"), "c");
    const found = collectArtifactFiles([base]);
    expect([...found.keys()].sort()).toEqual(["a.sig", "b.msi"]);
  });
});

describe("latest.json", () => {
  it("passes a well-formed updater feed", () => {
    const checks = inspectLatestJson(latestJson(), ctx());
    expect(checks.every((c) => c.status === "PASS")).toBe(true);
    expect(
      inspectLatestJson(latestJson({ version: "v0.0.1" }), ctx()).every(
        (c) => c.status === "PASS",
      ),
    ).toBe(true);
  });

  it("accepts tauri-action asset API urls when the id belongs to this release", () => {
    const feed = JSON.stringify({
      version: "0.0.1",
      pub_date: "2026-11-08T00:00:00Z",
      platforms: {
        "windows-x86_64": {
          signature: sigFile(),
          url: "https://api.github.com/repos/galivea/tockola/releases/assets/724453084",
        },
        "windows-x86_64-msi": {
          signature: sigFile(),
          url: "https://api.github.com/repos/galivea/tockola/releases/assets/724453084",
        },
        "windows-x86_64-nsis": {
          signature: sigFile(),
          url: "https://api.github.com/repos/galivea/tockola/releases/assets/724453172",
        },
      },
    });
    const checks = inspectLatestJson(feed, ctx());
    expect(checks.filter((c) => c.name.includes("url targets"))).toHaveLength(3);
    expect(checks.every((c) => c.status === "PASS")).toBe(true);
  });

  it("rejects foreign asset ids, wrong platform shape and untagged drafts", () => {
    const api = (id) => `https://api.github.com/repos/galivea/tockola/releases/assets/${id}`;
    expect(resolveUpdaterUrl(api("999999"), "windows-x86_64", ctx()).ok).toBe(false);
    expect(resolveUpdaterUrl(api("724453172"), "windows-x86_64", ctx()).ok).toBe(false);
    expect(resolveUpdaterUrl(api("724453084"), "windows-x86_64-nsis", ctx()).ok).toBe(false);
    expect(resolveUpdaterUrl("https://example.com/a.msi", "windows-x86_64", ctx()).ok).toBe(false);
    const untagged = resolveUpdaterUrl(
      "https://github.com/galivea/tockola/releases/download/untagged-abc/tockola_0.0.1_x64_en-US.msi",
      "windows-x86_64",
      ctx(),
    );
    expect(untagged.ok).toBe(false);
    expect(untagged.detail).toContain("not bound");
  });

  it("fails on a stale version, wrong tag, wrong key id or bad JSON", () => {
    const cases = [
      inspectLatestJson(latestJson({ version: "0.0.0" }), ctx()),
      inspectLatestJson(
        latestJson({ platform: { url: "https://example.com/other.msi" } }),
        ctx(),
      ),
      inspectLatestJson(latestJson({ platform: { signature: sigFile(OTHER_KEY_ID) } }), ctx()),
      inspectLatestJson("{broken", ctx()),
      inspectLatestJson(JSON.stringify({ version: "0.0.1", platforms: {} }), ctx()),
    ];
    for (const checks of cases) {
      expect(checks.some((c) => c.status === "FAIL")).toBe(true);
    }
  });
});

describe("verify()", () => {
  it("passes a complete local build with matching signatures", () => {
    const version = readProjectConfig(root).version;
    const dir = buildArtifactDir(version);
    const report = verify({ root, artifactPaths: [dir] });
    expect(report.result).toBe("PASS");
    expect(report.mode).toBe("artifacts");
    expect(report.signingKeyId).toBe(KEY_ID);
    expect(report.assets).toHaveLength(4);
    expect(report.assets.every((a) => /^[a-f0-9]{64}$/.test(a.sha256))).toBe(true);
    expect(report.checks.filter((c) => c.status === "SKIP")).toHaveLength(5);
  });

  it("fails as soon as a required asset is missing", () => {
    const version = readProjectConfig(root).version;
    const dir = buildArtifactDir(version, {
      omit: [`tockola_${version}_x64-setup.exe.sig`],
    });
    const report = verify({ root, artifactPaths: [dir] });
    expect(report.result).toBe("FAIL");
    expect(report.checks.find((c) => c.name === "assets: required set present").status).toBe(
      "FAIL",
    );
  });

  it("fails on a version disagreement", () => {
    const version = readProjectConfig(root).version;
    const dir = buildArtifactDir(version);
    const report = verify({ root, version: "9.9.9", artifactPaths: [dir] });
    expect(report.result).toBe("FAIL");
  });
});

describe("renderNotes()", () => {
  it("embeds the machine-readable PASS marker and the digest table", () => {
    const version = readProjectConfig(root).version;
    const report = verify({ root, artifactPaths: [buildArtifactDir(version)] });
    const notes = renderNotes(report);
    expect(notes).toContain("<!-- tockola-verify: PASS");
    expect(notes).toContain("| SHA256 |");
    expect(notes).toContain("authorising publication");
    expect(notes).not.toContain("DO NOT PUBLISH");
  });

  it("marks a failed report as unsafe to publish", () => {
    const version = readProjectConfig(root).version;
    const report = verify({ root, version: "9.9.9", artifactPaths: [buildArtifactDir(version)] });
    const notes = renderNotes(report);
    expect(notes).toContain("<!-- tockola-verify: FAIL");
    expect(notes).toContain("DO NOT PUBLISH");
  });
});
