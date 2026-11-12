import { describe, expect, it } from 'vitest';
import { hookableAction } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { expectHookableCommand, recordingCommandHooks } from './index.js';

/**
 * `specs/176-command-hooks-outbox/` T027 (FR-023): the owner-side proof that a
 * Command declared hookable supplies the data its declared phases need. The
 * bus refuses such a Command at run time (`COMMAND_HOOK_DATA_MISSING`); this
 * makes the refusal a red test in the owner's own suite instead of a 500 an
 * instance meets.
 */

const BOTH = hookableAction<{ id: string }, { widgetId: string }>('widget.create', 'widget', [
  'beforeCommit',
  'afterCommit',
]);
const BEFORE = hookableAction<{ id: string }>('widget.create', 'widget', ['beforeCommit']);

function widgetCommand(overrides: Partial<Command<{ id: string }>> = {}): Command<{ id: string }> {
  return {
    action: 'widget.create',
    objectType: 'widget',
    objectId: 'w-1',
    async run() {
      return { result: { id: 'w-1' } };
    },
    hookData: (result) => result,
    outboxData: (result) => ({ widgetId: result.id }),
    ...overrides,
  };
}

describe('expectHookableCommand (176 T027)', () => {
  it('passes a Command that supplies the data of every declared phase', () => {
    expect(() => expectHookableCommand(widgetCommand(), BOTH, { result: { id: 'w-1' } })).not.toThrow();
  });

  it('fails a Command without hookData for a beforeCommit declaration', () => {
    const { hookData: _omitted, ...withoutHookData } = widgetCommand();
    expect(() => expectHookableCommand(withoutHookData as Command<{ id: string }>, BEFORE)).toThrow(
      /widget\.create[\s\S]*hookData/,
    );
  });

  it('fails a Command without outboxData for an afterCommit declaration', () => {
    const { outboxData: _omitted, ...withoutOutboxData } = widgetCommand();
    expect(() => expectHookableCommand(withoutOutboxData as Command<{ id: string }>, BOTH)).toThrow(
      /widget\.create[\s\S]*outboxData/,
    );
  });

  it('fails a Command whose action or object type is not the ref’s', () => {
    expect(() => expectHookableCommand(widgetCommand({ action: 'widget.update' }), BOTH)).toThrow(/widget\.update/);
    expect(() => expectHookableCommand(widgetCommand({ objectType: 'gadget' }), BOTH)).toThrow(/gadget/);
  });

  it('fails outbox data that is not audit-state list 1: a nested object', () => {
    const nested = widgetCommand({ outboxData: () => ({ widgetId: 'w-1', owner: { name: 'x' } }) as never });
    expect(() => expectHookableCommand(nested, BOTH, { result: { id: 'w-1' } })).toThrow(/owner/);
  });

  it('fails outbox data that carries a sentinel value', () => {
    const leaking = widgetCommand({ outboxData: () => ({ widgetId: 'w-1', name: 'S176-NAME' }) });
    expect(() =>
      expectHookableCommand(leaking, BOTH, { result: { id: 'w-1' }, sentinels: ['S176-NAME'] }),
    ).toThrow(/S176-NAME/);
  });
});

describe('recordingCommandHooks', () => {
  it('records each call to a registered hook, with the data it was handed', async () => {
    const recording = recordingCommandHooks();
    const entry = recording.on(BEFORE);
    await entry.handler({ data: { id: 'w-1' }, objectId: 'w-1', extension: undefined } as never);
    expect(recording.calls).toEqual([{ action: 'widget.create', objectId: 'w-1', data: { id: 'w-1' }, extension: undefined }]);
  });
});

describe('sealedCommandHookRegistry', () => {
  it('seals a registry the platform way, refusing what composition refuses', async () => {
    const { sealedCommandHookRegistry } = await import('./index.js');
    const recording = recordingCommandHooks();
    const registry = sealedCommandHookRegistry({
      hookableActions: [{ moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] }],
      moduleDependencies: { acme_probe: ['widgets'] },
      hooks: [{ moduleId: 'acme_probe', entries: [recording.on(BEFORE)] }],
    });
    expect(registry.beforeCommit('widget.create').map((hook) => hook.moduleId)).toEqual(['acme_probe']);
    expect(() =>
      sealedCommandHookRegistry({
        hookableActions: [],
        moduleDependencies: {},
        hooks: [{ moduleId: 'acme_probe', entries: [recording.on(BEFORE, { id: 'other' })] }],
      }),
    ).toThrow(/no composed module declares/);
  });
});
