import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BOOT_HOOKS_WITHOUT_PRESENCE,
  checkEntryPresence,
  ENTRY_PRESENCE_LEDGER,
  findUngatedEntries,
  keyOf,
  TIMERS_WITHOUT_PRESENCE,
} from '../../../scripts/check-entry-presence.js';
import {
  isSwitchableModule,
  loadLockedOwners,
  lockedOwners,
} from '../../../scripts/lib/switchable-modules.js';
import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * The entry-presence rule's own test (issues #126 and #146).
 *
 * `check-entry-presence` — `check-timer-presence` until D-68 — exists because the
 * three gating seams that had a static check (routes, workers, subscribers) left
 * the entry points a module schedules for *itself* uncovered: a `price_lists`
 * sweep went on flipping `scheduled → active` with the module switched off, and
 * a `product_feeds` boot hook went on writing BullMQ scheduler keys into Redis at
 * every deploy. A check that merely agreed with the tree after those fixes would
 * prove nothing, so what is proved here is that it goes **red**: on each shape
 * the rule names, on a presence question asked in the wrong place, on a boot hook
 * that mixes work with a contribution, and on the ledger going stale.
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

/**
 * The four boot-hook shapes, in the spellings the tree actually ships (D-68).
 *
 * `MIXED_BOOT_HOOK` is `blog`'s hook as it stood before the split: a scanner
 * registered into `assets_library`' registry beside two row-writing seeds. It is
 * here because a check whose only advice is "probe the top" teaches the repair
 * that breaks it.
 */
const WORK_BOOT_HOOK = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(async () => {
    const { emFactory } = ctx.cradle<BlogCradle>();
    await seedDefaultCategory(emFactory);
  });
}
`;

const PROBED_BOOT_HOOK = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(async () => {
    if (!effectiveState.isPresent('blog')) return;
    const { emFactory } = ctx.cradle<BlogCradle>();
    await seedDefaultCategory(emFactory);
  });
}
`;

const BOOT_HOOK_PROBED_INSIDE_TRY = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(async () => {
    try {
      if (!effectiveState.isPresent('blog')) return;
      await seedDefaultCategory(ctx.cradle<BlogCradle>().emFactory);
    } catch (err) {
      console.warn(err);
    }
  });
}
`;

const MIXED_BOOT_HOOK = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(async () => {
    const { assetReferenceRegistry, emFactory } = ctx.cradle<BlogCradle>();
    registerBlogAssetReferences(assetReferenceRegistry, emFactory);
    await seedDefaultCategory(emFactory);
    await seedBlogRoles(emFactory);
  });
}
`;

/** The ~20 hooks that only push a descriptor into somebody else's registry. */
const CONTRIBUTION_BOOT_HOOK = `
export function registerModule(ctx: ModuleContext): void {
  ctx.onBoot(() => {
    lazyPort<ConfigurationTypeRegistry>(ctx, 'configurationTypeRegistry').register(
      ergonodeConfigurationType,
    );
  });
}
`;

function tree(source: string, file = 'modules/price_lists/plugin.ts'): Map<string, string> {
  return new Map([[file, source]]);
}

/** A `blog`-owned file — the module the boot-hook fixtures above are written as. */
function blogTree(source: string): Map<string, string> {
  return new Map([['modules/blog/backend.ts', source]]);
}

