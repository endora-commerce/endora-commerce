import { isValidElement, type ReactElement } from 'react';

/**
 * Walks a React element tree *as returned by a component call* — without
 * rendering it — and collects every element the predicate accepts.
 *
 * The storefront harness is server-render only (no DOM), so an event handler
 * cannot be fired by a click. A test that calls a client component as a plain
 * function (its hooks mocked) gets the element tree it would hand to React;
 * this finds the `<button>`, `<form>` or `<dialog>` in it whose handler the
 * test then invokes directly. Nested component elements are not expanded:
 * their props — `children` and any element-valued prop such as `footer` —
 * are walked instead.
 */
export function findElements(
  node: unknown,
  accept: (el: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    if (accept(el)) found.push(el);
    for (const value of Object.values(el.props)) visit(value);
  };
  visit(node);
  return found;
}

/** The first element the predicate accepts; throws when there is none. */
export function findElement(
  node: unknown,
  accept: (el: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> {
  const [first] = findElements(node, accept);
  if (!first) throw new Error('element not found in the tree');
  return first;
}
