#!/usr/bin/env node
// Automated verification of a tockola release.
//
// Everything that can be expressed as an assertion lives here: version
// agreement, the exact asset set, non-empty files, SHA256 digests, minisign
// key-id pairing against the embedded updater pubkey, and the contents of
// latest.json. The only step left to a human is authorising publication.
//
// Modes:
//   --artifacts <path>   verify files from a local / dry-run build (repeatable)
//   --release <tag>      download and verify every asset of a draft Release
//
// Outputs a JSON report and a Markdown summary. Exits non-zero on any FAIL.
// No third-party dependencies; requires Node 22 (see .nvmrc) and the gh CLI
// for --release mode.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODUCT = 'tockola';
const UPDATER_ENDPOINT =
  'https://github.com/galivea/tockola/releases/latest/download/latest.json';
const VERIFY_MARKER = 'tockola-verify';

const pass = (name, detail) => ({ name, status: 'PASS', detail });
const fail = (name, detail) => ({ name, status: 'FAIL', detail });
const skip = (name, detail) => ({ name, status: 'SKIP', detail });
const check = (name, ok, detail) => (ok ? pass(name, detail) : fail(name, detail));

export function requiredReleaseAssets(version) {
  return [
    `${PRODUCT}_${version}_x64_en-US.msi`,
    `${PRODUCT}_${version}_x64_en-US.msi.sig`,
    `${PRODUCT}_${version}_x64-setup.exe`,
    `${PRODUCT}_${version}_x64-setup.exe.sig`,
    `${PRODUCT}_${version}_x64_portable.zip`,
    'latest.json',
  ];
}

export function requiredBuildArtifacts(version) {
  return [
    `${PRODUCT}_${version}_x64_en-US.msi`,
    `${PRODUCT}_${version}_x64_en-US.msi.sig`,
    `${PRODUCT}_${version}_x64-setup.exe`,
    `${PRODUCT}_${version}_x64-setup.exe.sig`,
  ];
}

export function readProjectConfig(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const conf = JSON.parse(
    readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  const cargo = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const cargoMatch = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  const updater = conf.plugins?.updater ?? conf.updater ?? {};
  return {
    version: conf.version,
    versions: {
      'package.json': pkg.version,
      'tauri.conf.json': conf.version,
      'Cargo.toml': cargoMatch?.[1] ?? null,
      'package-lock.json': lock.version,
    },
    productName: conf.productName,
    identifier: conf.identifier,
    pubkey: updater.pubkey ?? null,
    endpoints: updater.endpoints ?? [],
  };
}

// A .sig file (and latest.json's signature field) is a minisign signature.
// Tauri wraps the four-line minisign text in base64, so accept both shapes.
export function parseMinisign(raw) {
  const candidates = [String(raw).trim()];
  try {
    const decoded = Buffer.from(String(raw).trim(), 'base64').toString('utf8');
    if (decoded.includes('untrusted comment')) candidates.unshift(decoded.trim());
  } catch {
    // Not base64-wrapped; the plain text candidate is used instead.
  }
  // Some updater feeds store only the 74-byte ED signature blob.
  const blob = Buffer.from(String(raw).trim(), 'base64');
  if (blob.length === 74 && blob.subarray(0, 2).toString('ascii') === 'ED') {
    return {
      algorithm: 'ED',
      keyId: blob.subarray(2, 10).toString('hex').toUpperCase(),
    };
  }
  for (const text of candidates) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 4 || !lines[0].startsWith('untrusted comment')) continue;
    const blob = Buffer.from(lines[1], 'base64');
    if (blob.length !== 74) continue;
    if (blob.subarray(0, 2).toString('ascii') !== 'ED') continue;
    return {
      algorithm: 'ED',
      keyId: blob.subarray(2, 10).toString('hex').toUpperCase(),
    };
  }
  throw new Error('not a minisign ED signature (expected 4 lines, 74-byte ED blob)');
}

// The pubkey in tauri.conf.json is a base64-wrapped minisign public key file.
export function publicKeyId(pubkeyBase64) {
  const text = Buffer.from(pubkeyBase64, 'base64').toString('utf8');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines[0].startsWith('untrusted comment')) {
    throw new Error('not a minisign public key file');
  }
  const blob = Buffer.from(lines[1], 'base64');
  if (blob.length < 10) throw new Error('minisign public key blob is too short');
  return blob.subarray(2, 10).toString('hex').toUpperCase();
}

