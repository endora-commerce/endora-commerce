import type { ReactNode } from 'react';
import { EmailFragmentEditor } from './EmailFragmentEditor.js';

/**
 * `/transactional-emails/templates/:id` — the same fragment editor, opened on a
 * **template** (feature 047 US3; feature 091, Phase 4, batch 11).
 *
 * The sibling of `EmailBlockEditorPage`, and separate from it for the same
 * reason: the two routes differ only in the `kind` the host used to pass, and a
 * contribution declaration carries no props.
 */
export function EmailTemplateEditorPage(): ReactNode {
  return <EmailFragmentEditor kind="template" />;
}

export default EmailTemplateEditorPage;
