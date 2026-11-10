import type { ReactNode } from 'react';
import { getCmsHookByCode } from '../lib/api/cms';
import { toAbsoluteAssetMap } from '../lib/asset-url';
import { publicApiBaseUrl } from '../lib/env.mjs';
import { getServerContext } from '../lib/server-context';
import { BlockData } from './BlockData';
import { CmsAssetScope } from './CmsAssetScope';
import { PageBuilderRender } from './PageBuilderRender';

export async function Hook({ code }: { code: string }): Promise<ReactNode> {
  try {
    const { ctx, modules } = await getServerContext();
    const hook = await getCmsHookByCode(code, ctx);
    if (!hook || hook.blocks.length === 0) return null;
    return (
      <CmsAssetScope assets={toAbsoluteAssetMap(hook.assets)} mediaBaseUrl={publicApiBaseUrl().replace(/\/+$/, '')}>
        <BlockData ctx={ctx} modules={modules} documents={hook.blocks.map((block) => block.content.data)}>
          {hook.blocks.map((block) => (
            <PageBuilderRender key={block.id} data={block.content.data} />
          ))}
        </BlockData>
      </CmsAssetScope>
    );
  } catch (err) {
    console.warn(`CMS Hook "${code}" failed to render.`, err);
    return null;
  }
}
