'use client';

import { Render } from '@measured/puck';
import { defaultPageBuilderConfig } from '@b2b/cms-components';

/**
 * Client-side wrapper around Puck's `<Render>`.
 *
 * Puck's `<Render>` mounts a `DropZone` that passes a `renderDropZone`
 * function prop down to every Page Builder component, including the
 * `'use client'` `RichContent`/`Text` leaves. When `<Render>` runs inside a
 * Server Component, that function prop crosses the RSC boundary and React
 * aborts the server render ("Functions cannot be passed directly to Client
 * Components"), then switches the subtree to client-only rendering — leaving
 * an empty server tree and producing a hydration mismatch.
 *
 * Keeping `<Render>` inside this Client Component boundary means the whole
 * Page Builder tree renders on the client (SSR + hydration via the same code
 * path), so the function prop never crosses an RSC boundary.
 */
export function PageBuilderRender({ data }: { data: unknown }) {
  return <Render config={defaultPageBuilderConfig} data={data as never} />;
}
