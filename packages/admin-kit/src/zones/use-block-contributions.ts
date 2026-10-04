/**
 * The one reader of the editor renderers modules contribute for their Page
 * Builder blocks (`specs/141-module-block-renderers/contracts/block-renderers.md`
 * §5.1).
 *
 * The rules are `useAdminZone`'s, for its reasons. **The registry does not
 * filter; this does, at enumeration**, through the one visibility predicate —
 * so an operator's activation flip takes effect without a rebuild. **No factory
 * is evaluated here**: the editor that wants a renderer calls it, so a module's
 * editor chunk is fetched only for a block that editor is about to compose.
 *
 * One rule is this reader's own. A block name states its owner
 * (`<module>.<Name>`), and `module` is the registry entry's key rather than a
 * declared field (D-142) — so a contribution whose name another module owns is
 * dropped. `check:block-renderers` refuses it before publication; this is the
 * same refusal for a package that was installed anyway.
 */
import { useMemo } from 'react';
import { blockNameRe } from '@endora-commerce/contracts';

import { useSurfaceVisibility, type GatedSurface } from '../lib/surface-visibility.js';
import {
  useAdminBlockContributions,
  type OwnedBlockContribution,
} from './AdminContributionsProvider.js';

/** The editors a module may contribute a renderer for. */
export type BlockContributionContext = OwnedBlockContribution['context'];

/** The selection, as a pure function of the registry and the predicate. */
export function selectBlockContributions(
  contributions: readonly OwnedBlockContribution[],
  context: BlockContributionContext,
  isVisible: (surface: GatedSurface) => boolean,
): readonly OwnedBlockContribution[] {
  return contributions
    .filter((contribution) => contribution.context === context)
    .filter(
      (contribution) =>
        blockNameRe.test(contribution.name) &&
        contribution.name.slice(0, contribution.name.indexOf('.')) === contribution.module,
    )
    .filter((contribution) => isVisible({ module: contribution.module }));
}

/** The present modules' editor renderers for one editor, in registry order. */
export function useBlockContributions(
  context: BlockContributionContext,
): readonly OwnedBlockContribution[] {
  const contributions = useAdminBlockContributions();
  const isVisible = useSurfaceVisibility();
  return useMemo(
    () => selectBlockContributions(contributions, context, isVisible),
    [contributions, context, isVisible],
  );
}
