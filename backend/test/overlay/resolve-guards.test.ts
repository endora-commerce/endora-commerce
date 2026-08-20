import { describe, it, expect } from 'vitest';
import { resolveOverlay } from '../../src/overlay/resolve-overlay.js';
import {
  SchemaOverrideNotSupportedError,
  UnknownOverrideTargetError,
} from '../../src/overlay/errors.js';
import { coreSampleRoot, overlayRoot } from './_fixtures.js';

const resolve = (name: string): void => {
  resolveOverlay({ coreRoot: coreSampleRoot, overlayRoot: overlayRoot(name), deployment: 'acme' });
};

describe('resolve-overlay — fail-closed guards (T007)', () => {
  it('rejects a schema override (entities/migrations of a core module) — FR-011', () => {
    expect(() => resolve('overlay-schema')).toThrow(SchemaOverrideNotSupportedError);
  });

  it('rejects an unknown/stale override target — FR-014', () => {
    expect(() => resolve('overlay-unknown')).toThrow(UnknownOverrideTargetError);
  });

  it('rejects a service shadowed by file path — feature 072, T067', () => {
    // A `services/` file under an overlay used to override the core class it
    // shadowed. It no longer does anything, so it is an unknown target rather
    // than a file the platform silently never loads. Service overrides are
    // decorations now, named by registration.
    expect(() => resolve('overlay-service-shadow')).toThrow(UnknownOverrideTargetError);
  });
});
