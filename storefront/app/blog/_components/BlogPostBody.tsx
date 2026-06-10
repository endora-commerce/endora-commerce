'use client';

import { Render } from '@measured/puck';
import { defaultPageBuilderConfig } from '@b2b/cms-components';
import type { BlogContentEnvelope } from '@b2b/contracts';

/**
 * Renders the active-language tree from a blog Post's Page Builder
 * content envelope. The envelope is `{ schema_version, languages:
 * { [lang]: data } }` per the cmsContentEnvelopeSchema; we pick the
 * requested language with a channel-default fallback (the resolver
 * already applies its own fallback before this component runs).
 *
 * This is a Client Component on purpose: Puck's `<Render>` mounts a
 * `DropZone` that passes a `renderDropZone` function down to every
 * Page Builder component. The `RichContent`/`Text` blocks are
 * `'use client'` leaves, so when `<Render>` runs inside a Server
 * Component that function prop crosses the RSC boundary and React
 * aborts the server subtree ("Functions cannot be passed directly to
 * Client Components"). The server then falls back to an empty subtree
 * while the browser renders the full tree, producing a hydration
 * mismatch. Keeping the whole `<Render>` tree on the client (SSR +
 * hydration via the same client code path) avoids the boundary
 * crossing entirely.
 */
export function BlogPostBody({
  content,
  language,
}: {
  content: BlogContentEnvelope;
  language: string;
}) {
  const data =
    (content.languages[language] as never) ??
    (Object.values(content.languages)[0] as never);
  if (!data) return null;
  return <Render config={defaultPageBuilderConfig} data={data} />;
}
