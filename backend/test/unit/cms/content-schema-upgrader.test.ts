import { describe, expect, it } from 'vitest';
import {
  upgrade,
  CmsSchemaUpgradeFailedError,
} from '../../../src/modules/cms/services/content-schema-upgrader.js';

describe('content-schema-upgrader', () => {
  it('passes a current envelope through unchanged', () => {
    const env = { schema_version: 2, languages: { 'en-US': { content: [] } } };
    const out = upgrade(env);
    expect(out.schema_version).toBe(2);
    expect(out.languages['en-US']).toBeDefined();
  });

  it('upgrades v0 (no schema_version field) to v2', () => {
    const env = { languages: { 'en-US': { content: [] } } };
    const out = upgrade(env);
    expect(out.schema_version).toBe(2);
    expect(out.languages['en-US']).toBeDefined();
  });

  it('upgrades v1 zones to v2 slot props', () => {
    const env = {
      schema_version: 1,
      languages: {
        'en-US': {
          root: { props: {} },
          content: [{ type: 'Row', props: { id: 'Row-1' } }],
          zones: {
            'Row-1:content': [{ type: 'Text', props: { id: 'Text-1' } }],
          },
        },
      },
    };
    const out = upgrade(env);
    expect(out.schema_version).toBe(2);
    const tree = out.languages['en-US'] as {
      zones: Record<string, unknown>;
      content: { props: { content: unknown[] } }[];
    };
    expect(tree.zones).toEqual({});
    expect(tree.content[0]!.props.content).toHaveLength(1);
  });

  it('returns an empty v2 envelope when input is null / undefined / non-object', () => {
    expect(upgrade(null).schema_version).toBe(2);
    expect(upgrade(undefined).schema_version).toBe(2);
    expect(upgrade('string').schema_version).toBe(2);
  });

  it('throws when the envelope is from a future version', () => {
    const env = { schema_version: 99, languages: {} };
    expect(() => upgrade(env)).toThrow(CmsSchemaUpgradeFailedError);
  });
});
