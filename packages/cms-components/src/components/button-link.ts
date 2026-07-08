import type { ButtonLinkType } from '../schema/component-types.js';

export function resolveButtonHref(props: {
  linkType?: ButtonLinkType;
  linkSlug?: string | undefined;
  href?: string | undefined;
}): string {
  const slug = props.linkSlug?.trim() ?? '';
  switch (props.linkType) {
    case 'product':
      return slug ? `/p/${encodeURIComponent(slug)}` : '#';
    case 'category':
      return slug ? `/c/${encodeURIComponent(slug)}` : '#';
    case 'page':
      return slug ? `/${slug.replace(/^\//, '')}` : '#';
    case 'url':
    default:
      return props.href?.trim() || '#';
  }
}
