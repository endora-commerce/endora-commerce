/**
 * Issue #1906 — the buyer's create-and-submit, `quote_request.create`, as a
 * hookable Command (`specs/176-command-hooks-outbox/`, `contracts/command-hooks-api.md`
 * §4, §6), on a real `CommandBus` with a sealed hook registry.
 *
 * The EntityManager is a small in-memory world whose `transactional` keeps what
 * a Command wrote only when it resolves, so a refusal is seen to leave nothing:
 * no request, no audit entry, no outbox row, no event.
 *
 * What is held:
 *  1. without a hook the write records the one entry it always recorded, with
 *     the same state, and announces `rfq.created.v1` once;
 *  2. the Command is the ref's (`expectHookableCommand`) and its data is ids,
 *     codes and counts — never the buyer's note;
 *  3. a hook sets the assignee inside the write through `data.assign`: the owner
 *     runs `quote_request.assign` as a child (its own entry, `source` = the hook's
 *     module), re-records the operators' notifications, and the outbox row names
 *     the assignee;
 *  4. an assignee who may not handle the request is refused
 *     `422 RFQ_ASSIGNEE_NOT_ELIGIBLE`, and uncaught it rolls the write back; a
 *     hook may catch it and try another;
 *  5. a veto rolls the write back; a switched-off hook module is skipped;
 *  6. `assign` called outside the hook is a programming error.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  QUOTE_REQUEST_HOOKABLE_ACTIONS as QR,
  defineModuleErrorCodes,
  type QuoteRequestCreateHookData,
  type QuoteRequestResubmitHookData,
} from '@endora-commerce/contracts';
import {
  CommandBus,
  CommandHookRefusal,
  type Command,
  type CommandHookEntry,
} from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import {
  makeBuyerCreateQuoteRequestCommand,
  makeBuyerResubmitQuoteRequestCommand,
  type QuoteRequestBuyerCommandDeps,
  type QuoteRequestBuyerCreateInput,
} from './quote-request-buyer-commands.js';

const ORG_ID = '00000000-0000-4000-8000-000000190601';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000190602';
const CHANNEL_ID = '00000000-0000-4000-8000-000000190603';
const PRODUCT_ID = '00000000-0000-4000-8000-000000190604';
const REP_ID = '00000000-0000-4000-8000-000000190605';
const OTHER_REP_ID = '00000000-0000-4000-8000-000000190606';
const INELIGIBLE_ID = '00000000-0000-4000-8000-000000190607';
const SOURCE_ID = '00000000-0000-4000-8000-000000190608';

const HOOK_MODULE = 'acme_routing';
const ACME = defineModuleErrorCodes(['ACME_ROUTING_REFUSED']);
/** The buyer's note: a value the hook and outbox data must never carry. */
const SENTINEL = 'S1906-NOTE';

function input(): QuoteRequestBuyerCreateInput {
  return {
    customer: { customerAccountId: CUSTOMER_ID, organizationId: ORG_ID },
    salesChannelId: CHANNEL_ID,
    headerNote: SENTINEL,
    lines: [
      { productId: PRODUCT_ID, productName: 'Product', productSlug: 'product', quantity: 2, lineCurrency: 'PLN', position: 0 },
      { productId: PRODUCT_ID, productName: 'Product', productSlug: 'product', quantity: 5, lineCurrency: 'PLN', position: 1 },
    ],
  };
}

interface World {
  readonly requests: QuoteRequest[];
  readonly items: QuoteRequestItem[];
  readonly audits: Array<Record<string, unknown>>;
  readonly outbox: Array<Record<string, unknown>>;
  readonly events: string[];
  readonly notifications: Array<{ kind: 'record' | 'operator'; assignee: string | null; change?: string }>;
  readonly history: Array<{ eventType: string; payload: Record<string, unknown> }>;
}

/**
 * The buyer's create on a real bus over an in-memory world. `transactional`
 * keeps what the Command wrote only when it resolves.
 */
