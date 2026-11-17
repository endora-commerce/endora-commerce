import { describe, expect, it, vi } from 'vitest';
import type { TaskContextDescriptor, TaskContextSearchHit } from '@endora-commerce/contracts';
import { CONTEXT_LOOKUP_LIMIT, lookupContexts } from './context-lookup.js';
import { TaskContextRegistry } from './task-context-registry.js';

/**
 * `GET /tasks/lookups/contexts` — issue #504: a descriptor that publishes
 * `search` is asked **once**, for one bounded page, and nothing it would have
 * to answer for every visible context (`allVisibleContextIds`, `describe`,
 * `canChangeTasks`) is called; a descriptor without it keeps the scan.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function hit(n: number, label: string): TaskContextSearchHit {
  return { id: id(n), description: { label, href: `/x/${n}`, groups: new Map([[`g${n}`, `Stage ${n}`]]) } };
}

function scanning(contextType: string, labels: string[], changeable: (id: string) => boolean = () => true) {
  return {
    contextType,
    ownerModuleId: contextType,
    allVisibleContextIds: vi.fn(async () => labels.map((_, n) => id(n))),
    visibleContextIds: vi.fn(async () => new Set<string>()),
    canSeeAs: vi.fn(async () => false),
    canChangeTasks: vi.fn(async (contextId: string) => changeable(contextId)),
    describe: vi.fn(async (ids: readonly string[]) => {
      const out = new Map<string, { label: string; href: string; groups: Map<string, string> }>();
      for (const contextId of ids) {
        const n = Number(contextId.slice(-12));
        out.set(contextId, { label: labels[n]!, href: `/x/${n}`, groups: new Map() });
      }
      return out;
    }),
  } satisfies TaskContextDescriptor;
}

function registryOf(...descriptors: TaskContextDescriptor[]): TaskContextRegistry {
  const registry = new TaskContextRegistry(() => true);
  for (const descriptor of descriptors) registry.register(descriptor);
  return registry;
}

describe('lookupContexts', () => {
  it('asks a searching descriptor once for one bounded page, and never lists, describes or asks each context', async () => {
    const searching = {
      ...scanning('project', Array.from({ length: 5000 }, (_, n) => `P-${n}`)),
      search: vi.fn(async () => [hit(2, 'P-2 Beta'), hit(1, 'P-1 Alpha')]),
    };
    const found = await lookupContexts(registryOf(searching), '  Żółw ');

    expect(searching.search).toHaveBeenCalledTimes(1);
    expect(searching.search).toHaveBeenCalledWith({ q: 'Żółw', limit: CONTEXT_LOOKUP_LIMIT, changeableOnly: true });
    expect(searching.allVisibleContextIds).not.toHaveBeenCalled();
    expect(searching.describe).not.toHaveBeenCalled();
    expect(searching.canChangeTasks).not.toHaveBeenCalled();
    expect(found).toEqual([
      { contextType: 'project', id: id(1), label: 'P-1 Alpha', groups: [{ id: 'g1', label: 'Stage 1' }] },
      { contextType: 'project', id: id(2), label: 'P-2 Beta', groups: [{ id: 'g2', label: 'Stage 2' }] },
    ]);
  });

  it('asks the next descriptor only for what the page still lacks, and never more than the limit', async () => {
    const first = {
      ...scanning('project', []),
      search: vi.fn(async () => Array.from({ length: 15 }, (_, n) => hit(n, `A ${String(n).padStart(2, '0')}`))),
    };
    const second = {
      ...scanning('other', []),
      search: vi.fn(async ({ limit }: { limit: number }) =>
        Array.from({ length: limit + 10 }, (_, n) => hit(100 + n, `B ${n}`)),
      ),
    };
    const found = await lookupContexts(registryOf(first, second), '');

    expect(second.search).toHaveBeenCalledWith({ q: '', limit: CONTEXT_LOOKUP_LIMIT - 15, changeableOnly: true });
    expect(found).toHaveLength(CONTEXT_LOOKUP_LIMIT);
  });

  it('does not ask the next descriptor once the page is full', async () => {
    const first = {
      ...scanning('project', []),
      search: vi.fn(async () => Array.from({ length: CONTEXT_LOOKUP_LIMIT }, (_, n) => hit(n, `A ${n}`))),
    };
    const second = { ...scanning('other', []), search: vi.fn(async () => []) };
    await lookupContexts(registryOf(first, second), 'a');
    expect(second.search).not.toHaveBeenCalled();
  });

  it('keeps the scan for a descriptor without search: diacritics folded, by label, only what may be changed', async () => {
    const legacy = scanning('legacy', ['Żółw', 'Zebra', 'zolwik', 'Other'], (contextId) => contextId !== id(2));
    const found = await lookupContexts(registryOf(legacy), 'zol');

    expect(legacy.allVisibleContextIds).toHaveBeenCalledTimes(1);
    expect(found.map((option) => option.label)).toEqual(['Żółw']);
  });
});
