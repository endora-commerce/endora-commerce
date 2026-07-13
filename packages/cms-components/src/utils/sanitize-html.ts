const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

function stripScripts(html: string): string {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

/**
 * Minimal allowlist HTML sanitizer — no external dependency.
 * Strips script tags and disallowed elements/attributes.
 */
export function sanitizeHtml(html: string, enabled = true): string {
  if (!enabled) return stripScripts(html);
  if (typeof DOMParser === 'undefined') return stripScripts(html);

  const doc = new DOMParser().parseFromString(stripScripts(html), 'text/html');
  const walk = (node: Node): void => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      const allowed = ALLOWED_ATTRS[tag];
      for (const attr of [...el.attributes]) {
        if (!allowed?.has(attr.name.toLowerCase())) {
          el.removeAttribute(attr.name);
        }
      }
      if (tag === 'a' && el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noreferrer noopener');
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
