import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkTimerPresence,
  findUngatedTimers,
  keyOf,
  TIMERS_WITHOUT_PRESENCE,
} from '../../../scripts/check-timer-presence.js';

/**
 * The timer-presence rule's own test (issue #126).
 *
 * `check-timer-presence` exists because the three gating seams that had a static
 * check — routes, workers, subscribers — left the one entry point a module
 * schedules for itself uncovered, and a `price_lists` sweep went on flipping
 * `scheduled → active` with the module switched off. A check that merely agreed
 * with the tree after that fix would prove nothing, so what is proved here is
 * that it goes **red**: on each shape the rule names, on a presence question
 * asked in the wrong place, and on the ledger going stale.
 *
 * Sources are synthetic and keyed by their path under `src/`, because that path
 * is what decides the owning module and whether the file is scanned at all.
 */

const UNGATED_INTERVAL = `
export function priceListsModule(options: Options) {
  return {
    plugin: async (app) => {
      const handle = setInterval(() => {
        enterSystemScope('sweep', () => statusWorker.sweep()).catch((err) => {
          app.log.error({ err }, 'sweep failed');
        });
      }, 300000);
      handle.unref();
    },
  };
}
`;

const GATED_INTERVAL = `
export function priceListsModule(options: Options) {
  return {
    plugin: async (app) => {
      const handle = setInterval(() => {
        if (!effectiveState.isPresent('price_lists')) return;
        enterSystemScope('sweep', () => statusWorker.sweep()).catch((err) => {
          app.log.error({ err }, 'sweep failed');
        });
      }, 300000);
      handle.unref();
    },
  };
}
`;

/** The shape the rule is really about: the answer shares the failure's `catch`. */
const DECIDED_INSIDE_TRY = `
const timer = setInterval(() => {
  void (async () => {
    try {
      if (!effectiveState.isPresent('price_lists')) return;
      await statusWorker.sweep();
    } catch (err) {
      console.warn(err);
    }
  })();
}, 300000);
`;

const ASKS_ABOUT_ANOTHER_MODULE = `
const timer = setInterval(() => {
  if (!effectiveState.isPresent('ksef')) return;
  void statusWorker.sweep();
}, 300000);
`;

/** `search`'s reindex scheduler: a `setTimeout` the callback re-arms. */
const SELF_RESCHEDULING = `
export function searchModule(options: Options) {
  return {
    plugin: async (app) => {
      const scheduleNext = (delayMs: number): void => {
        timer = setTimeout(tick, delayMs);
        timer.unref();
      };
      const tick = (): void => {
        void (async () => {
          const result = await reindexWorker.reindex();
          scheduleNext(result.minutes * 60000);
        })();
      };
      scheduleNext(60000);
    },
  };
}
`;

function tree(source: string, file = 'modules/price_lists/plugin.ts'): Map<string, string> {
  return new Map([[file, source]]);
}

