import type { ReactNode } from 'react';
import type { CmsResolvedBlockByCode } from '@endora-commerce/contracts';
import { toAbsoluteAssetMap } from '../lib/asset-url';
import { publicApiBaseUrl } from '../lib/env.mjs';
import { CmsAssetScope } from './CmsAssetScope';
import { PageBuilderRender } from './PageBuilderRender';

/** A block fetched by its code and rendered on its own, with the assets it embeds. */
export function CmsStandaloneBlock({ block }: { block: CmsResolvedBlockByCode }): ReactNode {
  return (
    <CmsAssetScope assets={toAbsoluteAssetMap(block.assets)} mediaBaseUrl={publicApiBaseUrl().replace(/\/+$/, '')}>
      <PageBuilderRender data={block.content.data} />
    </CmsAssetScope>
  );
}
