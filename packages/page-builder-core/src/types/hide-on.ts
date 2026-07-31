import type { HideOn } from './responsive.js';
import type { PageBuilderEditorProps } from './editor-chrome.js';

export type HideOnProps = PageBuilderEditorProps & {
  hideOn?: HideOn;
};
