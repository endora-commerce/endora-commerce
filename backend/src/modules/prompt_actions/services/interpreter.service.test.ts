import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { InterpreterService } from './interpreter.service.js';
import type { PromptActionTool, ToolContext } from '@b2b/contracts';
import { PromptActionToolRegistry } from './tool-registry.js';
import { LlmProviderError, type LlmCompletion, type LlmRequest } from './llm/provider.js';

/**
 * T026 — unit tests for the interpreter loop (feature 043 US1/US3,
 * research §R1/§R8). The provider is scripted; no HTTP, no DB.
 */

const toolCtx: ToolContext = {
  adminUserId: 'admin-1',
  requestId: 'req-1',
  auditCtx: {},
};

const allVisible = {
  hasPermission: async () => true,
  isModuleInstalled: async () => true,
};

function makeRegistry(opts: {
  onResolve?: (params: unknown) => Promise<unknown>;
  onPreview?: (params: unknown) => Promise<{ headline: string; affectedCount: number; current?: unknown }>;
  onExecute?: (params: unknown) => Promise<unknown>;
} = {}): PromptActionToolRegistry {
  const registry = new PromptActionToolRegistry();
  registry.register({
    id: 'catalog.search_products',
    moduleId: 'catalog',
    kind: 'resolver',
    description: 'Search products.',
    requiredPermission: 'catalog:read',
    paramsSchema: z.object({ q: z.string() }),
    execute: opts.onResolve ?? (async () => [{ id: 'p1', label: 'Bolts 0193' }]),
  } as PromptActionTool);
  registry.register({
    id: 'inventory.set_stock_level',
    moduleId: 'inventory',
    kind: 'mutation',
    description: 'Set stock.',
    requiredPermission: 'catalog:write',
    paramsSchema: z.object({ productId: z.string(), warehouseId: z.string(), quantity: z.number().int() }),
    execute: opts.onExecute ?? (async () => ({ ok: true })),
    preview:
      opts.onPreview ??
      (async () => ({ headline: 'Set stock of "Bolts 0193" in "Default" to 120', affectedCount: 1, current: { onHand: 80 } })),
  } as PromptActionTool);
  return registry;
}

