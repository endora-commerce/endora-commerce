import type { EntityManager } from '@mikro-orm/postgresql';
import { extractOpportunityReferenceTokens } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { createDemoComposition } from './composition.js';
import {
  DEMO_OPPORTUNITIES,
  DEMO_OPPORTUNITY_IDS,
  DEMO_PIPELINE_MODULES,
  DEMO_PIPELINE_STEP_NAME,
  DEMO_PIPELINE_TAG_NAMES,
  renderDemoText,
} from './sales-pipeline.js';

/**
 * What the demo sales pipeline is, read off its declaration.
 *
 * `backend/test/integration/demo/demo-shop.test.ts` seeds it into a database
 * and holds the rows to a recorded delta and to the relations between them.
 * These are the statements that need no database: that the pipeline covers the
 * workflow CRM's own migration seeds, that each Opportunity's history is a walk
 * that workflow allows, in the order time runs, and that a step whose module is
 * switched off is a reported skip that touches nothing.
 */

/** The workflow `crm`'s init migration seeds — its statuses and what each may move to. */
const SEEDED_WORKFLOW: Readonly<Record<string, readonly string[]>> = {
  new: ['qualified', 'lost'],
  qualified: ['proposal', 'lost'],
  proposal: ['negotiation', 'won', 'lost'],
  negotiation: ['won', 'lost'],
  won: [],
  lost: ['new'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const untouchable = new Proxy({} as EntityManager, {
  get(_target, property) {
    throw new Error(`the composition used the EntityManager (${String(property)})`);
  },
});

describe('the demo sales pipeline', () => {
  const currentStatus = (index: number): string => DEMO_OPPORTUNITIES[index]!.path.at(-1)!.status;
  const perStatus = (): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const [index] of DEMO_OPPORTUNITIES.entries()) {
      counts[currentStatus(index)] = (counts[currentStatus(index)] ?? 0) + 1;
    }
    return counts;
  };

  it('puts two Opportunities in every status of the seeded workflow', () => {
    // A board with an empty column, or analytics with nothing closed, is the
    // demo that demonstrates nothing.
    expect(perStatus()).toEqual({
      new: 2,
      qualified: 2,
      proposal: 2,
      negotiation: 2,
      won: 2,
      lost: 2,
    });
  });

  it('keys every Opportunity on a fixed id of its own', () => {
    expect(new Set(DEMO_OPPORTUNITY_IDS).size).toBe(DEMO_OPPORTUNITIES.length);
    for (const id of DEMO_OPPORTUNITY_IDS) expect(id).toMatch(UUID);
  });

  it('walks each one from the start status along transitions the workflow allows', () => {
    for (const opportunity of DEMO_OPPORTUNITIES) {
      expect(opportunity.path[0]!.status, opportunity.title).toBe('new');
      for (const [index, step] of opportunity.path.entries()) {
        if (index === 0) continue;
        const from = opportunity.path[index - 1]!.status;
        expect(SEEDED_WORKFLOW[from], `${opportunity.title}: ${from} → ${step.status}`).toContain(
          step.status,
        );
      }
    }
  });

  it('dates every change after the one before it, and none in the future', () => {
    for (const opportunity of DEMO_OPPORTUNITIES) {
      const days = opportunity.path.map((step) => step.daysAgo);
      expect(days, opportunity.title).toEqual([...days].sort((left, right) => right - left));
      expect(new Set(days).size, opportunity.title).toBe(days.length);
      expect(Math.min(...days), opportunity.title).toBeGreaterThan(0);
      for (const comment of opportunity.comments ?? []) {
        expect(comment.daysAgo, opportunity.title).toBeGreaterThan(0);
        expect(comment.daysAgo, opportunity.title).toBeLessThanOrEqual(days[0]!);
      }
    }
  });

  it('spreads the pipeline over about three months, so every analytics period has something', () => {
    const oldest = Math.max(...DEMO_OPPORTUNITIES.map((opportunity) => opportunity.path[0]!.daysAgo));
    expect(oldest).toBeGreaterThan(60);
    expect(oldest).toBeLessThanOrEqual(92);
  });

  it('assigns across both demo Sales Reps and leaves exactly one with nobody', () => {
    const assignees = DEMO_OPPORTUNITIES.map((opportunity) => opportunity.assignee);
    expect(assignees.filter((assignee) => assignee === null)).toHaveLength(1);
    expect(new Set(assignees)).toEqual(new Set(['anna', 'tomasz', null]));
  });

  it('values most by hand and leaves one to be calculated from its documents', () => {
    const computed = DEMO_OPPORTUNITIES.filter((opportunity) => opportunity.value === 'computed');
    expect(computed).toHaveLength(1);
    // Calculated from linked Orders and Quote Requests, and the demo has
    // neither: a closed Opportunity worth nothing would be a false statement.
    expect(SEEDED_WORKFLOW[computed[0]!.path.at(-1)!.status]).not.toEqual([]);
    for (const opportunity of DEMO_OPPORTUNITIES) {
      if (opportunity.value === 'computed') continue;
      expect(opportunity.value, opportunity.title).toMatch(/^[1-9]\d*\.\d{2}$/);
    }
  });

  it('gives every lost Opportunity its reason', () => {
    for (const opportunity of DEMO_OPPORTUNITIES) {
      const lost = opportunity.path.at(-1)!.status === 'lost';
      expect(opportunity.lostReason !== undefined, opportunity.title).toBe(lost);
    }
  });

  it('labels with the tags `crm` seeds, and with no other', () => {
    const used = new Set(DEMO_OPPORTUNITIES.flatMap((opportunity) => opportunity.tags));
    expect(used).toEqual(new Set(DEMO_PIPELINE_TAG_NAMES));
  });

  it('carries notes and a message, one naming a Product and one a person', () => {
    const comments = DEMO_OPPORTUNITIES.flatMap((opportunity) => opportunity.comments ?? []);
    expect(comments.filter((comment) => comment.kind === 'note').length).toBeGreaterThanOrEqual(2);
    expect(comments.filter((comment) => comment.kind === 'message').length).toBeGreaterThanOrEqual(1);
    const parts = comments.flatMap((comment) => comment.body);
    expect(parts.some((part) => typeof part !== 'string' && 'product' in part)).toBe(true);
    expect(parts.some((part) => typeof part !== 'string' && 'person' in part)).toBe(true);
  });
});