describe('findUngatedTimers — the shapes it has to see', () => {
  it('sees a plugin-body setInterval that asks nothing', () => {
    const found = findUngatedTimers({ sources: tree(UNGATED_INTERVAL) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      moduleId: 'price_lists',
      construct: 'setInterval',
      finding: 'no-presence-decision',
    });
  });

  it('accepts the same timer once presence is decided first', () => {
    expect(findUngatedTimers({ sources: tree(GATED_INTERVAL) })).toHaveLength(0);
  });

  it('sees a presence question asked from inside a try', () => {
    const found = findUngatedTimers({ sources: tree(DECIDED_INSIDE_TRY) });
    expect(found.map((f) => f.finding)).toEqual(['presence-decided-inside-try']);
  });

  it('sees a timer that asks about a different module', () => {
    const found = findUngatedTimers({ sources: tree(ASKS_ABOUT_ANOTHER_MODULE) });
    expect(found.map((f) => f.finding)).toEqual(['presence-decided-for-another-module']);
  });

  it('sees a self-rescheduling setTimeout — the same entry point, another constructor', () => {
    const found = findUngatedTimers({
      sources: tree(SELF_RESCHEDULING, 'modules/search/plugin.ts'),
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      moduleId: 'search',
      construct: 'setTimeout',
      scheduler: 'scheduleNext',
    });
  });

  it('sees a process-lifecycle handler', () => {
    const sources = tree(
      "process.on('SIGTERM', async () => { await drainQueue(); });",
      'modules/webhooks/plugin.ts',
    );
    expect(findUngatedTimers({ sources }).map((f) => f.construct)).toEqual(['process.on']);
  });

  it('sees a setInterval whose callback it cannot read, rather than vouching for it', () => {
    const sources = tree('const timer = setInterval(scheduleFromSomeOtherFile, 300000);');
    expect(findUngatedTimers({ sources }).map((f) => f.finding)).toEqual(['no-presence-decision']);
  });

  it('leaves a one-shot deadline alone — its throw has a caller to reach', () => {
    const sources = tree(
      `async function fetchWithTimeout(url: string) {
         const controller = new AbortController();
         const timer = setTimeout(() => controller.abort(), 5000);
         try { return await fetch(url, { signal: controller.signal }); }
         finally { clearTimeout(timer); }
       }
       const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));`,
      'modules/product_feeds/services/delivery.service.ts',
    );
    expect(findUngatedTimers({ sources })).toHaveLength(0);
  });

  it('leaves the kernel alone — it composes before the modules and is never off', () => {
    const sources = new Map([
      ['kernel/lifecycle/registry-cache.ts', 'const t = setInterval(() => this.refresh(), 30000);'],
    ]);
    expect(findUngatedTimers({ sources })).toHaveLength(0);
  });

  it('scans overlay modules too — they are ordinary lifecycle participants', () => {
    const sources = new Map([
      ['apps/acme/modules/loyalty/plugin.ts', 'setInterval(() => expirePoints(), 300000);'],
    ]);
    expect(findUngatedTimers({ sources }).map((f) => f.moduleId)).toEqual(['loyalty']);
  });
});

describe('checkTimerPresence — the two-way ratchet', () => {
  const key = 'modules/price_lists/plugin.ts:plugin:setInterval';

  it('fails on an unledgered ungated timer', () => {
    const result = checkTimerPresence({ sources: tree(UNGATED_INTERVAL) }, {});
    expect(result.violations.map(keyOf)).toEqual([key]);
    expect(result.stale).toEqual([]);
  });

  it('passes when the site is ledgered with a reason', () => {
    const result = checkTimerPresence({ sources: tree(UNGATED_INTERVAL) }, { [key]: 'a reason' });
    expect(result.violations).toHaveLength(0);
    expect(result.ledgered.map(keyOf)).toEqual([key]);
  });

  it('fails on a ledger entry that no longer describes an ungated timer', () => {
    const result = checkTimerPresence({ sources: tree(GATED_INTERVAL) }, { [key]: 'stale now' });
    expect(result.violations).toHaveLength(0);
    expect(result.stale).toEqual([key]);
  });
});

describe('the tree itself', () => {
  it('has no ungated entry point left, and no stale ledger entry', () => {
    const srcRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'src');
    const sources = readTree(srcRoot);
    expect(sources.size, 'no sources found — a vacuous pass').toBeGreaterThan(100);
    const result = checkTimerPresence({ sources }, TIMERS_WITHOUT_PRESENCE);
    expect(result.violations.map((v) => `${v.file}:${v.line}`)).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('still sees the two sweeps the rule was written for', () => {
    const srcRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'src');
    const sources = readTree(srcRoot);
    // Blank the presence decision out of each and the check must find it again:
    // proof the two compliant sites are compliant, not merely unseen.
    for (const [file, moduleId] of [
      ['modules/price_lists/plugin.ts', 'price_lists'],
      ['modules/ksef/plugin.ts', 'ksef'],
      ['modules/search/plugin.ts', 'search'],
    ] as const) {
      const text = sources.get(file);
      expect(text, `${file} is not in the tree`).toBeDefined();
      const blanked = (text as string).replaceAll(
        `effectiveState.isPresent('${moduleId}')`,
        'true',
      );
      expect(blanked, `${file} never asked isPresent('${moduleId}')`).not.toBe(text);
      const found = findUngatedTimers({ sources: new Map([[file, blanked]]) });
      expect(found.map((f) => f.moduleId), `${file} went unseen`).toContain(moduleId);
    }
  });
});

function readTree(root: string): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full, `${prefix}${name}/`);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        sources.set(`${prefix}${name}`, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root, '');
  return sources;
}