function scriptedInterpreter(
  completions: Array<LlmCompletion | Error>,
  registry = makeRegistry(),
  overrides: Partial<{ maxRounds: number; wallClockMs: number; now: () => number }> = {},
): { service: InterpreterService; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let i = 0;
  const adapter = {
    provider: 'anthropic' as const,
    complete: vi.fn(async (req: LlmRequest) => {
      requests.push(req);
      const next = completions[Math.min(i, completions.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      return next as LlmCompletion;
    }),
  };
  const service = new InterpreterService({
    registry,
    providerFactory: {
      resolve: async () => ({ adapter, provider: 'anthropic', model: 'test-model', bulkLimit: 500 }),
    },
    ...overrides,
  });
  return { service, requests };
}

const done = (text = 'Done.'): LlmCompletion => ({ text, toolCalls: [], stopReason: 'end' });
const calls = (...toolCalls: LlmCompletion['toolCalls']): LlmCompletion => ({
  text: null,
  toolCalls,
  stopReason: 'tool_use',
});

describe('InterpreterService (T026)', () => {
  it('executes resolvers, captures the mutation (without executing it), and produces a plan', async () => {
    const executeSpy = vi.fn(async () => ({ ok: true }));
    const registry = makeRegistry({ onExecute: executeSpy });
    const { service, requests } = scriptedInterpreter(
      [
        calls({ id: 'c1', name: 'catalog.search_products', arguments: { q: 'Bolts 0193' } }),
        calls({
          id: 'c2',
          name: 'inventory.set_stock_level',
          arguments: { productId: 'p1', warehouseId: 'w1', quantity: 120 },
        }),
        done(),
      ],
      registry,
    );

    const outcome = await service.interpret({ prompt: 'set stock', toolCtx, visibility: allVisible });
    expect(outcome.kind).toBe('plan');
    if (outcome.kind !== 'plan') return;
    expect(outcome.plan.operations).toHaveLength(1);
    expect(outcome.plan.operations[0]).toMatchObject({
      toolId: 'inventory.set_stock_level',
      requiredPermission: 'catalog:write',
      params: { productId: 'p1', warehouseId: 'w1', quantity: 120 },
      preview: { affectedCount: 1, current: { onHand: 80 } },
    });
    expect(outcome.plan.summary).toContain('Bolts 0193');
    // The mutation was captured, never executed (FR-004/FR-005).
    expect(executeSpy).not.toHaveBeenCalled();
    // Resolver result was fed back as a tool_result message.
    const fedBack = requests.at(-1)!.messages.filter((m) => m.role === 'tool_result');
    expect(JSON.stringify(fedBack)).toContain('Bolts 0193');
    expect(JSON.stringify(fedBack)).toContain('captured');
  });

  it('sends only permission-visible tools to the provider and lists the rest as unavailable', async () => {
    const { service, requests } = scriptedInterpreter([done()]);
    await service.interpret({
      prompt: 'x',
      toolCtx,
      visibility: {
        hasPermission: async (p) => p === 'catalog:read',
        isModuleInstalled: async () => true,
      },
    });
    const toolNames = requests[0]!.tools.map((t) => t.name);
    expect(toolNames).toContain('catalog.search_products');
    expect(toolNames).not.toContain('inventory.set_stock_level');
    expect(requests[0]!.system).toContain('inventory.set_stock_level');
    expect(requests[0]!.system).toContain('permission_denied');
  });

  it('returns a clarification when the model calls request_clarification', async () => {
    const { service } = scriptedInterpreter([
      calls({
        id: 'c1',
        name: 'request_clarification',
        arguments: {
          question: 'Which product?',
          kind: 'entity_choice',
          candidates: [
            { id: 'p1', label: 'Bolts 0193' },
            { id: 'p2', label: 'Bolts 0200' },
          ],
        },
      }),
    ]);
    const outcome = await service.interpret({ prompt: 'bolts', toolCtx, visibility: allVisible });
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') return;
    expect(outcome.clarification.candidates).toHaveLength(2);
    expect(outcome.conversation.messages.length).toBeGreaterThan(0);
  });

  it('maps report_outcome to unsupported / refused', async () => {
    const unsupported = await scriptedInterpreter([
      calls({ id: 'c1', name: 'report_outcome', arguments: { kind: 'unsupported' } }),
    ]).service.interpret({ prompt: 'send a newsletter', toolCtx, visibility: allVisible });
    expect(unsupported.kind).toBe('unsupported');

    const refused = await scriptedInterpreter([
      calls({ id: 'c1', name: 'report_outcome', arguments: { kind: 'permission_denied' } }),
    ]).service.interpret({ prompt: 'set stock', toolCtx, visibility: allVisible });
    expect(refused.kind).toBe('refused');
  });

  it('finishing with no captured mutation is unsupported — model prose is not echoed', async () => {
    const outcome = await scriptedInterpreter([
      done('I think you should buy a llama.'),
    ]).service.interpret({ prompt: 'hello', toolCtx, visibility: allVisible });
    expect(outcome).toEqual({ kind: 'unsupported', detail: null });
  });

  it('hard-stops on an unregistered tool name (FR-014)', async () => {
    const outcome = await scriptedInterpreter([
      calls({ id: 'c1', name: 'catalog.drop_database', arguments: {} }),
    ]).service.interpret({ prompt: 'x', toolCtx, visibility: allVisible });
    expect(outcome.kind).toBe('failed');
  });

  it('feeds schema-invalid arguments back, then fails after the retry budget', async () => {
    const bad = calls({
      id: 'c1',
      name: 'inventory.set_stock_level',
      arguments: { productId: 'p1' }, // missing fields
    });
    const outcome = await scriptedInterpreter([bad, bad, bad, bad]).service.interpret({
      prompt: 'x',
      toolCtx,
      visibility: allVisible,
    });
    expect(outcome.kind).toBe('failed');
  });

  it('caps the loop at maxRounds', async () => {
    const keepSearching = calls({ id: 'c', name: 'catalog.search_products', arguments: { q: 'x' } });
    const { service } = scriptedInterpreter(
      Array.from({ length: 20 }, () => keepSearching),
      makeRegistry(),
      { maxRounds: 3 },
    );
    const outcome = await service.interpret({ prompt: 'x', toolCtx, visibility: allVisible });
    expect(outcome).toMatchObject({ kind: 'failed' });
  });

  it('aborts on the wall-clock budget', async () => {
    let t = 0;
    const { service } = scriptedInterpreter(
      [calls({ id: 'c', name: 'catalog.search_products', arguments: { q: 'x' } }), done()],
      makeRegistry(),
      { wallClockMs: 10, now: () => (t += 50) },
    );
    const outcome = await service.interpret({ prompt: 'x', toolCtx, visibility: allVisible });
    expect(outcome).toMatchObject({ kind: 'failed' });
  });

  it('blocks the plan when a preview exceeds the bulk limit (FR-010)', async () => {
    const registry = makeRegistry({
      onPreview: async () => ({ headline: 'Assign 900 products', affectedCount: 900 }),
    });
    const outcome = await scriptedInterpreter(
      [
        calls({
          id: 'c1',
          name: 'inventory.set_stock_level',
          arguments: { productId: 'p1', warehouseId: 'w1', quantity: 1 },
        }),
      ],
      registry,
    ).service.interpret({ prompt: 'x', toolCtx, visibility: allVisible });
    expect(outcome).toEqual({ kind: 'blocked_bulk_limit', limit: 500, affectedCount: 900 });
  });

  it('maps provider errors to a failed outcome (FR-017) without throwing', async () => {
    const outcome = await scriptedInterpreter([
      new LlmProviderError('anthropic', 'http', 'HTTP 529', 529),
    ]).service.interpret({ prompt: 'x', toolCtx, visibility: allVisible });
    expect(outcome.kind).toBe('failed');
  });

  it('resolver errors are fed back as data so the model can adapt', async () => {
    const registry = makeRegistry({
      onResolve: async () => {
        throw new Error('No products matched.');
      },
    });
    const { service, requests } = scriptedInterpreter(
      [
        calls({ id: 'c1', name: 'catalog.search_products', arguments: { q: 'zzz' } }),
        calls({ id: 'c2', name: 'report_outcome', arguments: { kind: 'unsupported', message: 'not found' } }),
      ],
      registry,
    );
    const outcome = await service.interpret({ prompt: 'x', toolCtx, visibility: allVisible });
    expect(outcome.kind).toBe('unsupported');
    const fedBack = requests.at(-1)!.messages.filter((m) => m.role === 'tool_result');
    expect(JSON.stringify(fedBack)).toContain('No products matched.');
  });

  it('resumes a stored conversation with the clarification answer appended (US3)', async () => {
    const { service, requests } = scriptedInterpreter([
      calls({
        id: 'c2',
        name: 'inventory.set_stock_level',
        arguments: { productId: 'p1', warehouseId: 'w1', quantity: 120 },
      }),
      done(),
    ]);
    const outcome = await service.interpret({
      prompt: 'irrelevant — resumed',
      toolCtx,
      visibility: allVisible,
      resumeConversation: {
        messages: [
          { role: 'user', text: 'set stock of bolts' },
          {
            role: 'assistant',
            text: null,
            toolCalls: [{ id: 'c1', name: 'request_clarification', arguments: { question: 'Which?' } }],
          },
        ],
      },
      clarificationAnswer: 'Bolts 0193',
    });
    expect(outcome.kind).toBe('plan');
    const sent = requests[0]!.messages;
    expect(sent[0]).toMatchObject({ role: 'user', text: 'set stock of bolts' });
    const userTurns = sent.filter((m) => m.role === 'user');
    expect(JSON.stringify(userTurns.at(-1))).toContain('Bolts 0193');
  });
});
