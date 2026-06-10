import type { ReactNode } from 'react';
import { getCmsHookByCode } from '../lib/api/cms';
import { getServerContext } from '../lib/server-context';
import { PageBuilderRender } from './PageBuilderRender';

export async function Hook({ code }: { code: string }): Promise<ReactNode> {
  try {
    const { ctx } = await getServerContext();
    const hook = await getCmsHookByCode(code, ctx);
    if (!hook || hook.blocks.length === 0) return null;
    return (
      <>
        {hook.blocks.map((block) => (
          <PageBuilderRender key={block.id} data={block.content.data} />
        ))}
      </>
    );
  } catch (err) {
    console.warn(`CMS Hook "${code}" failed to render.`, err);
    return null;
  }
}
