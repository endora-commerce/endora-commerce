/**
 * The honeypot (`specs/170-forms-module/` FR-040, research R-15). The block renders an input named
 * `hp_extra` that a person never sees or reaches (visually hidden, `aria-hidden`, `tabindex="-1"`,
 * `autocomplete="off"`); a bot that fills every input fills it too. A hit is answered exactly as an
 * accepted submission, and nothing is stored, sent or published.
 *
 * Whitespace alone is not a hit: some autofill implementations leave a space in an input they could
 * not place, and refusing a person for it would be the worse mistake.
 */
export function isHoneypotHit(body: { readonly hp?: string | undefined }): boolean {
  return typeof body.hp === 'string' && body.hp.trim() !== '';
}