describe('a demo text', () => {
  const PRODUCT = '11111111-1111-4111-8111-111111111111';
  const PERSON = '22222222-2222-4222-8222-222222222222';
  const text = [
    { person: 'tomasz', otherwise: 'Tomasz' },
    ', please check ',
    { product: 'cables', otherwise: 'the cable' },
    '.',
  ] as const;

  it('names what it found in the grammar the contracts package owns', () => {
    const rendered = renderDemoText(text, {
      products: new Map([['cables', PRODUCT]]),
      people: new Map([['tomasz', PERSON]]),
    });
    expect(rendered.text).toBe(`[[admin_user:${PERSON}]], please check [[product:${PRODUCT}]].`);
    expect(extractOpportunityReferenceTokens(rendered.text)).toEqual(rendered.references);
    expect(rendered.references).toEqual([
      { type: 'admin_user', id: PERSON },
      { type: 'product', id: PRODUCT },
    ]);
  });

  it('reads as a sentence when a target is not there, and references nothing', () => {
    const rendered = renderDemoText(text, { products: new Map(), people: new Map() });
    expect(rendered.text).toBe('Tomasz, please check the cable.');
    expect(rendered.references).toEqual([]);
  });
});

describe('the pipeline step in an instance', () => {
  it('is a step of the composition, after the buyer it names as a contact', async () => {
    const result = await createDemoComposition({ em: untouchable, isPresent: () => false }).apply();
    const steps = result.skipped.map((entry) => entry.step);
    expect(steps).toContain(DEMO_PIPELINE_STEP_NAME);
    expect(steps.indexOf(DEMO_PIPELINE_STEP_NAME)).toBeGreaterThan(
      steps.indexOf('demo buyer joins the demo organisation'),
    );
  });

  it('is a reported skip naming `crm` when CRM is not present, in both directions', async () => {
    // `organizations` is the one module left present: it is on the step's own
    // list, and no step names it alone, so nothing runs over the EntityManager
    // that throws on any use. The case where `crm` *alone* is off, over a real
    // database, is `backend/test/integration/demo/demo-pipeline-off-state.test.ts`.
    const onlyOrganizations = (moduleId: string): boolean => moduleId === 'organizations';
    expect(DEMO_PIPELINE_MODULES).toContain('organizations');
    for (const direction of ['apply', 'withdraw'] as const) {
      const composition = createDemoComposition({ em: untouchable, isPresent: onlyOrganizations });
      const result = await composition[direction]();
      const skip = result.skipped.find((entry) => entry.step === DEMO_PIPELINE_STEP_NAME);
      expect(skip?.reason, direction).toMatch(/\bcrm\b/);
      expect(skip?.reason, direction).not.toMatch(/\borganizations\b/);
      expect(result.applied, direction).toEqual([]);
    }
  });

  it('names every module whose rows it reads or writes', () => {
    expect([...DEMO_PIPELINE_MODULES].sort()).toEqual([
      'admin_users',
      'catalog',
      'crm',
      'customer_accounts',
      'organizations',
    ]);
  });
});
