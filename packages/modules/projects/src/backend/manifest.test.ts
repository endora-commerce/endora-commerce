import { describe, expect, it } from 'vitest';
import { PROJECT_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';

describe('projects manifest', () => {
  it('is an operator-toggleable module, on by default', () => {
    expect(manifest.id).toBe('projects');
    expect(manifest.activation).toEqual({ settingCode: 'projects.enabled', default: true });
  });

  it('declares its activation control as a boolean setting of its own group', () => {
    const control = manifest.settings?.settings.find((s) => s.code === 'projects.enabled');
    expect(control).toMatchObject({ groupCode: 'projects', valueType: 'boolean', defaultValue: true });
  });

  it('declares the eight Project writes hookable, for both phases (issue #1845)', () => {
    expect(manifest.hookableActions).toEqual(
      Object.values(PROJECT_HOOKABLE_ACTIONS).map((ref) => ({
        action: ref.action,
        objectType: 'project',
        phases: ['beforeCommit', 'afterCommit'],
      })),
    );
  });
});
