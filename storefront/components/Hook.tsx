import { Render } from '@measured/puck';
import { defaultPageBuilderConfig } from '@b2b/cms-components';
import type { ReactNode } from 'react';
import { getCmsHookByCode } from '../lib/api/cms';
import { getServerContext } from '../lib/server-context';

export async function Hook({ code }: { code: string }): Promise<ReactNode> {
  try {
    const { ctx } = await getServerContext();
    const hook = await getCmsHookByCode(code, ctx);
    if (!hook || hook.blocks.length === 0) return null;
    return (
      <>
        {hook.blocks.map((block) => (
          <Render
            key={block.id}
            config={defaultPageBuilderConfig}
            data={block.content.data as never}
          />
        ))}
      </>
    );
  } catch (err) {
    console.warn(`CMS Hook "${code}" failed to render.`, err);
    return null;
  }
}