function harness(
  hooks: readonly CommandHookEntry[],
  options: { isPresent?: (moduleId: string) => boolean } = {},
) {
  const world: World = { requests: [], items: [], audits: [], outbox: [], events: [], notifications: [], history: [] };
  let pending = { requests: [] as QuoteRequest[], items: [] as QuoteRequestItem[], audits: [] as Array<Record<string, unknown>>, outbox: [] as Array<Record<string, unknown>>, notifications: [] as World['notifications'] };

  const em: Record<string, unknown> = {
    create: (entity: new () => object, data: Record<string, unknown>) => Object.assign(new entity(), data),
    persist: (row: unknown) => {
      for (const one of Array.isArray(row) ? row : [row]) {
        if (one instanceof QuoteRequest) pending.requests.push(one);
        else if (one instanceof QuoteRequestItem) pending.items.push(one);
        else pending.outbox.push(one as Record<string, unknown>);
      }
      return em;
    },
    flush: async () => undefined,
  };
  em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => {
    pending = { requests: [], items: [], audits: [], outbox: [], notifications: [] };
    const result = await fn(em as unknown as EntityManager);
    world.requests.push(...pending.requests);
    world.items.push(...pending.items);
    world.audits.push(...pending.audits);
    world.outbox.push(...pending.outbox);
    world.notifications.push(...pending.notifications);
    return result;
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin: (_em: unknown, entry: Record<string, unknown>) => {
      pending.audits.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'quote_requests', ...declaration })),
    moduleDependencies: { [HOOK_MODULE]: ['quote_requests'] },
    hooks: hooks.length > 0 ? [{ moduleId: HOOK_MODULE, entries: hooks }] : [],
    ...(options.isPresent ? { isPresent: options.isPresent } : {}),
  });
  const events = new EventBus<Record<string, EventBase>>();
  events.on('rfq.created.v1', async () => {
    world.events.push('rfq.created.v1');
  });
  const bus = new CommandBus(orm, audit, events, { hooks: registry });

  let seq = 0;
  const deps: QuoteRequestBuyerCommandDeps = {
    generateBusinessId: async () => 'QR-1906',
    revisionService: { record: async () => ({ id: 'revision-1' }) as never },
    eventService: {
      append: async (entry) => {
        world.history.push({ eventType: entry.eventType, payload: entry.payload as Record<string, unknown> });
        return { id: `event-${(seq += 1)}`, eventType: entry.eventType, payload: entry.payload, createdAt: new Date() } as never;
      },
    },
    notificationService: {
      record: async (_em, recorded) => {
        pending.notifications.push({
          kind: 'record',
          assignee: recorded.rfq.assignedAdminUserId ?? null,
          ...(recorded.change === 'submitted' ? {} : { change: recorded.change }),
        });
        return 1;
      },
      rerecordOperatorSide: async (_em, recorded) => {
        pending.notifications.push({
          kind: 'operator',
          assignee: recorded.rfq.assignedAdminUserId ?? null,
          ...(recorded.change === 'submitted' ? {} : { change: recorded.change }),
        });
        return 1;
      },
    },
    assigneeEligibility: vi.fn(async (adminUserId: string, organizationId: string) =>
      organizationId === ORG_ID && adminUserId !== INELIGIBLE_ID,
    ),
  };

  // Every Command handed to the bus, the children the write runs included.
  const commands: Array<Command<unknown>> = [];
  const create = () => {
    const command = makeBuyerCreateQuoteRequestCommand(deps, input());
    commands.push(command as Command<unknown>);
    return withSystemScope('test: the buyer create', () => bus.run(command));
  };
  const resubmit = () => {
    const command = makeBuyerResubmitQuoteRequestCommand(deps, { ...input(), sourceQuoteRequestId: SOURCE_ID });
    commands.push(command as Command<unknown>);
    return withSystemScope('test: the buyer resubmit', () => bus.run(command));
  };
  return { world, deps, commands, create, resubmit };
}

/** A `beforeCommit` hook on the buyer's create. */
function hook(handler: (data: QuoteRequestCreateHookData) => Promise<void> | void, id = 'route-request'): CommandHookEntry {
  return { id, on: QR.create, phase: 'beforeCommit', handler: ({ data }) => handler(data) };
}

