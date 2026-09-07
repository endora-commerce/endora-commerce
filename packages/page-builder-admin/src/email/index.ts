/**
 * `@endora-commerce/page-builder-admin/email` — the e-mail builder: the editor
 * pane, its variable provider and fields, the row-layout picker, the rich-text
 * field, the action bar and the template save/apply operations.
 *
 * It lived in `admin/src/modules/_shared/email-builder/`, a directory the admin
 * application owned and no module did — which is what made it invisible to every
 * instrument in the estate: `check:admin-surface` attributes ownership from the
 * route table and the nav, and `_shared` is claimed by neither, so eighteen
 * cross-directory reaches sat in no ledger and drained without anybody
 * reporting it (`admin-component-contribution.md` Z1.2).
 *
 * The twelve reaches **out** of it are not now unwatched; they are impossible.
 * `@/` is a Vite and `tsc` alias a package cannot resolve, so this package's own
 * type-check refuses one — a stronger instrument than a ledger, and one nobody
 * has to remember. The six reaches **in** are bare specifiers into a published
 * `exports` map, which is what a package split *produces* rather than a coupling
 * it breaks.
 *
 * Both remaining pieces of module knowledge take the **client exit**: the
 * template operations and the branding read are rebuilt on `apiClient` over
 * `@endora-commerce/contracts` types in `email-templates-api.ts`, and the colour
 * palette in the chrome's `cms-page-builder-api.ts`. `newsletterVariables` took
 * the third exit and lives in `newsletter`, its only consumer.
 */
export {
  EmailEditorPane,
  previewNode,
  type EmailEditorPaneProps,
  type EmailEmbedCodeOption,
  type EmailPreviewWidth,
} from './EmailEditorPane.js';
export {
  EmailVariablesProvider,
  useEmailVariables,
  type EmailVariableItem,
} from './EmailVariablesProvider.js';
export { EmailSubjectWithVariables } from './EmailVariableFields.js';
export { BRANDING_VARIABLES, mergeEmailVariables } from './variables.js';
export { insertAtCursor, varSnippet } from './insert-at-cursor.js';
export { createEmailBuilderEditorPlugin } from './email-builder-plugin.js';
export {
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
  saveCanvasAsEmailTemplate,
} from './email-template-layout.js';
