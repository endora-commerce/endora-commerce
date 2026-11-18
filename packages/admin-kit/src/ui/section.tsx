import { type ReactNode } from 'react';
import { EditorSection } from './editor-section.js';

/**
 * A titled content block: a heading, an optional action beside it, and the
 * caller's children. Mirrors the product-editor pattern where each tab panel is
 * a set of plain sections within a single card body (no nested cards).
 *
 * **Published by feature 091, P8.** It sat under `orders`' admin directory and
 * was rendered by `quote_requests`' RFQ detail as well as by three of `orders`'
 * own tabs — fourteen lines of `<section>`, `cn` and an `<h2>`, with nothing of
 * `orders` inside it. It is a layout primitive rather than a composite, so its
 * home is `./ui` and not `./components`.
 *
 * **Since issue #1437 (DS-03) it is `EditorSection` without its divider** — one
 * implementation of a section heading, not two. A new section uses
 * `EditorSection`, which adds the description line, the rule between sibling
 * sections, the heading level, the `chrome` choice and the region its heading labels.
 */
export interface SectionProps {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Section(props: SectionProps): ReactNode {
  return (
    <EditorSection
      title={props.title}
      action={props.action}
      divider={false}
      chrome="section"
      // Not a named region, as before #1437: its callers often sit inside a region they name.
      aria-labelledby={undefined}
      {...(props.className ? { className: props.className } : {})}
    >
      {props.children}
    </EditorSection>
  );
}
