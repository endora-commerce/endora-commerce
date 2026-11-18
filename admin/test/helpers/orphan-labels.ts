/**
 * Every `<label>` under `container` that names no control: it has no `for`
 * pointing at an element, and wraps no form control (issue #1465, UX audit
 * CONTENT-07). Such a label looks like one and is read as plain text — the
 * field beside it stays anonymous (WCAG 2.2 SC 1.3.1, 4.1.2).
 */
export function orphanLabels(container: Element): string[] {
  const controls = 'input, select, textarea, button, [role="combobox"], [role="checkbox"], [role="switch"]';
  return Array.from(container.querySelectorAll('label'))
    .filter((label) => {
      const target = label.htmlFor ? container.ownerDocument.getElementById(label.htmlFor) : null;
      return target === null && label.querySelector(controls) === null;
    })
    .map((label) => label.textContent?.trim() ?? '');
}
