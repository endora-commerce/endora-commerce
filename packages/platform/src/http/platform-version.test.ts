import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { PLATFORM_VERSION, readPlatformVersion } from './platform-version.js';

/**
 * The release an instance runs is the version of the platform package it
 * loaded — not the host application's own manifest, which is `0.0.0` in the
 * reference backend and in every scaffolded instance, and not
 * `npm_package_version`, which nothing sets when a container starts the server
 * with `node dist/index.js`.
 */

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function manifestWith(content: string): URL {
  const dir = mkdtempSync(join(tmpdir(), 'ver-badge-platform-version-'));
  scratch.push(dir);
  const file = join(dir, 'package.json');
  writeFileSync(file, content);
  return pathToFileURL(file);
}

describe('the platform reports its own release', () => {
  it('reads the version of the package this file belongs to', () => {
    const own = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { name: string; version: string };

    expect(own.name).toBe('@endora-commerce/platform');
    expect(readPlatformVersion()).toBe(own.version);
    expect(PLATFORM_VERSION).toBe(own.version);
  });

  it('does not follow the host application’s `npm_package_version`', () => {
    const before = process.env['npm_package_version'];
    process.env['npm_package_version'] = '9.9.9';
    try {
      expect(readPlatformVersion()).not.toBe('9.9.9');
    } finally {
      if (before === undefined) delete process.env['npm_package_version'];
      else process.env['npm_package_version'] = before;
    }
  });

  it('keeps a pre-release identifier', () => {
    expect(readPlatformVersion(manifestWith('{"version":"0.105.0-rc.1"}'))).toBe('0.105.0-rc.1');
  });

  it.each([
    ['a manifest that is not there', (): URL => pathToFileURL(join(tmpdir(), 'ver-badge-absent', 'package.json'))],
    ['a manifest that is not JSON', (): URL => manifestWith('not json')],
    ['a manifest with no version', (): URL => manifestWith('{"name":"x"}')],
    ['a version that is not a string', (): URL => manifestWith('{"version":104}')],
    ['a version that is not a release number', (): URL => manifestWith('{"version":"workspace:*"}')],
    // The placeholder an unreleased manifest carries. It looks like a release
    // and is not one, which is the whole defect this file exists for.
    ['the `0.0.0` placeholder', (): URL => manifestWith('{"version":"0.0.0"}')],
  ])('answers null for %s', (_name, manifest) => {
    expect(readPlatformVersion(manifest())).toBeNull();
  });
});
