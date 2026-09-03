// Pure content-tree walkers (feature 047) — mirror the CMS content-tree-walker
// for the email domain. Used to resolve block/template embeds before rendering
// and to validate references / collect asset ids.

interface UnknownNode {
  type?: unknown;
  props?: unknown;
}

/**
 * TipTap authoring JSON lives on EmailRichText.props.content and uses node/mark
 * types like `doc`, `paragraph`, `text`, `bold`. Those are not Puck components
 * and must not be flagged by {@link walkUnknownComponents}.
 */
const TIPTAP_NODE_OR_MARK_TYPES: ReadonlySet<string> = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'hardBreak',
  'horizontalRule',
  'blockquote',
  'codeBlock',
  'image',
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
]);

function walk(node: unknown, visit: (n: UnknownNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj['type'] === 'string') visit(obj as UnknownNode);
    // EmailRichText.props.content is TipTap JSON — do not treat it as nested Puck.
    if (obj['type'] === 'transactional_emails.EmailRichText') {
      const props = obj['props'];
      if (props && typeof props === 'object') {
        for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
          if (key === 'content') continue;
          if (value && typeof value === 'object') walk(value, visit);
        }
      }
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'type' || key === 'props') continue;
        if (value && typeof value === 'object') walk(value, visit);
      }
      return;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') walk(value, visit);
    }
  }
}

function collectEmbedCodes(tree: unknown, typeName: string): Set<string> {
  const codes = new Set<string>();
  walk(tree, (n) => {
    if (n.type === typeName && n.props && typeof n.props === 'object') {
      const code = (n.props as Record<string, unknown>)['code'];
      if (typeof code === 'string' && code.length > 0) codes.add(code);
    }
  });
  return codes;
}

export function walkBlockEmbeds(tree: unknown): Set<string> {
  return collectEmbedCodes(tree, 'transactional_emails.EmailInsertBlock');
}

export function walkTemplateEmbeds(tree: unknown): Set<string> {
  return collectEmbedCodes(tree, 'transactional_emails.EmailInsertTemplate');
}

/** Component type names present in the tree that are not in `knownNames`. */
export function walkUnknownComponents(tree: unknown, knownNames: ReadonlySet<string>): Set<string> {
  const unknown = new Set<string>();
  walk(tree, (n) => {
    if (typeof n.type !== 'string') return;
    if (TIPTAP_NODE_OR_MARK_TYPES.has(n.type)) return;
    if (!knownNames.has(n.type)) unknown.add(n.type);
  });
  return unknown;
}

/** Asset ids referenced anywhere in the tree (props whose key ends in `assetId`). */
export function walkAssetIds(tree: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (/assetId$/i.test(key) && typeof value === 'string' && value.length > 0) ids.add(value);
        else if (value && typeof value === 'object') visit(value);
      }
    }
  };
  visit(tree);
  return ids;
}
