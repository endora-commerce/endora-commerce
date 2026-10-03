'use client';

import { Render } from '@puckeditor/core';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { breakpointCssVars, type PageBuilderBreakpoints } from '@endora-commerce/page-builder-core';
import {
  BlockRenderEnvironmentProvider,
  type BlockPresence,
} from '@endora-commerce/page-builder-core/contributions';
import { storefrontPageBuilderConfig } from '../lib/page-builder/config';
import { useBlockRenderScope } from './BlockRenderScope';
import '@endora-commerce/cms-components/styles.css';

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

/** `?cms_admin=1`, the storefront's preview switch. Read after mount, never during render. */
function usePreviewParameter(initial: boolean): boolean {
  const [preview, setPreview] = useState(initial);
  useEffect(() => {
    if (/(?:^|[?&])cms_admin=1(?:&|$)/.test(window.location.search)) setPreview(true);
  }, []);
  return preview;
}

/**
 * Client-side wrapper around Puck's `<Render>` — the one place this storefront
 * mounts it.
 *
 * Puck's `<Render>` mounts slot renderers that pass function props down to
 * every Page Builder component, including the `'use client'` `RichContent`/`Text`
 * leaves. When `<Render>` runs inside a Server Component, that function prop
 * crosses the RSC boundary and React aborts the server render.
 *
 * Keeping `<Render>` inside this Client Component boundary means the whole
 * Page Builder tree renders on the client (SSR + hydration via the same code
 * path), so the function prop never crosses an RSC boundary. It is also what
 * makes a module package's storefront layer usable at all: those renderers are
 * statically imported by this boundary (`lib/page-builder/config.ts`), render
 * once on the server and once on hydration, and are part of the server-rendered
 * HTML (Principle VII).
 *
 * **Presence is required, from the scope or from the caller.** A render site
 * with neither throws rather than rendering every block: "nobody told me who is
 * absent" must not look the same as "nobody is absent", or a switched-off
 * module's block would reach customers from the one site somebody forgot.
 */
export function PageBuilderRender({
  data,
  breakpoints,
  pageContainer = false,
  presence: presenceProp,
  language: languageProp,
  preview: previewProp = false,
}: {
  data: unknown;
  breakpoints?: PageBuilderBreakpoints;
  /** Wrap content in the CMS page max-width shell (storefront pages only). */
  pageContainer?: boolean;
  /** Overrides the scope's. Serialisable: it crosses from a Server Component. */
  presence?: BlockPresence;
  /** The content language of this tree, when it differs from the scope's. */
  language?: string;
  /** Show the missing-renderer note for a block nothing draws. `?cms_admin=1` sets it too. */
  preview?: boolean;
}) {
  const scope = useBlockRenderScope();
  const presence = presenceProp ?? scope?.presence;
  if (presence === undefined) {
    throw new Error(
      'PageBuilderRender was rendered with no <BlockRenderScope> above it and no `presence` of ' +
        'its own. The root layout mounts the scope with what getServerContext() resolved; a ' +
        'render site outside it must pass `presence` (blockPresenceOf(modules)). Rendering every ' +
        'block instead would let a switched-off module reach customers from this one site.',
    );
  }
  const language = languageProp ?? scope?.language ?? 'en';
  const preview = usePreviewParameter(previewProp);

  const absentKey = presence.absent.join(',');
  const config = useMemo(
    () =>
      storefrontPageBuilderConfig({
        presence: { absent: absentKey === '' ? [] : absentKey.split(',') },
        pageContainer,
        preview,
      }),
    [absentKey, pageContainer, preview],
  );
  const environment = useMemo(() => ({ language, preview }), [language, preview]);

  return (
    <PageBuilderBreakpointProvider {...(breakpoints === undefined ? {} : { breakpoints })}>
      <BlockRenderEnvironmentProvider value={environment}>
        <Render config={config} data={data as never} />
      </BlockRenderEnvironmentProvider>
    </PageBuilderBreakpointProvider>
  );
}
