import type { CmsContactFormText } from '@endora-commerce/cms-components/components/render-context';
import { tForLocale } from '../i18n/messages';

/**
 * The default words of the `cms.ContactForm` block in the page's language (feature 169,
 * `specs/169-page-builder-contact-form/` data-model §5.4). `cms-components` has no translation
 * layer; `CmsPageRenderer` hands these to the render context, and the block reads them wherever
 * the editor wrote none of its own. A language the catalogue does not carry reads English, as
 * `tForLocale` does.
 */
export function cmsContactFormText(language: string): CmsContactFormText {
  const t = tForLocale(language);
  return {
    label: t('cms.contactForm.label'),
    field: {
      name: t('cms.contactForm.field.name'),
      email: t('cms.contactForm.field.email'),
      phone: t('cms.contactForm.field.phone'),
      company: t('cms.contactForm.field.company'),
      subject: t('cms.contactForm.field.subject'),
      choice: t('cms.contactForm.field.choice'),
      message: t('cms.contactForm.field.message'),
    },
    choicePlaceholder: t('cms.contactForm.choicePlaceholder'),
    privacyConsent: t('cms.contactForm.privacyConsent'),
    marketingConsent: t('cms.contactForm.marketingConsent'),
    submit: t('cms.contactForm.submit'),
    success: t('cms.contactForm.message.success'),
    error: t('cms.contactForm.message.error'),
    unavailable: t('cms.contactForm.message.unavailable'),
    required: t('cms.contactForm.required'),
    fieldRequired: t('cms.contactForm.fieldRequired'),
    fieldEmail: t('cms.contactForm.fieldEmail'),
  };
}
