import { describe, expect, it } from 'vitest';

import {
  judgeFirstPublish,
  readRegistryAnswer,
  type PublishCandidate,
  type RegistryAnswer,
} from '../../../scripts/first-publish-preconditions.js';

/**
 * `specs/137-open-source-launch/` N4 — the network half of the first-publish
 * guard (D-234; 123 T7-D1).
 *
 * The static half, `check:release-intent --publish-registry`, refuses a package
 * below `0.100.0`. What it cannot see is the registry: whether this is really
 * the **first** publish. D-234's uniform number is legal only then — from the
 * second release on the estate diverges as it always has — and a version on
 * npmjs is permanent. So the job measures the registry before it publishes:
 * every package carries one number, and no package already holds a version at
 * or above the floor other than that very number (which is a resumed run, not
 * a second release). A placeholder below the floor — the owner's `0.0.1` of the
 * unscoped name — is neither.
 */

const FLOOR = '0.100.0';
const absent: RegistryAnswer = { kind: 'absent' };
const has = (...versions: string[]): RegistryAnswer => ({ kind: 'versions', versions });

function candidates(...specs: string[]): PublishCandidate[] {
  return specs.map((spec) => {
    const at = spec.lastIndexOf('@');
    return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  });
}

describe('first-publish-preconditions — the verdict', () => {
  it('passes a uniform set no registry has seen', () => {
    const verdict = judgeFirstPublish(
      candidates('@fx/alpha@0.100.0', '@fx/beta@0.100.0'),
      new Map([
        ['@fx/alpha', absent],
        ['@fx/beta', absent],
      ]),
      FLOOR,
    );
    expect(verdict.refusals).toEqual([]);
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.number).toBe('0.100.0');
  });

  it('passes a placeholder below the floor, which a first release may publish over', () => {
    const verdict = judgeFirstPublish(
      candidates('create-fx@0.100.0', '@fx/alpha@0.100.0'),
      new Map([
        ['create-fx', has('0.0.1')],
        ['@fx/alpha', absent],
      ]),
      FLOOR,
    );
    expect(verdict.refusals).toEqual([]);
    expect(verdict.lines.join('\n')).toContain('create-fx: 0.0.1 below the floor');
  });

  it('refuses a set that does not carry one number', () => {
    const verdict = judgeFirstPublish(
      candidates('@fx/alpha@0.100.0', '@fx/beta@0.101.0'),
      new Map([
        ['@fx/alpha', absent],
        ['@fx/beta', absent],
      ]),
      FLOOR,
    );
    expect(verdict.refusals.join('\n')).toContain('2 versions');
    expect(verdict.refusals.join('\n')).toContain('@fx/beta@0.101.0');
  });

  it('refuses when a package already holds a public version at or above the floor', () => {
    const verdict = judgeFirstPublish(
      candidates('@fx/alpha@0.100.1', '@fx/beta@0.100.1'),
      new Map([
        ['@fx/alpha', has('0.100.0')],
        ['@fx/beta', absent],
      ]),
      FLOOR,
    );
    expect(verdict.refusals.join('\n')).toContain('@fx/alpha');
    expect(verdict.refusals.join('\n')).toContain('0.100.0');
    expect(verdict.refusals.join('\n')).toContain('not the first publish');
  });

  it('treats the very number already published as a resumed run, not a second release', () => {
    const verdict = judgeFirstPublish(
      candidates('@fx/alpha@0.100.0', '@fx/beta@0.100.0'),
      new Map([
        ['@fx/alpha', has('0.100.0')],
        ['@fx/beta', absent],
      ]),
      FLOOR,
    );
    expect(verdict.refusals).toEqual([]);
    expect(verdict.lines.join('\n')).toContain('@fx/alpha: 0.100.0 already published');
  });

  it('reports a registry answer it could not read as unmeasured, never as absent', () => {
    const verdict = judgeFirstPublish(
      candidates('@fx/alpha@0.100.0'),
      new Map([['@fx/alpha', { kind: 'unreadable', reason: 'ETIMEDOUT' } as RegistryAnswer]]),
      FLOOR,
    );
    expect(verdict.refusals).toEqual([]);
    expect(verdict.unmeasured).toEqual(['@fx/alpha: ETIMEDOUT']);
  });

  it('reports a package the registry was never asked about as unmeasured', () => {
    const verdict = judgeFirstPublish(candidates('@fx/alpha@0.100.0'), new Map(), FLOOR);
    expect(verdict.unmeasured.join('\n')).toContain('@fx/alpha');
  });

  it('refuses an empty set rather than passing it', () => {
    const verdict = judgeFirstPublish([], new Map(), FLOOR);
    expect(verdict.refusals.join('\n')).toContain('nothing');
  });
});

describe('first-publish-preconditions — reading `npm view <name> versions --json`', () => {
  it('reads an array of versions', () => {
    expect(readRegistryAnswer(0, '[\n  "0.0.1",\n  "0.0.2"\n]\n')).toEqual(has('0.0.1', '0.0.2'));
  });

  it('reads the bare string npm prints for a single version', () => {
    expect(readRegistryAnswer(0, '"0.0.1"\n')).toEqual(has('0.0.1'));
  });

  it('reads E404 as absent — and only E404', () => {
    const e404 = JSON.stringify({ error: { code: 'E404', summary: 'Not Found' } });
    expect(readRegistryAnswer(1, e404)).toEqual(absent);
    const e401 = JSON.stringify({ error: { code: 'E401', summary: 'Unauthorized' } });
    expect(readRegistryAnswer(1, e401)).toEqual({ kind: 'unreadable', reason: 'E401 Unauthorized' });
  });

  it('reads anything else as unreadable, never as absent', () => {
    expect(readRegistryAnswer(0, '').kind).toBe('unreadable');
    expect(readRegistryAnswer(1, 'npm ERR! network').kind).toBe('unreadable');
    expect(readRegistryAnswer(0, '{"not":"versions"}').kind).toBe('unreadable');
  });
});
