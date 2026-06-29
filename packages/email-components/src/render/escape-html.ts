// HTML escaping for email rendering (feature 047).
//
// Note: `{` and `}` are intentionally NOT escaped — the directive engine runs
// over the rendered HTML string AFTER component rendering, so `{{var ...}}`
// markers authored inside text must survive escaping. Variable *values* are
// escaped by the directive engine when injected into HTML output.

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

/** Escape a value for use inside a double-quoted HTML attribute. */
export function escapeAttr(input: string): string {
  return escapeHtml(input);
}
