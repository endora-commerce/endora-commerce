import type { ReactNode } from 'react';
import { EmailFragmentEditor } from './EmailFragmentEditor.js';

/**
 * `/transactional-emails/blocks/:id` — the fragment editor, opened on a
 * **block** (feature 047 US3; feature 091, Phase 4, batch 11).
 *
 * A file rather than a prop on the declaration, for `CredentialsNewPage`'s
 * reason (batch 10): `AdminRouteDeclaration.component` is a factory returning a
 * module and reads its `default`, so there is nowhere in the declaration to put
 * an argument, and adding one would be a props channel the registry has to
 * interpret for every module. `App.tsx` wrote
 * `element={<EmailFragmentEditor kind="block" />}` here — the same two lines,
 * with the host holding them.
 */
export function EmailBlockEditorPage(): ReactNode {
  return <EmailFragmentEditor kind="block" />;
}

export default EmailBlockEditorPage;
