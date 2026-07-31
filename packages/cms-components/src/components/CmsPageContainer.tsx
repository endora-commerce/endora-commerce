'use client';

import type { ReactElement, ReactNode } from 'react';
import type { Config } from '@measured/puck';

/** Matches the storefront shell (`max-w-[1360px] px-[24px]`). */
export const CMS_PAGE_MAX_WIDTH_PX = 1360;
export const CMS_PAGE_HORIZONTAL_PADDING_PX = 24;

export function CmsPageContainer({ children }: { children: ReactNode }): ReactElement {
  return <div className="cmsc-pb-page">{children}</div>;
}

/** Puck root wrapper — use for CMS pages only, not blocks/templates. */
export const cmsPageRootConfig: NonNullable<Config['root']> = {
  render: ({ children }: { children: ReactNode }) => (
    <CmsPageContainer>{children}</CmsPageContainer>
  ),
};

export function withCmsPageRoot(config: Config): Config {
  return {
    ...config,
    root: cmsPageRootConfig,
  };
}
