export { EmailEditorPane, previewNode, type EmailEditorPaneProps, type EmailEmbedCodeOption, type EmailPreviewWidth } from './EmailEditorPane';
export {
  EmailVariablesProvider,
  useEmailVariables,
  type EmailVariableItem,
} from './EmailVariablesProvider';
export { EmailSubjectWithVariables } from './EmailVariableFields';
export {
  mergeEmailVariables,
  newsletterVariables,
  BRANDING_VARIABLES,
  NEWSLETTER_BASE_VARIABLES,
} from './newsletter-variables';
export { insertAtCursor, varSnippet } from './insert-at-cursor';
export { createEmailBuilderEditorPlugin } from './email-builder-plugin';
export {
  saveCanvasAsEmailTemplate,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
  codeFromTemplateName,
} from './email-template-layout';
