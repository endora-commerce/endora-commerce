// `{name}`-style placeholder substitution — feature 019 / research §R2.
//
// Single-regex interpolation. Missing parameter names are left in place so
// the gap is visible in the rendered UI rather than silently elided.

export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    params[name] != null ? String(params[name]) : `{${name}}`,
  );
}
