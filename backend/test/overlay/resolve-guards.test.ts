import { describe, it, expect } from 'vitest';
import { resolveOverlay } from '../../src/overlay/resolve-overlay.js';
import {
  MissingCoreContractError,
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

  it('rejects overriding a service with no declared core interface — R4/FR-003', () => {
    expect(() => resolve('overlay-nocontract')).toThrow(MissingCoreContractError);
  });
});
