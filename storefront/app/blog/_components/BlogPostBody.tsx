import { Render } from '@measured/puck';
import { defaultPageBuilderConfig } from '@b2b/cms-components';
import type { BlogContentEnvelope } from '@b2b/contracts';

/**
 * Renders the active-language tree from a blog Post's Page Builder
 * content envelope. The envelope is `{ schema_version, languages:
 * { [lang]: data } }` per the cmsContentEnvelopeSchema; we pick the
 * requested language with a channel-default fallback (the resolver
 * already applies its own fallback before this component runs).
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
