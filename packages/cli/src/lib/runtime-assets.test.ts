import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  loadRuntimeAssets,
  PACKAGED_RUNTIME_ASSETS_FILE,
  RuntimeAssetsMissingError,
} from './runtime-assets.js';

/**
 * `specs/190-overlay-full-modules/` T013 (FR-013): `endora build overlays` mirrors an
 * overlay module's runtime assets with **the** classification — the one owner D-218 gave
 * "does this file ship", `scripts/lib/runtime-assets.mjs` at the repository root. This CLI
 * carries a copy of that file in its `dist` (`scripts/write-runtime-assets.mjs`, the
 * backend supervisor's arrangement), so a published CLI asks the same function a checkout
 * does; a run from `src` — these tests — reads the repository's own file.
 */
const ROOT_FILE = fileURLToPath(new URL('../../../../scripts/lib/runtime-assets.mjs', import.meta.url));

describe('loadRuntimeAssets', () => {
  it('reads the repository owner from a checkout, and answers as it does', async () => {
    const assets = await loadRuntimeAssets();
    expect(assets.classifyAssetFile('en.json', [])).toBe('asset');
    expect(assets.classifyAssetFile('backend.ts', [])).toBe('ignored');
    expect(assets.classifyAssetFile('logo.svg', [])).toBe('unclassified');
  });

  it('exposes every function the owner exports — the carried copy cannot drift into a subset', async () => {
    const owner = (await import(pathToFileURL(ROOT_FILE).href)) as Record<string, unknown>;
    const loaded = (await loadRuntimeAssets()) as unknown as Record<string, unknown>;
    const functions = Object.keys(owner).filter((name) => typeof owner[name] === 'function');
    expect(functions.length).toBeGreaterThan(0);
    for (const name of functions) expect(typeof loaded[name], name).toBe('function');
  });

  it('prefers the copy carried in dist over the checkout', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'cli-dist-'));
    mkdirSync(join(dist, 'lib'));
    writeFileSync(
      join(dist, PACKAGED_RUNTIME_ASSETS_FILE),
      "export const classifyAssetFile = () => 'carried';\n",
      'utf8',
    );
    const assets = await loadRuntimeAssets(pathToFileURL(join(dist, 'lib', 'runtime-assets.js')).href);
    expect(assets.classifyAssetFile('x', [])).toBe('carried');
  });

  it('refuses, naming both places, when neither the copy nor a checkout is there', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'cli-nowhere-'));
    mkdirSync(join(elsewhere, 'lib'));
    await expect(
      loadRuntimeAssets(pathToFileURL(join(elsewhere, 'lib', 'runtime-assets.js')).href),
    ).rejects.toBeInstanceOf(RuntimeAssetsMissingError);
  });

  it('the build carries the owner byte for byte', () => {
    const carried = fileURLToPath(new URL(`../../dist/${PACKAGED_RUNTIME_ASSETS_FILE}`, import.meta.url));
    if (!existsSync(carried)) return; // an unbuilt checkout; `prepack` refuses to pack one
    expect(readFileSync(carried, 'utf8')).toBe(readFileSync(ROOT_FILE, 'utf8'));
  });
});
