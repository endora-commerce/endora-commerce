import { isValidElement, type ReactNode } from 'react';

/**
 * The server actions a page hands to its own JSX, found by walking the element
 * tree the page returned (issue #745). A page file may not export its actions,
 * so a test reaches one where the page passes it — a form's `action`, a
 * component's `removeAction` — without rendering anything.
 */
export function actionsOf(tree: unknown): Map<string, (...args: never[]) => unknown> {
  const found = new Map<string, (...args: never[]) => unknown>();
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isValidElement(node)) return;
    const props = node.props as Record<string, unknown>;
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'function' && (key === 'action' || key === 'formAction' || /Action$/.test(key))) {
        const name = (value as { name?: string }).name || key;
        if (!found.has(name)) found.set(name, value as (...args: never[]) => unknown);
      } else if (key === 'children' || isValidElement(value) || Array.isArray(value)) {
        visit(value as ReactNode);
      }
    }
  };
  visit(tree);
  return found;
}

/** What an action redirected to, through a `localeRedirect` mock that throws `redirect <to>`. */
export async function redirectOf(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith('redirect ')) return message.slice('redirect '.length);
    throw err;
  }
  throw new Error('expected the action to redirect');
}

/** A `FormData` from plain fields. */
export function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}
