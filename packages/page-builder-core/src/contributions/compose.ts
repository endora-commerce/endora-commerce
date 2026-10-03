// The composition steps of `contracts/block-renderers.md` R5.2.1, each pure.
//
// They report instead of logging: a storefront, an admin editor and a test each
// want a different thing done with "this contribution was ignored", and a pure
// function that logs is one a test has to spy on.

import type { ComponentConfig, Config } from '@puckeditor/core';

import { ownerOf } from '../block-name.js';
import type { BlockPresence } from './types.js';

/** The blocks one contributor offers. */
export interface BlockContributionEntry {
  /**
   * The contributing module's id, or `null` for blocks the surface's owner
   * registered locally — an overlay module's, which no installed package
   * renders. A local block's owner segment is not checked.
   */
  readonly moduleId: string | null;
  readonly blocks: Readonly<Record<string, ComponentConfig>> | undefined;
}

/** One contributed block that was not composed, and who offered it. */
export interface IgnoredBlockContribution {
  readonly name: string;
  readonly moduleId: string | null;
}

export interface ContributedBlocksResult {
  readonly config: Config;
  /** The names this call added, in contribution order. */
  readonly added: readonly string[];
  /** Offered for a name that was already present; the existing one was kept. */
  readonly collisions: readonly IgnoredBlockContribution[];
  /** Offered by a module the name does not belong to, or not a block at all; dropped. */
  readonly foreign: readonly IgnoredBlockContribution[];
}

function isBlockConfig(value: unknown): value is ComponentConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { render?: unknown }).render === 'function'
  );
}

/**
 * Add contributed blocks to a config.
 *
 * Two rules, and they are what FR-010 means in code. **A name already present
 * is kept**: a contribution never replaces a renderer, first-party or an
 * earlier contributor's. **A name whose owner segment is not the contributing
 * module is dropped**: a block name states its owner, so a package can draw
 * only what it declares. Both are reported, neither throws — one wrong entry in
 * one installed package must not cost the page every other block.
 */
export function withContributedBlocks(
  config: Config,
  entries: readonly BlockContributionEntry[],
): ContributedBlocksResult {
  const components: Record<string, ComponentConfig> = {
    ...((config.components ?? {}) as Record<string, ComponentConfig>),
  };
  const added: string[] = [];
  const collisions: IgnoredBlockContribution[] = [];
  const foreign: IgnoredBlockContribution[] = [];

  for (const entry of entries) {
    for (const [name, block] of Object.entries(entry.blocks ?? {})) {
      const report = { name, moduleId: entry.moduleId };
      if (!isBlockConfig(block)) {
        foreign.push(report);
        continue;
      }
      if (entry.moduleId !== null && ownerOf(name) !== entry.moduleId) {
        foreign.push(report);
        continue;
      }
      if (Object.hasOwn(components, name)) {
        collisions.push(report);
        continue;
      }
      components[name] = block;
      added.push(name);
    }
  }

  return {
    config: added.length === 0 ? config : ({ ...config, components } as Config),
    added,
    collisions,
    foreign,
  };
}

/** Is `owner` present under `presence`? Only a reported absence answers no. */
export function isOwnerPresent(presence: BlockPresence, owner: string): boolean {
  return !presence.absent.includes(owner);
}

/** What a surface passes when presence could not be decided: nobody is reported absent. */
export const EVERY_BLOCK_OWNER_PRESENT: BlockPresence = { absent: [] };

/**
 * Replace every component whose owner module is reported not present with the
 * surface's placeholder (Constitution XVII; contract §7).
 *
 * **Every** component, first-party included — one rule rather than a carve-out
 * for the bundled set. A name that states no owner (one the block-name
 * migration left alone) is not something presence can answer and is left as it
 * is. Nothing is written anywhere: the stored node keeps its name and props.
 */
export function withPresence(
  config: Config,
  presence: BlockPresence,
  placeholder: (name: string, owner: string) => ComponentConfig,
): Config {
  if (presence.absent.length === 0) return config;
  const absent = new Set(presence.absent);
  const source = (config.components ?? {}) as Record<string, ComponentConfig>;
  let changed = false;
  const components: Record<string, ComponentConfig> = {};
  for (const [name, component] of Object.entries(source)) {
    const owner = ownerOf(name);
    if (owner !== null && absent.has(owner)) {
      components[name] = placeholder(name, owner);
      changed = true;
    } else {
      components[name] = component;
    }
  }
  return changed ? ({ ...config, components } as Config) : config;
}
