// Feature 047 — the shape an organizations email takes when it routes through
// the admin-editable transactional template, and the no-op that makes the
// caller fall back to its legacy in-code builder.
//
// The implementation left in T120: it was pure sender-plus-channel logic, so it
// belongs to `transactional_emails`, which offers it as `templateEmailPort`.
// What stays here is the *shape this module needs*, declared locally so
// resolving the port crosses no boundary — the port pattern, rather than an
// import of another module's helper.

export interface OrgTemplateEmail {
  /**
   * `true` means "handled — do not use the legacy in-code builder", which
   * includes an email the operator deactivated: off must stay off rather than
   * silently degrade to the in-code version. Only a code with no definition at
   * all answers `false`.
   */
  trySend(input: {
    code: string;
    to: string;
    messageId: string;
    variables: Record<string, unknown>;
    meta?: Record<string, unknown> | undefined;
  }): Promise<boolean>;
}

/** No-op helper (sender not wired) — always falls back to the legacy builder. */
export const noopOrgTemplateEmail: OrgTemplateEmail = {
  async trySend(): Promise<boolean> {
    return false;
  },
};
