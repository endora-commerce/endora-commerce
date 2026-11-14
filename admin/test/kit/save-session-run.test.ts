import { describe, expect, it, vi } from 'vitest';
import { runSave, type SavePart } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 180 — `runSave`, the one orchestrator every adopting editor's Save calls
 * (`specs/180-one-save-zone-editors/contracts/save-participation.md` §4; FR-011…FR-016;
 * owner rulings OQ-1 = A and OQ-2 = A).
 *
 * Pure: a list of parts in, an outcome out. The host's own write is the first part and is
 * `blocking`; participants follow in zone order and are not.
 */

const NO_ISSUES = { fields: {} } as const;

interface Recorder {
  readonly calls: string[];
}

function part(
  recorder: Recorder,
  id: string,
  options: {
    blocking?: boolean;
    count?: number;
    refuse?: { fields?: Record<string, string>; message?: string };
    validateThrows?: Error;
    saveThrows?: Error;
  } = {},
): SavePart {
  return {
    id,
    label: `label:${id}`,
    blocking: options.blocking ?? false,
    ...(options.count === undefined ? {} : { count: options.count }),
    validate: vi.fn(async () => {
      recorder.calls.push(`validate:${id}`);
      if (options.validateThrows) throw options.validateThrows;
      if (options.refuse) {
        return {
          fields: options.refuse.fields ?? {},
          ...(options.refuse.message === undefined ? {} : { message: options.refuse.message }),
        };
      }
      return NO_ISSUES;
    }),
    save: vi.fn(async () => {
      recorder.calls.push(`save:${id}`);
      if (options.saveThrows) throw options.saveThrows;
    }),
  };
}

