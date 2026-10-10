import type { ReactNode } from 'react';
import { getCmsHookByCode } from '../lib/api/cms';
import { getServerContext } from '../lib/server-context';
import { CatalogBlockData } from './CatalogBlockData';
import { PageBuilderRender } from './PageBuilderRender';

export async function Hook({ code }: { code: string }): Promise<ReactNode> {
  try {
    const { ctx } = await getServerContext();
    const hook = await getCmsHookByCode(code, ctx);
    if (!hook || hook.blocks.length === 0) return null;
    return (
      <CatalogBlockData ctx={ctx} documents={hook.blocks.map((block) => block.content.data)}>
        {hook.blocks.map((block) => (
          <PageBuilderRender key={block.id} data={block.content.data} />
        ))}
      </CatalogBlockData>
    );
  } catch (err) {
    console.warn(`CMS Hook "${code}" failed to render.`, err);
    return null;
  }
}