export function collectArtifactFiles(paths) {
  const found = new Map();
  const visit = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) {
        if (entry === 'node_modules' || entry === '.git') continue;
        visit(join(p, entry));
      }
      return;
    }
    if (!st.isFile()) return;
    found.set(basename(p), { name: basename(p), path: p, size: st.size });
  };
  for (const p of paths) visit(resolve(p));
  return found;
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const esc = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// tauri-action@v1 writes asset API urls into latest.json (see
// src/upload-version-json.ts: `${githubBaseUrl}/repos/.../releases/assets/${id}`).
// Accept that shape only when the id resolves to an asset of THIS release and
// the asset matches the platform key. Anything else fails loudly.
const ASSET_API_URL = /^https:\/\/api\.github\.com\/repos\/galivea\/tockola\/releases\/assets\/(\d+)$/;
const DOWNLOAD_URL = /\/releases\/download\/([^/]+)\/([^/?#]+)/;

export function resolveUpdaterUrl(url, platformKey, ctx) {
  const download = String(url).match(DOWNLOAD_URL);
  if (download) {
    const [, releaseTag, asset] = download;
    return {
      ok: releaseTag === ctx.tag && ctx.assetNames.has(asset),
      detail: releaseTag.startsWith('untagged-')
        ? `draft is not bound to ${ctx.tag}: ${releaseTag}/${asset}`
        : `${releaseTag}/${asset}`,
    };
  }
  const api = String(url).match(ASSET_API_URL);
  if (!api) return { ok: false, detail: url || '(missing url)' };
  const asset = ctx.assetIds?.get(api[1]) ?? null;
  if (!asset) {
    return { ok: false, detail: `asset id ${api[1]} is not part of this release` };
  }
  const wantsNsis = platformKey.endsWith('-nsis');
  const shapeOk = wantsNsis ? asset.endsWith('-setup.exe') : asset.endsWith('_en-US.msi');
  const ok = ctx.assetNames.has(asset) && shapeOk &&
    asset.startsWith(`tockola_${ctx.version}_`);
  return {
    ok,
    detail: `asset ${api[1]} -> ${asset}${shapeOk ? '' : ` (unexpected for ${platformKey})`}`,
  };
}

export function inspectLatestJson(text, ctx) {
  const checks = [];
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    checks.push(fail('updater: latest.json is valid JSON', err.message));
    return checks;
  }
  checks.push(pass('updater: latest.json is valid JSON', 'parsed'));
  checks.push(
    check(
      'updater: advertised version',
      String(json.version ?? '').replace(/^v/, '') === ctx.version,
      `expected ${ctx.version}, got ${json.version}`,
    ),
  );
  const platforms = json.platforms ?? {};
  const keys = Object.keys(platforms).filter((k) => /windows/i.test(k));
  checks.push(
    check(
      'updater: windows platform entry',
      keys.length > 0,
      keys.length ? keys.join(', ') : 'no windows entry',
    ),
  );
  for (const key of keys) {
    const entry = platforms[key] ?? {};
    const url = typeof entry.url === 'string' ? entry.url : '';
    const resolved = resolveUpdaterUrl(url, key, ctx);
    checks.push(
      check(
        `updater: ${key} url targets this release`,
        resolved.ok,
        resolved.detail,
      ),
    );
    try {
      const sig = parseMinisign(entry.signature ?? '');
      checks.push(
        check(
          `updater: ${key} signature key id`,
          sig.keyId === ctx.expectedKeyId,
          `key id ${sig.keyId}, expected ${ctx.expectedKeyId}`,
        ),
      );
    } catch (err) {
      checks.push(fail(`updater: ${key} signature key id`, err.message));
    }
  }
  return checks;
}

function downloadReleaseAssets(tag, releaseId) {
  // gh release download <tag> resolves through /releases/tags/:tag, which skips
  // drafts. tauri-action exposes releaseId, so use the asset API directly.
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');
  let id = releaseId;
  if (!id) {
    const releases = JSON.parse(execFileSync(
      'gh', ['api', `repos/${repo}/releases?per_page=100`], { encoding: 'utf8' },
    ));
    const release = releases.find((r) => r.tag_name === tag);
    if (!release) throw new Error(`no release (including drafts) found for tag ${tag}`);
    id = release.id;
  }
  const release = JSON.parse(execFileSync(
    'gh', ['api', `repos/${repo}/releases/${id}`], { encoding: 'utf8' },
  ));
  const assets = JSON.parse(execFileSync(
    'gh', ['api', `repos/${repo}/releases/${id}/assets?per_page=100`], { encoding: 'utf8' },
  ));
  const assetIds = new Map(assets.map((a) => [String(a.id), a.name]));
  const dir = mkdtempSync(join(tmpdir(), 'tockola-verify-'));
  for (const asset of assets) {
    execFileSync('curl', [
      '-fsSL',
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'Accept: application/octet-stream',
      asset.url,
      '-o', join(dir, asset.name),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return { files: collectArtifactFiles([dir]), assetIds, release };
}

export function verify(opts) {
  const root = opts.root ?? process.cwd();
  const config = readProjectConfig(root);
  const version = opts.version ?? config.version;
  const tag = opts.release ?? null;
  const mode = tag ? 'release' : 'artifacts';
  const checks = [];
  const assets = [];
  let signingKeyId = null;
  let files;
  let assetIds = new Map();
  let releaseMeta = null;

  try {
    if (mode === 'release') {
      const downloaded = downloadReleaseAssets(tag, opts.releaseId);
      files = downloaded.files;
      assetIds = downloaded.assetIds;
      releaseMeta = downloaded.release;
    } else {
      files = collectArtifactFiles(opts.artifactPaths ?? []);
    }
  } catch (err) {
    checks.push(fail('collect artifacts', err.message));
    files = new Map();
  }

  for (const [file, value] of Object.entries(config.versions)) {
    checks.push(
      check(`version: ${file}`, value === version, `expected ${version}, got ${value}`),
    );
  }
  if (mode === 'release') {
    checks.push(check('version: release tag', tag === `v${version}`, `tag ${tag}`));
    checks.push(
      check(
        'release: draft exists',
        releaseMeta?.draft === true,
        releaseMeta ? `draft=${releaseMeta.draft}` : 'release metadata unavailable',
      ),
    );
    checks.push(
      check(
        'release: tag_name matches',
        releaseMeta?.tag_name === tag,
        `expected ${tag}, got ${releaseMeta?.tag_name ?? '(unavailable)'}`,
      ),
    );
  } else {
    checks.push(skip('version: release tag', 'no release in artifacts mode'));
    checks.push(skip('release: draft exists', 'no release in artifacts mode'));
    checks.push(skip('release: tag_name matches', 'no release in artifacts mode'));
  }
  checks.push(
    check('config: product name', config.productName === PRODUCT, String(config.productName)),
  );
  checks.push(
    check(
      'config: updater endpoint',
      config.endpoints.includes(UPDATER_ENDPOINT),
      config.endpoints.join(', ') || '(none)',
    ),
  );

  try {
    signingKeyId = publicKeyId(config.pubkey ?? '');
    checks.push(pass('config: updater pubkey', `minisign key id ${signingKeyId}`));
  } catch (err) {
    checks.push(fail('config: updater pubkey', err.message));
  }

  const required = mode === 'release'
    ? requiredReleaseAssets(version)
    : requiredBuildArtifacts(version);
  const missing = required.filter((name) => !files.has(name));
  checks.push(
    check(
      'assets: required set present',
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `${required.length} files`,
    ),
  );

  for (const name of required) {
    const file = files.get(name);
    if (!file) continue;
    checks.push(
      check(`assets: ${name} non-empty`, file.size > 0, `${file.size} bytes`),
    );
    if (file.size === 0) continue;
    let buffer;
    try {
      buffer = readFileSync(file.path);
    } catch (err) {
      checks.push(fail(`assets: ${name} readable`, err.message));
      continue;
    }
    assets.push({ name, bytes: file.size, sha256: sha256(buffer) });
    if (name.endsWith('.sig')) {
      try {
        const sig = parseMinisign(buffer.toString('utf8'));
        checks.push(
          check(
            `signature: ${name} key id`,
            sig.keyId === signingKeyId,
            `key id ${sig.keyId}, expected ${signingKeyId}`,
          ),
        );
      } catch (err) {
        checks.push(fail(`signature: ${name} key id`, err.message));
      }
    }
  }

  const wrongVersion = [...files.keys()].filter(
    (name) => name !== 'latest.json' && /\.(msi|exe|zip)(\.sig)?$/.test(name) &&
      !name.startsWith(`${PRODUCT}_${version}_`),
  );
  checks.push(
    check(
      'assets: filenames carry the version',
      wrongVersion.length === 0,
      wrongVersion.length ? wrongVersion.join(', ') : 'all match',
    ),
  );

  const latest = files.get('latest.json');
  if (mode === 'release') {
    if (!latest) {
      checks.push(skip('updater: latest.json', 'missing asset already reported'));
    } else {
      checks.push(...inspectLatestJson(readFileSync(latest.path, 'utf8'), {
        version,
        tag,
        assetNames: new Set(files.keys()),
        assetIds,
        expectedKeyId: signingKeyId,
      }));
    }
  } else {
    checks.push(skip('updater: latest.json', 'generated by tauri-action only on a release'));
    checks.push(skip('assets: portable zip', 'packaged only on a release'));
  }

  checks.push(pass('assets: SHA256 digests computed', `${assets.length} files hashed`));

  const failures = checks.filter((c) => c.status === 'FAIL');
  return {
    product: PRODUCT,
    mode,
    version,
    tag,
    result: failures.length ? 'FAIL' : 'PASS',
    generatedAt: new Date().toISOString(),
    signingKeyId,
    checks,
    assets,
  };
}

export function renderNotes(report) {
  const ok = report.result === 'PASS';
  const lines = [
    `<!-- ${VERIFY_MARKER}: ${report.result} ${report.version} -->`,
    '',
    `## Automated verification — ${report.result}`,
    '',
    ok
      ? `Every machine-checkable assertion passed for \`${report.tag ?? report.version}\`. The only remaining step is a human authorising publication.`
      : '**DO NOT PUBLISH.** One or more automated assertions failed. Inspect the failed workflow run, fix the cause and push a corrected tag.',
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...report.checks.map(
      (c) => `| ${esc(c.name)} | ${c.status} | ${esc(c.detail)} |`,
    ),
    '',
    '### Assets',
    '',
    '| File | Bytes | SHA256 |',
    '| --- | --- | --- |',
    ...report.assets.map(
      (a) => `| ${esc(a.name)} | ${a.bytes} | \`${a.sha256}\` |`,
    ),
    '',
    `Signing key id: \`${report.signingKeyId ?? 'unavailable'}\` (must match the pubkey embedded in \`tauri.conf.json\`).`,
    '',
    '---',
    '',
    'Add release notes below this line, then publish.',
    '',
  ];
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = { artifactPaths: [], root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--artifacts') opts.artifactPaths.push(argv[++i]);
    else if (arg === '--release') opts.release = argv[++i];
    else if (arg === '--release-id') opts.releaseId = argv[++i];
    else if (arg === '--version') opts.version = argv[++i];
    else if (arg === '--root') opts.root = argv[++i];
    else if (arg === '--summary') opts.summary = argv[++i];
    else if (arg === '--report') opts.report = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log(`Usage:
  node .github/scripts/verify-release.mjs --artifacts <dir> [--artifacts <dir>] [options]
  node .github/scripts/verify-release.mjs --release <tag> [options]

Options: --release-id <id> --root <dir> --version <x.y.z> --summary <file> --report <file>`);
    return;
  }
  if (!opts.release && opts.artifactPaths.length === 0) {
    console.error('provide --release <tag> or at least one --artifacts <path>');
    process.exit(2);
  }
  const report = verify(opts);
  const notes = renderNotes(report);
  if (opts.report) writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
  if (opts.summary) writeFileSync(opts.summary, notes);
  const failures = report.checks.filter((c) => c.status === 'FAIL');
  console.log(`${report.result}: ${report.checks.length} checks, ${report.assets.length} assets hashed (${report.mode} mode)`);
  for (const c of report.checks) console.log(`  ${c.status.padEnd(4)}  ${c.name} — ${c.detail}`);
  if (failures.length) process.exitCode = 1;
}

// import.meta.url is not always a file:// URL under bundlers such as Vitest,
// so compare URLs instead of calling fileURLToPath on it.
const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) main();
