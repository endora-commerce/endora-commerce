/** Resolve Puck's sortable wrapper for a component id (`data-puck-dnd`). */
export function resolvePuckDndElement(componentId: string): HTMLElement | null {
  const preview = document.querySelector('[data-puck-preview]');
  const iframe = preview?.querySelector('iframe');
  const roots: ParentNode[] = [];
  if (iframe?.contentDocument?.body) {
    roots.push(iframe.contentDocument);
  }
  if (preview) roots.push(preview);
  roots.push(document);

  for (const root of roots) {
    const el = root.querySelector(`[data-puck-dnd="${CSS.escape(componentId)}"]`);
    if (el instanceof HTMLElement && !el.hasAttribute('data-puck-disabled')) {
      return el;
    }
  }
  return null;
}
