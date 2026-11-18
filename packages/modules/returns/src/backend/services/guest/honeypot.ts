/**
 * The honeypot of the guest forms (`specs/181-guest-complaints/` research R-8): an input
 * named `hp` that a person never sees or reaches; a bot that fills every input fills it
 * too. A hit is answered exactly as an accepted request, and nothing is stored or sent.
 *
 * `forms`' rule (`specs/170-forms-module/` FR-040), re-implemented here rather than
 * imported (Principle I): whitespace alone is not a hit, because some autofill leaves a
 * space in an input it could not place, and refusing a person for it is the worse mistake.
 */
export function isHoneypotHit(body: { readonly hp?: string | undefined }): boolean {
  return typeof body.hp === 'string' && body.hp.trim() !== '';
}
