import axe from 'axe-core';

/**
 * Runs axe-core's WCAG 2.0 / 2.1 / 2.2 A and AA rules over `container` and
 * fails with every violation's rule id and target selectors (feature 147,
 * SC-002 — an automated accessibility check of each open dialog).
 *
 * `color-contrast` is disabled because jsdom lays nothing out and computes no
 * colours, so the rule can only report "incomplete" or a false result there
 * (`specs/147-saved-views/research.md` R-13). Contrast is argued from the
 * theme tokens the components use, not measured here.
 */
export async function expectNoAxeViolations(
  container: Element,
  options: {
    /**
     * `false` for a subtree holding an `<iframe>` (the e-mail preview): jsdom's
     * frames are not windows axe can message, so it would throw instead of
     * checking. The frame's own `title` is still checked from outside.
     */
    iframes?: boolean;
  } = {},
): Promise<void> {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
    ...(options.iframes === false ? { iframes: false } : {}),
  });
  if (result.violations.length === 0) return;
  const lines = result.violations.map((violation) => {
    const targets = violation.nodes.map((node) => node.target.join(' ')).join(', ');
    return `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help} — ${targets}`;
  });
  throw new Error(`axe found ${result.violations.length} violation(s):\n${lines.join('\n')}`);
}
