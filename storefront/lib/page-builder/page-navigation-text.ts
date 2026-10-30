import type { CmsPageNavigationText } from '@endora-commerce/cms-components/components/render-context';
import { tForLocale } from '../i18n/messages';

/**
 * The page navigation's words in the page's language (feature 169, US5): the
 * accessible name of a `cms.PageNavigation` that sets none. `cms-components`
 * has no translation layer; `CmsPageRenderer` hands these to the render
 * context. A language the catalogue does not carry reads English, as
 * `tForLocale` does.
 */
export function pageNavigationText(language: string): CmsPageNavigationText {
  const t = tForLocale(language);
  return { label: t('cms.pageNavigation.label') };
}