async function refusalOf(promise: Promise<unknown>): Promise<{ statusCode: number | undefined; code: string | undefined }> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error as { statusCode?: number; code?: string },
  );
  expect(caught, 'the write must be refused').not.toBeNull();
  return { statusCode: caught!.statusCode, code: caught!.code };
}

describe('quote_request.create — the buyer’s create-and-submit (issue #1906)', () => {
  it('is one of the actions the manifest declares hookable, for both phases', () => {
    // The share of `specs/192-quote-request-draft-share/` is declared beside them
    // (`manifest-hookable-actions.test.ts` holds the whole list).
    expect(manifest.hookableActions).toEqual(
      expect.arrayContaining([
        { action: 'quote_request.create', objectType: 'quote_request', phases: ['beforeCommit', 'afterCommit'] },
        { action: 'quote_request.resubmit', objectType: 'quote_request', phases: ['beforeCommit', 'afterCommit'] },
      ]),
    );
  });

  it('without a hook, records the one entry it always recorded and announces rfq.created.v1 once', async () => {
    const h = harness([]);
    const rfq = await h.create();

    expect(h.world.requests).toHaveLength(1);
    expect(rfq.status).toBe('Pending');
    expect(rfq.assignedAdminUserId ?? null).toBeNull();
    expect(h.world.audits).toEqual([
      expect.objectContaining({
        action: 'quote_request.create',
        objectType: 'quote_request',
        objectId: rfq.id,
        stateBefore: null,
        stateAfter: { status: 'Pending', itemCount: 2, salesChannelId: CHANNEL_ID },
      }),
    ]);
    expect(h.world.notifications).toEqual([{ kind: 'record', assignee: null }]);
    expect(h.world.events).toEqual(['rfq.created.v1']);
    expect(h.world.outbox).toEqual([]);
  });

  it('is the Command its ref declares, with list-1 outbox data that never carries the buyer’s note', async () => {
    const h = harness([]);
    const rfq = await h.create();
    expectHookableCommand(h.commands[0]!, QR.create, { result: rfq, sentinels: [SENTINEL] });
  });

  it('hands a hook ids, codes and counts, read on the open write', async () => {
    const seen: Array<Omit<QuoteRequestCreateHookData, 'assign'>> = [];
    const h = harness([
      hook((data) => {
        const { assign: _assign, ...rest } = data;
        seen.push({ ...rest, assignedAdminUserId: data.assignedAdminUserId });
      }),
    ]);
    const rfq = await h.create();
    expect(seen).toEqual([
      {
        quoteRequestId: rfq.id,
        organizationId: ORG_ID,
        customerAccountId: CUSTOMER_ID,
        salesChannelId: CHANNEL_ID,
        assignedAdminUserId: null,
        itemCount: 2,
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain(SENTINEL);
  });

  it('lets a hook set the assignee inside the write: a child quote_request.assign entry, the operators re-told, the outbox naming it', async () => {
    const h = harness([
      hook(async (data) => {
        await data.assign(REP_ID);
      }),
      // An `afterCommit` handler, so the write persists its outbox row (delivered later, by the drain).
      { id: 'after-create', on: QR.create, phase: 'afterCommit', handler: async () => undefined },
    ]);
    const rfq = await h.create();

    expect(rfq.assignedAdminUserId).toBe(REP_ID);
    expect(h.deps.assigneeEligibility).toHaveBeenCalledWith(REP_ID, ORG_ID);
    expect(h.world.audits.map((entry) => [entry['action'], entry['stateBefore'], entry['stateAfter']])).toEqual([
      ['quote_request.assign', { assignedAdminUserId: null }, { assignedAdminUserId: REP_ID, source: HOOK_MODULE }],
      ['quote_request.create', null, { status: 'Pending', itemCount: 2, salesChannelId: CHANNEL_ID }],
    ]);
    // Recorded once without an assignee, then the operators' side again, for the assignee.
    expect(h.world.notifications).toEqual([
      { kind: 'record', assignee: null },
      { kind: 'operator', assignee: REP_ID },
    ]);
    expect(h.world.outbox).toHaveLength(1);
    expect(h.world.outbox[0]!['data']).toEqual({
      quoteRequestId: rfq.id,
      organizationId: ORG_ID,
      customerAccountId: CUSTOMER_ID,
      salesChannelId: CHANNEL_ID,
      assignedAdminUserId: REP_ID,
      itemCount: 2,
    });
    expect(h.world.outbox[0]!['organizationId']).toBe(ORG_ID);
    expect(h.world.events).toEqual(['rfq.created.v1']);
  });

  it('shows a later hook the assignee an earlier one set, and assigning it again writes nothing', async () => {
    const seenByLater: Array<string | null> = [];
    const h = harness([
      hook(async (data) => data.assign(REP_ID), 'first'),
      hook(async (data) => {
        seenByLater.push(data.assignedAdminUserId);
        await data.assign(REP_ID);
      }, 'second'),
    ]);
    await h.create();
    expect(seenByLater).toEqual([REP_ID]);
    expect(h.world.audits.filter((entry) => entry['action'] === 'quote_request.assign')).toHaveLength(1);
    expect(h.world.notifications.filter((n) => n.kind === 'operator')).toHaveLength(1);
  });

  it('refuses an assignee who may not handle the request, and rolls the whole write back', async () => {
    const h = harness([hook(async (data) => data.assign(INELIGIBLE_ID))]);
    expect(await refusalOf(h.create())).toEqual({ statusCode: 422, code: ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE });
    expect(h.world.requests).toEqual([]);
    expect(h.world.audits).toEqual([]);
    expect(h.world.notifications).toEqual([]);
    expect(h.world.events).toEqual([]);
  });

  it('words the refusal for the buyer whose submission it stops (token `submission`)', async () => {
    const h = harness([hook(async (data) => data.assign(INELIGIBLE_ID))]);
    await expect(h.create()).rejects.toMatchObject({ details: { code: 'submission' } });
  });

  it('refuses a malformed id the same way, before asking who it is', async () => {
    const h = harness([hook(async (data) => data.assign('not-a-uuid'))]);
    expect(await refusalOf(h.create())).toEqual({ statusCode: 422, code: ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE });
    expect(h.deps.assigneeEligibility).not.toHaveBeenCalled();
  });

  it('lets a hook catch the refusal and try its next candidate', async () => {
    const h = harness([
      hook(async (data) => {
        for (const candidate of [INELIGIBLE_ID, OTHER_REP_ID]) {
          try {
            await data.assign(candidate);
            return;
          } catch (error) {
            if ((error as { code?: string }).code !== ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE) throw error;
          }
        }
      }),
    ]);
    const rfq = await h.create();
    expect(rfq.assignedAdminUserId).toBe(OTHER_REP_ID);
    expect(h.world.audits.map((entry) => entry['action'])).toEqual(['quote_request.assign', 'quote_request.create']);
  });

  it('rolls the write back on a veto', async () => {
    const h = harness([
      hook(async (data) => {
        await data.assign(REP_ID);
        throw new CommandHookRefusal(409, ACME.ACME_ROUTING_REFUSED, 'Nobody may take this request.');
      }),
    ]);
    expect(await refusalOf(h.create())).toEqual({ statusCode: 409, code: ACME.ACME_ROUTING_REFUSED });
    expect(h.world.requests).toEqual([]);
    expect(h.world.audits).toEqual([]);
    expect(h.world.events).toEqual([]);
  });

  it('skips a switched-off hook module: the write behaves as if it were not installed', async () => {
    const handler = vi.fn(async (data: QuoteRequestCreateHookData) => data.assign(REP_ID));
    const h = harness([hook(handler)], { isPresent: (moduleId) => moduleId !== HOOK_MODULE });
    const rfq = await h.create();
    expect(handler).not.toHaveBeenCalled();
    expect(rfq.assignedAdminUserId ?? null).toBeNull();
    expect(h.world.audits.map((entry) => entry['action'])).toEqual(['quote_request.create']);
  });

  it('refuses assign once the hook is no longer running', async () => {
    let kept: QuoteRequestCreateHookData | null = null;
    const h = harness([
      hook((data) => {
        kept = data;
      }),
    ]);
    await h.create();
    await expect(kept!.assign(REP_ID)).rejects.toThrow(/beforeCommit hook on 'quote_request.create'/);
  });
});

/** A `beforeCommit` hook on the buyer's resubmit. */
function resubmitHook(handler: (data: QuoteRequestResubmitHookData) => Promise<void> | void, id = 'route-resubmitted'): CommandHookEntry {
  return { id, on: QR.resubmit, phase: 'beforeCommit', handler: ({ data }) => handler(data) };
}

describe('quote_request.resubmit — the buyer’s submit-again (issue #1906)', () => {
  it('without a hook, records the entry the hand audit recorded, the re-submitted history and notifications, and announces nothing', async () => {
    const h = harness([]);
    const rfq = await h.resubmit();
    expect(rfq.id).not.toBe(SOURCE_ID);
    expect(h.world.audits).toEqual([
      expect.objectContaining({
        action: 'quote_request.resubmit',
        objectType: 'quote_request',
        objectId: rfq.id,
        stateBefore: null,
        stateAfter: { status: 'Pending', itemCount: 2, salesChannelId: CHANNEL_ID },
      }),
    ]);
    expect(h.world.history).toEqual([
      { eventType: 'created', payload: { type: 'created', sourceRfqId: SOURCE_ID } },
      { eventType: 're-submitted', payload: { type: 're-submitted', sourceRfqId: SOURCE_ID, newRfqId: rfq.id } },
    ]);
    expect(h.world.notifications).toEqual([{ kind: 'record', assignee: null, change: 'resubmitted' }]);
    expect(h.world.events).toEqual([]);
  });

  it('is the Command its ref declares, with list-1 outbox data naming the source request', async () => {
    const h = harness([]);
    const rfq = await h.resubmit();
    expectHookableCommand(h.commands[0]!, QR.resubmit, { result: rfq, sentinels: [SENTINEL] });
    expect(h.commands[0]!.outboxData!(rfq)).toMatchObject({ quoteRequestId: rfq.id, sourceQuoteRequestId: SOURCE_ID });
  });

  it('lets a hook set the assignee inside the write, and re-tells the operators of the resubmission', async () => {
    const seen: Array<string> = [];
    const h = harness([
      resubmitHook(async (data) => {
        seen.push(data.sourceQuoteRequestId);
        await data.assign(REP_ID);
      }),
      { id: 'after-resubmit', on: QR.resubmit, phase: 'afterCommit', handler: async () => undefined },
    ]);
    const rfq = await h.resubmit();
    expect(seen).toEqual([SOURCE_ID]);
    expect(rfq.assignedAdminUserId).toBe(REP_ID);
    expect(h.world.audits.map((entry) => [entry['action'], entry['stateAfter']])).toEqual([
      ['quote_request.assign', { assignedAdminUserId: REP_ID, source: HOOK_MODULE }],
      ['quote_request.resubmit', { status: 'Pending', itemCount: 2, salesChannelId: CHANNEL_ID }],
    ]);
    expect(h.world.notifications).toEqual([
      { kind: 'record', assignee: null, change: 'resubmitted' },
      { kind: 'operator', assignee: REP_ID, change: 'resubmitted' },
    ]);
    expect(h.world.outbox[0]!['data']).toMatchObject({ assignedAdminUserId: REP_ID, sourceQuoteRequestId: SOURCE_ID });
  });

  it('refuses an ineligible assignee and rolls the resubmit back', async () => {
    const h = harness([resubmitHook(async (data) => data.assign(INELIGIBLE_ID))]);
    expect(await refusalOf(h.resubmit())).toEqual({ statusCode: 422, code: ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE });
    expect(h.world.requests).toEqual([]);
    expect(h.world.audits).toEqual([]);
  });

  it('does not run the create’s hooks, and the create’s hooks cannot assign on a resubmit', async () => {
    const onCreate = vi.fn();
    const h = harness([hook(onCreate)]);
    await h.resubmit();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