describe('findUngatedEntries — the shapes it has to see', () => {
  it('sees a plugin-body setInterval that asks nothing', () => {
    const found = findUngatedEntries({ sources: tree(UNGATED_INTERVAL) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      moduleId: 'price_lists',
      construct: 'setInterval',
      finding: 'no-presence-decision',
    });
  });

  it('accepts the same timer once presence is decided first', () => {
    expect(findUngatedEntries({ sources: tree(GATED_INTERVAL) })).toHaveLength(0);
  });

  it('sees a presence question asked from inside a try', () => {
    const found = findUngatedEntries({ sources: tree(DECIDED_INSIDE_TRY) });
    expect(found.map((f) => f.finding)).toEqual(['presence-decided-inside-try']);
  });

  it('sees a timer that asks about a different module', () => {
    const found = findUngatedEntries({ sources: tree(ASKS_ABOUT_ANOTHER_MODULE) });
    expect(found.map((f) => f.finding)).toEqual(['presence-decided-for-another-module']);
  });

  it('sees a self-rescheduling setTimeout — the same entry point, another constructor', () => {
    const found = findUngatedEntries({
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
    expect(findUngatedEntries({ sources }).map((f) => f.construct)).toEqual(['process.on']);
  });

  it('sees a setInterval whose callback it cannot read, rather than vouching for it', () => {
    const sources = tree('const timer = setInterval(scheduleFromSomeOtherFile, 300000);');
    expect(findUngatedEntries({ sources }).map((f) => f.finding)).toEqual(['no-presence-decision']);
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
    expect(findUngatedEntries({ sources })).toHaveLength(0);
  });

  it('leaves the kernel alone — it composes before the modules and is never off', () => {
    const sources = new Map([
      ['kernel/lifecycle/registry-cache.ts', 'const t = setInterval(() => this.refresh(), 30000);'],
    ]);
    expect(findUngatedEntries({ sources })).toHaveLength(0);
  });

  it('scans overlay modules too — they are ordinary lifecycle participants', () => {
    const sources = new Map([
      ['apps/acme/modules/loyalty/plugin.ts', 'setInterval(() => expirePoints(), 300000);'],
    ]);
    expect(findUngatedEntries({ sources }).map((f) => f.moduleId)).toEqual(['loyalty']);
  });
});

describe('findUngatedEntries — boot hooks (D-68)', () => {
  it('sees a boot hook that does work and asks nothing', () => {
    const found = findUngatedEntries({ sources: blogTree(WORK_BOOT_HOOK) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      moduleId: 'blog',
      construct: 'ctx.onBoot',
      scheduler: 'onBoot#1',
      finding: 'no-presence-decision',
    });
  });

  it('accepts the same hook once presence is decided first', () => {
    expect(findUngatedEntries({ sources: blogTree(PROBED_BOOT_HOOK) })).toHaveLength(0);
  });

  it('sees a boot hook whose probe is nested in a try', () => {
    const found = findUngatedEntries({ sources: blogTree(BOOT_HOOK_PROBED_INSIDE_TRY) });
    expect(found.map((f) => f.finding)).toEqual(['presence-decided-inside-try']);
  });

  it('sees a mixed hook as mixed, not as a missing probe', () => {
    const found = findUngatedEntries({ sources: blogTree(MIXED_BOOT_HOOK) });
    // The kind is the whole point: `no-presence-decision` would send the reader
    // to "add a probe at the top", which stops the asset-reference scanner and
    // lets an operator delete an asset a switched-off `blog` still references.
    expect(found.map((f) => f.finding)).toEqual(['mixed-boot-hook']);
  });

  it('reports a mixed hook even when it *is* probed — the probe is the damage', () => {
    const probedMixed = MIXED_BOOT_HOOK.replace(
      'const { assetReferenceRegistry',
      "if (!effectiveState.isPresent('blog')) return;\n    const { assetReferenceRegistry",
    );
    expect(findUngatedEntries({ sources: blogTree(probedMixed) }).map((f) => f.finding)).toEqual([
      'mixed-boot-hook',
    ]);
  });

  it('leaves a contribution-only hook alone — probing it would need a restart to undo', () => {
    const sources = new Map([['modules/pim_ergonode/backend.ts', CONTRIBUTION_BOOT_HOOK]]);
    expect(findUngatedEntries({ sources })).toHaveLength(0);
  });

  it('keys each hook by its ordinal, so two hooks in one file are two sites', () => {
    const both = `${CONTRIBUTION_BOOT_HOOK}\n${WORK_BOOT_HOOK}`;
    const found = findUngatedEntries({ sources: blogTree(both) });
    expect(found.map((f) => f.scheduler)).toEqual(['onBoot#2']);
  });

  it('leaves a locked module out of the population — it has no absent state', () => {
    const sources = new Map([['modules/dictionaries/backend.ts', WORK_BOOT_HOOK]]);
    expect(findUngatedEntries({ sources })).toHaveLength(1);
    expect(
      findUngatedEntries({ sources, lockedModules: new Set(['dictionaries']) }),
    ).toHaveLength(0);
  });

  it('still judges a locked module’s timers — that exemption is boot hooks only', () => {
    const sources = tree(UNGATED_INTERVAL, 'modules/price_lists/plugin.ts');
    expect(
      findUngatedEntries({ sources, lockedModules: new Set(['price_lists']) }),
    ).toHaveLength(1);
  });
});

describe('the switchable-module derivation is shared, and reads the manifests', () => {
  const manifests = [
    { id: 'blog', activation: { settingCode: 'blog.enabled', default: true } },
    { id: 'dictionaries', activation: { nonDeactivatable: true, reason: 'core' } },
    { id: 'health_checks' },
  ];

  it('locks exactly the modules whose manifest says so', () => {
    expect([...lockedOwners(manifests)]).toEqual(['dictionaries']);
  });

  it('refuses to answer at all when the manifest index did not load', async () => {
    // The second way this check can read nothing (the first is an empty source
    // walk), and the more dangerous one: an empty locked set would make every
    // module look switchable and the run would still print a colour. The loader
    // throws, and `main()` turns that into exit 2 — never into a pass.
    await expect(loadLockedOwners(join(fileURLToPath(import.meta.url), 'nope'))).rejects.toThrow(
      /could not be imported|declared no modules/,
    );
  });

  it('re-reds a site the moment a lock is withdrawn, with no ledger edit', () => {
    const locked = lockedOwners(manifests);
    const sources = new Map([['modules/dictionaries/backend.ts', WORK_BOOT_HOOK]]);
    expect(findUngatedEntries({ sources, lockedModules: locked })).toHaveLength(0);

    const unlocked = lockedOwners([
      manifests[0]!,
      { id: 'dictionaries', activation: { settingCode: 'x', default: true } },
      manifests[2]!,
    ]);
    expect(isSwitchableModule('dictionaries', unlocked)).toBe(true);
    expect(findUngatedEntries({ sources, lockedModules: unlocked })).toHaveLength(1);
  });
});

describe('checkEntryPresence — the two-way ratchet', () => {
  const key = 'modules/price_lists/plugin.ts:plugin:setInterval';
  const bootKey = 'modules/blog/backend.ts:onBoot#1:ctx.onBoot';

  it('fails on an unledgered ungated timer', () => {
    const result = checkEntryPresence({ sources: tree(UNGATED_INTERVAL) }, {});
    expect(result.violations.map(keyOf)).toEqual([key]);
    expect(result.stale).toEqual([]);
  });

  it('passes when the site is ledgered with a reason', () => {
    const result = checkEntryPresence({ sources: tree(UNGATED_INTERVAL) }, { [key]: 'a reason' });
    expect(result.violations).toHaveLength(0);
    expect(result.ledgered.map(keyOf)).toEqual([key]);
  });

  it('fails on a ledger entry that no longer describes an ungated timer', () => {
    const result = checkEntryPresence({ sources: tree(GATED_INTERVAL) }, { [key]: 'stale now' });
    expect(result.violations).toHaveLength(0);
    expect(result.stale).toEqual([key]);
  });

  it('fails on an unledgered boot hook, and accepts a reasoned entry', () => {
    const sources = blogTree(WORK_BOOT_HOOK);
    expect(checkEntryPresence({ sources }, {}).violations.map(keyOf)).toEqual([bootKey]);
    const ledgered = checkEntryPresence({ sources }, { [bootKey]: 'why it is right to run' });
    expect(ledgered.violations).toHaveLength(0);
    expect(ledgered.ledgered.map(keyOf)).toEqual([bootKey]);
  });

  it('fails on a boot-hook ledger entry naming a site that no longer exists', () => {
    const result = checkEntryPresence({ sources: blogTree(PROBED_BOOT_HOOK) }, {
      [bootKey]: 'the hook this described now probes',
    });
    expect(result.violations).toHaveLength(0);
    expect(result.stale).toEqual([bootKey]);
  });

  it('merges both ledgers, and names what the boot-hook one holds today', () => {
    expect(ENTRY_PRESENCE_LEDGER).toEqual({
      ...TIMERS_WITHOUT_PRESENCE,
      ...BOOT_HOOKS_WITHOUT_PRESENCE,
    });
    // Not a rule — a measurement. `BOOT_HOOKS_WITHOUT_PRESENCE` is allowed to
    // hold entries; every other working hook in the tree is either probed or
    // owned by a non-deactivatable module. The one entry is feature 078's
    // numbering pin (D-95.3): a one-time configuration migration, where probing
    // would leave a deployment that had `invoices` off during the upgrade with
    // invoice numbers of a different shape.
    expect(Object.keys(BOOT_HOOKS_WITHOUT_PRESENCE)).toEqual([
      'packages/modules/invoices/src/backend/index.ts:onBoot#3:ctx.onBoot',
    ]);
    for (const reason of Object.values(BOOT_HOOKS_WITHOUT_PRESENCE)) {
      expect(reason.length).toBeGreaterThan(80);
    }
  });
});

describe('the tree itself', () => {
  /**
   * The whole tree, keyed the way a real run keys it.
   *
   * It used to be `readTree(<backend>/src)`, which read 65 of the 66 registered
   * modules the day the first one became a workspace package (feature 080,
   * T040b) — a walk that comes back short while every assertion under it still
   * passes, which is issue #215 inside a test. `layout.sourceRoots` and
   * `layout.keyOf` are the same two the CLI uses, so this file and the run it
   * stands for cannot come to disagree about which files exist.
   */
  const treeSources = async (): Promise<Map<string, string>> => {
    const layout = await resolveModuleLayout();
    const sources = new Map<string, string>();
    for (const root of layout.sourceRoots) {
      for (const [key, text] of readTree(root)) {
        sources.set(layout.keyOf(join(root, key)), text);
      }
    }
    return sources;
  };

  /**
   * The one file of a module that carries `marker`.
   *
   * Named by module and by what it says rather than by path: `blog`'s entry
   * point was `modules/blog/backend.ts` and is now
   * `packages/modules/blog/src/backend/index.ts`, and there are 64 more moves
   * behind it. Exactly one file must match, so a marker that has spread to two
   * files fails here rather than quietly proving whichever sorted first.
   */
  const fileOf = async (
    sources: ReadonlyMap<string, string>,
    moduleId: string,
    ...markers: readonly string[]
  ): Promise<string> => {
    const layout = await resolveModuleLayout();
    const matches = [...sources]
      .filter(
        ([key, text]) =>
          markers.every((marker) => text.includes(marker)) &&
          layout.moduleIdOfPath(layout.absolutePathOf(key)) === moduleId,
      )
      .map(([key]) => key);
    expect(
      matches,
      `no single file of '${moduleId}' contains all of ${markers.join(', ')}`,
    ).toHaveLength(1);
    return matches[0]!;
  };

  it('has no ungated entry point left, and no stale ledger entry', async () => {
    const sources = await treeSources();
    expect(sources.size, 'no sources found — a vacuous pass').toBeGreaterThan(100);
    // The index is located rather than joined onto a source root (feature 080,
    // T040a), so this reads the same file the CLI reads whichever root the
    // modules are under.
    const lockedModules = await loadLockedOwners((await resolveModuleLayout()).manifestIndexPath);
    expect(lockedModules.size, 'no module read as locked — the manifests did not load').toBeGreaterThan(
      0,
    );
    const result = checkEntryPresence({ sources, lockedModules }, ENTRY_PRESENCE_LEDGER);
    expect(result.violations.map((v) => `${v.file}:${v.line} ${v.finding}`)).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('still sees the sweeps and the boot hooks the rule was written for', async () => {
    const sources = await treeSources();
    // Blank the presence decision out of each and the check must find it again:
    // proof that every compliant site is compliant, not merely unseen. The last
    // five are D-68's population — three of them repaired in the MR that added
    // this ratchet, two of them (`blog`, `cms`) only after their mixed hook was
    // split, which is why the split is what this list is measuring.
    for (const moduleId of [
      'price_lists',
      'ksef',
      'search',
      'blog',
      'cms',
      'inventory',
      'pim_ergonode',
      'product_feeds',
    ] as const) {
      const file = await fileOf(sources, moduleId, `effectiveState.isPresent('${moduleId}')`);
      const text = sources.get(file);
      expect(text, `${file} is not in the tree`).toBeDefined();
      const blanked = (text as string).replaceAll(
        `effectiveState.isPresent('${moduleId}')`,
        'true',
      );
      expect(blanked, `${file} never asked isPresent('${moduleId}')`).not.toBe(text);
      const found = findUngatedEntries({ sources: new Map([[file, blanked]]) });
      expect(found.map((f) => f.moduleId), `${file} went unseen`).toContain(moduleId);
    }
  });

  it('keeps the two asset-reference contributions out of the probed half', async () => {
    const sources = await treeSources();
    // The other direction of the split, and the one a wrong repair breaks: the
    // hook that registers the scanner must still be a *contribution* — nothing
    // this check reports, and nothing anybody is told to probe.
    for (const [moduleId, register] of [
      ['blog', 'registerBlogAssetReferences('],
      ['cms', 'registerCmsAssetReferences('],
    ] as const) {
      // Two markers, because the module also **declares** the function: the
      // site this is about is the boot hook that calls it.
      const file = await fileOf(sources, moduleId, register, 'ctx.onBoot(');
      const text = sources.get(file) as string;
      expect(text, `${file} no longer registers its asset references`).toContain(register);
      const hook = text.slice(text.indexOf(register));
      expect(
        hook.slice(0, hook.indexOf('});')),
        `${file}: the asset-reference contribution grew a presence probe — it must not have one`,
      ).not.toContain('isPresent(');
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
