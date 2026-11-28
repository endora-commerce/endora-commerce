import { describe, expect, it } from 'vitest';
import { defineFieldSet, hookableAction } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { FieldSetRegistration } from '@endora-commerce/platform/kernel';
import { expectFieldSetWriters } from './index.js';

/**
 * `specs/193-admin-form-extensions/` T028 (FR-041, I-5, `contracts/field-rules.md`
 * §2): every writer a field set lists has a Command in the owner's tests, the
 * Command supplies hook data, and its projection returns every key the writer
 * claims to write — in `after`, and in `before` or `changed` on an update.
 */

const SET = defineFieldSet({
  id: 'widget',
  ownerModuleId: 'widgets',
  fields: [
    { key: 'name', type: 'string', required: true, accepts: ['validation'] },
    { key: 'code', type: 'string', required: false, accepts: ['validation'] },
    { key: 'attributeValues.*', type: 'string', required: false, accepts: ['validation'] },
  ],
});

interface Widget {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
}
const CREATE = hookableAction<{ widget: Widget }>('widget.create', 'widget', ['beforeCommit']);
const UPDATE = hookableAction<{ widget: Widget; changedFields: string[] }>('widget.update', 'widget', ['beforeCommit']);
const SCOPED = hookableAction<{ scopes: { scope: string | null; title: string }[] }>('widget.scoped.save', 'widget', ['beforeCommit']);
const REGISTER = hookableAction<{ widget: Widget }>('widget.register', 'widget', ['beforeCommit']);

const widget: Widget = { id: 'w-1', name: 'Gizmo', code: null };

function command<T>(action: string, hookData?: (result: T) => unknown): Command<T> {
  return {
    action,
    objectType: 'widget',
    objectId: 'w-1',
    run: async () => {
      throw new Error('not run');
    },
    ...(hookData ? { hookData } : {}),
  };
}

const registration = (writers: FieldSetRegistration['writers']): FieldSetRegistration => ({ set: SET, writers });

const createWriter: FieldSetRegistration['writers'][number] = {
  on: CREATE,
  mode: 'create',
  writes: ['name', 'code', 'attributeValues.*'],
  project: (data) => {
    const { widget: w } = data as { widget: Widget };
    return { before: null, after: { name: w.name, code: w.code } };
  },
};
const updateWriter: FieldSetRegistration['writers'][number] = {
  on: UPDATE,
  mode: 'update',
  writes: ['name', 'code'],
  project: (data) => {
    const { widget: w, changedFields } = data as { widget: Widget; changedFields: string[] };
    return { after: { name: w.name, code: w.code }, changed: changedFields };
  },
};

const cases = {
  'widget.create': { command: command<Widget>('widget.create', (result) => ({ widget: result })), result: widget },
  'widget.update': { command: command<Widget>('widget.update', (result) => ({ widget: result, changedFields: ['name'] })), result: widget },
};

function failure(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected expectFieldSetWriters to fail');
}

describe('expectFieldSetWriters (193 T028)', () => {
  it('passes when every writer projects every key it writes', () => {
    expect(() => expectFieldSetWriters(registration([createWriter, updateWriter]), cases)).not.toThrow();
  });

  it('names a writer with no Command, and a Command for no writer', () => {
    expect(failure(() => expectFieldSetWriters(registration([createWriter, updateWriter]), { 'widget.create': cases['widget.create'] }))).toMatch(
      /'widget\.update'.*no Command/,
    );
    expect(failure(() => expectFieldSetWriters(registration([createWriter]), cases))).toMatch(/'widget\.update'.*not a writer/);
  });

  it('accepts a writer listed and skipped with a reason, and refuses an empty reason', () => {
    const register = { ...createWriter, on: REGISTER };
    expect(() =>
      expectFieldSetWriters(registration([createWriter, updateWriter, register]), { ...cases, 'widget.register': { skip: 'Buyer self-registration: the check skips buyers (D-300.3).' } }),
    ).not.toThrow();
    expect(failure(() => expectFieldSetWriters(registration([createWriter, updateWriter, register]), { ...cases, 'widget.register': { skip: '' } }))).toMatch(/reason/);
  });

  it('refuses a Command of another action, and one with no hook data', () => {
    expect(failure(() => expectFieldSetWriters(registration([createWriter, updateWriter]), { ...cases, 'widget.update': { command: command<Widget>('widget.patch', () => ({})), result: widget } }))).toMatch(
      /'widget\.patch'/,
    );
    expect(failure(() => expectFieldSetWriters(registration([createWriter, updateWriter]), { ...cases, 'widget.update': { command: command<Widget>('widget.update'), result: widget } }))).toMatch(
      /no hookData/,
    );
  });

  it('names a key the writer writes and the projection does not return', () => {
    const lossy = { ...updateWriter, project: () => ({ after: { name: 'x' }, changed: ['name'] }) };
    expect(failure(() => expectFieldSetWriters(registration([createWriter, lossy]), cases))).toMatch(/'widget\.update'.*'code'.*after/);
  });

  it('refuses an update projection with neither before nor changed', () => {
    const blind = { ...updateWriter, project: () => ({ before: null, after: { name: 'x', code: null } }) };
    expect(failure(() => expectFieldSetWriters(registration([createWriter, blind]), cases))).toMatch(/before or changed/);
  });

  it('holds a scoped writer to an array with an entry per scope, each covering writes', () => {
    const scoped = {
      on: SCOPED,
      mode: 'update' as const,
      scoped: true,
      writes: ['code'],
      project: (data: unknown) => (data as { scopes: { scope: string | null; title: string }[] }).scopes.map((entry) => ({ scope: entry.scope, after: { code: entry.title }, changed: ['code'] })),
    };
    const scopedCase = { command: command<{ scope: string | null; title: string }[]>('widget.scoped.save', (scopes) => ({ scopes })), result: [{ scope: null, title: 'A' }, { scope: 'channel:b2b', title: 'B' }] };
    expect(() => expectFieldSetWriters(registration([createWriter, updateWriter, scoped]), { ...cases, 'widget.scoped.save': scopedCase })).not.toThrow();
    const flat = { ...scoped, project: () => ({ after: { code: 'A' }, changed: ['code'] }) };
    expect(failure(() => expectFieldSetWriters(registration([createWriter, updateWriter, flat]), { ...cases, 'widget.scoped.save': scopedCase }))).toMatch(/scoped.*array/);
  });
});
