import { describe, expect, it } from 'vitest';
import { CMS_ICON_OPTIONS, resolveCmsIcon } from './icon-catalog.js';

describe('icon-catalog', () => {
  it('exposes a curated allowlist', () => {
    expect(CMS_ICON_OPTIONS.length).toBeGreaterThan(80);
    expect(resolveCmsIcon('star')).not.toBeNull();
    expect(resolveCmsIcon('not-a-real-icon')).toBeNull();
  });
});