describe('runSave', () => {
  it('validates every part, then writes them one after another in the order given', async () => {
    const recorder: Recorder = { calls: [] };
    const outcome = await runSave([
      part(recorder, 'host', { blocking: true, count: 2 }),
      part(recorder, 'price_lists:base-prices', { count: 1 }),
    ]);

    expect(outcome.result).toBe('saved');
    expect(outcome.parts.map((entry) => [entry.id, entry.result, entry.count])).toEqual([
      ['host', 'saved', 2],
      ['price_lists:base-prices', 'saved', 1],
    ]);
    // Every validation before the first write (FR-011), writes in order (FR-013).
    expect(recorder.calls.slice(0, 2).sort()).toEqual(['validate:host', 'validate:price_lists:base-prices']);
    expect(recorder.calls.slice(2)).toEqual(['save:host', 'save:price_lists:base-prices']);
  });

  it('runs every validation even when the first one refuses, and then writes nothing', async () => {
    const recorder: Recorder = { calls: [] };
    const host = part(recorder, 'host', { blocking: true, refuse: { fields: { name: 'Required' } } });
    const prices = part(recorder, 'price_lists:base-prices', { refuse: { message: 'Bad price' } });
    const other = part(recorder, 'other:part');

    const outcome = await runSave([host, prices, other]);

    expect(outcome.result).toBe('refused');
    expect(host.validate).toHaveBeenCalledTimes(1);
    expect(prices.validate).toHaveBeenCalledTimes(1);
    expect(other.validate).toHaveBeenCalledTimes(1);
    expect(host.save).not.toHaveBeenCalled();
    expect(prices.save).not.toHaveBeenCalled();
    expect(other.save).not.toHaveBeenCalled();
    expect(outcome.parts.map((entry) => [entry.id, entry.result])).toEqual([
      ['host', 'refused'],
      ['price_lists:base-prices', 'refused'],
      ['other:part', 'not-attempted'],
    ]);
    expect(outcome.parts[0]?.issues).toEqual({ fields: { name: 'Required' } });
    expect(outcome.parts[1]?.message).toBe('Bad price');
  });

  it('treats a validation that throws as that part refusing, with the error as its message', async () => {
    const recorder: Recorder = { calls: [] };
    const prices = part(recorder, 'price_lists:base-prices', { validateThrows: new Error('network down') });
    const outcome = await runSave([prices]);

    expect(outcome.result).toBe('refused');
    expect(prices.save).not.toHaveBeenCalled();
    expect(outcome.parts[0]).toMatchObject({ result: 'refused', message: 'network down' });
  });

  it('stops at a blocking part that fails: nothing after it is attempted (FR-015)', async () => {
    const recorder: Recorder = { calls: [] };
    const host = part(recorder, 'host', { blocking: true, saveThrows: new Error('conflict') });
    const prices = part(recorder, 'price_lists:base-prices');

    const outcome = await runSave([host, prices]);

    expect(outcome.result).toBe('failed');
    expect(prices.save).not.toHaveBeenCalled();
    expect(outcome.parts.map((entry) => [entry.id, entry.result])).toEqual([
      ['host', 'failed'],
      ['price_lists:base-prices', 'not-attempted'],
    ]);
    expect(outcome.parts[0]?.message).toBe('conflict');
  });

  it('records a non-blocking failure and still attempts the parts after it (OQ-1 = A)', async () => {
    const recorder: Recorder = { calls: [] };
    const host = part(recorder, 'host', { blocking: true });
    const prices = part(recorder, 'price_lists:base-prices', { saveThrows: new Error('boom') });
    const defaults = part(recorder, 'quick_order:ordering-defaults');

    const outcome = await runSave([host, prices, defaults]);

    expect(outcome.result).toBe('partial');
    expect(defaults.save).toHaveBeenCalledTimes(1);
    expect(outcome.parts.map((entry) => [entry.id, entry.result])).toEqual([
      ['host', 'saved'],
      ['price_lists:base-prices', 'failed'],
      ['quick_order:ordering-defaults', 'saved'],
    ]);
  });

  it('a retry with only what is left writes only that part', async () => {
    const recorder: Recorder = { calls: [] };
    const first = await runSave([
      part(recorder, 'host', { blocking: true }),
      part(recorder, 'price_lists:base-prices', { saveThrows: new Error('boom') }),
    ]);
    expect(first.result).toBe('partial');

    // The host applies the outcome: the saved host part is no longer staged, so the next Save
    // hands runSave only the participant that failed.
    const retry: Recorder = { calls: [] };
    const second = await runSave([part(retry, 'price_lists:base-prices')]);
    expect(second.result).toBe('saved');
    expect(retry.calls).toEqual(['validate:price_lists:base-prices', 'save:price_lists:base-prices']);
  });

  it('with stopOnFailure every part is blocking', async () => {
    const recorder: Recorder = { calls: [] };
    const host = part(recorder, 'host', { blocking: true });
    const prices = part(recorder, 'price_lists:base-prices', { saveThrows: new Error('boom') });
    const defaults = part(recorder, 'quick_order:ordering-defaults');

    const outcome = await runSave([host, prices, defaults], { stopOnFailure: true });

    expect(outcome.result).toBe('partial');
    expect(defaults.save).not.toHaveBeenCalled();
    expect(outcome.parts.map((entry) => entry.result)).toEqual(['saved', 'failed', 'not-attempted']);
  });

  it('reports a lone participant that fails, with nothing written, as failed', async () => {
    const recorder: Recorder = { calls: [] };
    const outcome = await runSave([part(recorder, 'price_lists:base-prices', { saveThrows: new Error('boom') })]);
    expect(outcome.result).toBe('failed');
  });

  it('describes a failure through describeError, fields included', async () => {
    const recorder: Recorder = { calls: [] };
    const outcome = await runSave([part(recorder, 'price_lists:base-prices', { saveThrows: new Error('raw') })], {
      describeError: () => ({ fields: { 'PLN.amount': 'Too many decimals' }, message: 'Switched off' }),
    });
    expect(outcome.parts[0]).toMatchObject({
      result: 'failed',
      message: 'Switched off',
      issues: { fields: { 'PLN.amount': 'Too many decimals' }, message: 'Switched off' },
    });
  });

  it('passes one abort signal to every validate and save', async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const probe: SavePart = {
      id: 'host',
      label: 'Host',
      blocking: true,
      validate: async (ctx) => {
        seen.push(ctx.signal);
        return NO_ISSUES;
      },
      save: async (ctx) => {
        seen.push(ctx.signal);
      },
    };
    await runSave([probe], { signal: controller.signal });
    expect(seen).toEqual([controller.signal, controller.signal]);
  });

  it('with no parts there is nothing to do and the outcome is saved', async () => {
    expect(await runSave([])).toEqual({ result: 'saved', parts: [] });
  });
});
