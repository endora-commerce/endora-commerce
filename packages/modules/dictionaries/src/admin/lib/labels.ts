import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';
import type { Region, SymbolPosition } from '@endora-commerce/contracts';

/**
 * The dictionary screen's code vocabularies (issue #1434's rule, applied by
 * issue #1456): a region and a symbol position arrive as codes and an operator
 * reads their labels in their own language.
 */
export const regionLabels = defineEnumLabels<Region>({
  Africa: 'region.Africa',
  Americas: 'region.Americas',
  Asia: 'region.Asia',
  Europe: 'region.Europe',
  Oceania: 'region.Oceania',
  Antarctic: 'region.Antarctic',
});

export const symbolPositionLabels = defineEnumLabels<SymbolPosition>({
  prefix: 'symbolPosition.prefix',
  suffix: 'symbolPosition.suffix',
});
