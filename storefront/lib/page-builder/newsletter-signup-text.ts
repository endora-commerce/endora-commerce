import type { CmsNewsletterSignupText } from '@endora-commerce/cms-components/components/render-context';
import { tForLocale } from '../i18n/messages';

/**
 * The words `newsletter.Signup` shows that the block's own props may leave
 * unset, in the page's language (feature 169, US7, data-model §5.4): the
 * message for a required subscriber attribute left empty. `CmsPageRenderer`
 * hands these to the render context; the block falls back to English without
 * them. A language the catalogue does not carry reads English.
 */
export function newsletterSignupText(language: string): CmsNewsletterSignupText {
  const t = tForLocale(language);
  return { fields: t('newsletter.signup.fields') };
}
