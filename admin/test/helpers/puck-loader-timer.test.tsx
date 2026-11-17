import { describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Puck, type Config, type Data } from '@puckeditor/core';
import { PUCK_LOADER_TIMER_MS, outlivePuckLoaderTimer, trackPuckMounts } from './puck-loader-timer';

/**
 * Issue #1035. Puck's canvas arms a 500 ms timer on mount and never clears it,
 * so a file that mounted Puck has to outlive that timer before its jsdom goes.
 * Which files have to wait was decided by looking for Puck's root in the DOM in
 * the setup file's `afterEach` — but hooks run in stack order, so a file whose
 * own `afterEach(() => cleanup())` runs first had already unmounted Puck when
 * the setup file looked, and never waited. The tracker has to see a Puck that
 * has come and gone.
 */

const config = { components: {} } as unknown as Config;
const data = { root: { props: {} }, content: [] } as unknown as Data;

async function mountPuck(): Promise<void> {
  render(<Puck config={config} data={data} iframe={{ enabled: false }} />);
  await waitFor(() => expect(document.querySelector('[class*="_Puck_"]')).not.toBeNull());
}

describe('trackPuckMounts', () => {
  it('reports a Puck that was mounted and already unmounted again', async () => {
    const tracker = trackPuckMounts();
    try {
      await mountPuck();
      cleanup();
      expect(document.querySelector('[class*="_Puck_"]')).toBeNull();
      expect(tracker.mounted).toBe(true);
    } finally {
      tracker.stop();
    }
  });

  it('reports nothing for a file that never mounted Puck', () => {
    const tracker = trackPuckMounts();
    try {
      render(<div className="_NotPuck_">plain</div>);
      cleanup();
      expect(tracker.mounted).toBe(false);
    } finally {
      tracker.stop();
    }
  });
});

describe('outlivePuckLoaderTimer', () => {
  it('returns at once when Puck was never mounted', async () => {
    const started = Date.now();
    await outlivePuckLoaderTimer({ mounted: false, stop: () => undefined });
    expect(Date.now() - started).toBeLessThan(PUCK_LOADER_TIMER_MS);
  });

  it('outlives a loader timer armed just before it was called', async () => {
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, PUCK_LOADER_TIMER_MS);
    await outlivePuckLoaderTimer({ mounted: true, stop: () => undefined });
    expect(fired).toBe(true);
  });
});
