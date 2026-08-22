import type { CmsBlockSeedPort, CmsContentEnvelope } from '@endora-commerce/contracts';
import { effectiveState } from '../../../kernel/lifecycle/effective-state.js';

/**
 * Seeds a predefined **CMS block** `newsletter_consent` (feature 048) that the
 * storefront registration page renders as the newsletter-consent checkbox
 * label. The block links to the Privacy Policy CMS page (`/privacy-policy`).
 *
 * CMS blocks resolve per sales channel (they require a channel binding), and
 * the system-default channel is created at boot rather than by migration, so
 * this runs as an idempotent boot-time seed — the block is inserted once and
 * bound to any channel not yet bound.
 *
 * **The text is this module's; the storage is `cms`'.** Until feature 075 this
 * file wrote `cms_blocks` and `cms_block_sales_channels` itself, in raw SQL —
 * two ledgered reaches per table that named no import specifier, so the
 * boundary they crossed compiled and returned rows (D-87). It hands `cms` a
 * descriptor now and owns none of the writing.
 */
export const NEWSLETTER_CONSENT_BLOCK_CODE = 'newsletter_consent';

const LANGUAGES = ['en-US', 'pl-PL'];

function tree(html: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [{ type: 'Text', props: { id: 'consent', tiptapContent: null, html } }],
    zones: {},
  };
}

const CONTENT_ENVELOPE: CmsContentEnvelope = {
  schema_version: 1,
  languages: {
    'en-US': tree(
      '<p>Yes, I would like to receive the newsletter and marketing emails. ' +
        'I have read the <a href="/privacy-policy">Privacy Policy</a>.</p>',
    ),
    'pl-PL': tree(
      '<p>Tak, chcę otrzymywać newsletter i wiadomości marketingowe. ' +
        'Zapoznałem(-am) się z <a href="/privacy-policy">Polityką prywatności</a>.</p>',
    ),
  },
};

/**
 * What the seed did, so `cms` being off is an **answer** rather than an
 * exception somebody has to catch.
 *
 * `cms-absent` is the operator having switched the CMS off, or a deployment
 * shipping without it. It costs nothing that is not recovered: deactivation
 * drops no rows, so a block seeded earlier is still there, and the first boot
 * after `cms` comes back binds it to whatever channels appeared meanwhile.
 */
export type ConsentBlockSeedOutcome = 'seeded' | 'cms-absent';

export async function ensureNewsletterConsentBlock(
  blocks: CmsBlockSeedPort,
): Promise<ConsentBlockSeedOutcome> {
  // First, and outside any `try`: a closed gate throws rather than answering,
  // so asking after the call is asking too late — and this call happens at
  // route registration, where a `ModuleDisabledError` has nowhere to go but
  // into a failed start. An operator switching `cms` off must not stop
  // `newsletter` starting (Constitution XVII).
  if (!effectiveState.isPresent('cms')) return 'cms-absent';
  await blocks.ensureSeededBlock({
    code: NEWSLETTER_CONSENT_BLOCK_CODE,
    name: 'Newsletter consent',
    languages: LANGUAGES,
    content: CONTENT_ENVELOPE,
  });
  return 'seeded';
}
