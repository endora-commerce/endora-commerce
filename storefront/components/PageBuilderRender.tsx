'use client';

import { Render } from '@measured/puck';
import type { CSSProperties, ReactNode } from 'react';
import { breakpointCssVars, type PageBuilderBreakpoints } from '@b2b/page-builder-core';
import { defaultPageBuilderConfig, withCmsPageRoot } from '@b2b/cms-components';

export function PageBuilderBreakpointProvider({
  breakpoints,
  children,
  style,
}: {
  breakpoints?: PageBuilderBreakpoints;
  children: ReactNode;
  style?: CSSProperties;
}): ReactNode {
  return (
    <div style={{ ...breakpointCssVars(breakpoints), ...style }}>
      {children}
    </div>
  );
}

/**
 * Client-side wrapper around Puck's `<Render>`.
 *
 * Puck's `<Render>` mounts slot renderers that pass function props down to
 * every Page Builder component, including the `'use client'` `RichContent`/`Text`
 * leaves. When `<Render>` runs inside a Server Component, that function prop
 * crosses the RSC boundary and React aborts the server render.
 *
 * Keeping `<Render>` inside this Client Component boundary means the whole
 * Page Builder tree renders on the client (SSR + hydration via the same code
 * path), so the function prop never crosses an RSC boundary.
 */
export function PageBuilderRender({
  data,
  breakpoints,
  pageContainer = false,
}: {
  data: unknown;
  breakpoints?: PageBuilderBreakpoints;
  /** Wrap content in the CMS page max-width shell (storefront pages only). */
  pageContainer?: boolean;
}) {
  const config = pageContainer ? withCmsPageRoot(defaultPageBuilderConfig) : defaultPageBuilderConfig;

  return (
    <PageBuilderBreakpointProvider {...(breakpoints === undefined ? {} : { breakpoints })}>
      <Render config={config} data={data as never} />
    </PageBuilderBreakpointProvider>
  );
}
