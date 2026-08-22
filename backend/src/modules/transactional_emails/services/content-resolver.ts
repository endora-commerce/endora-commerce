/**
 * Content resolver — feature 047 (R5/US1/US2).
 *
 * Resolves the effective subject + content for an email definition at a given
 * scope and language: per-channel override -> global override -> module default,
 * each with a language fallback to the channel default language.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';
import type { TransactionalEmail } from '../entities/transactional-email.entity.js';
import { TransactionalEmailContent } from '../entities/transactional-email-content.entity.js';

export type ContentSource = 'channel' | 'global' | 'default';

export interface ResolvedContent {
  subject: string;
  content: PuckDataTree;
  source: ContentSource;
  version: number | null;
  language: string;
}

export interface ResolveOptions {
  salesChannelId: string | null;
  language: string;
  /** Fallback language when the requested language has no content. */
  fallbackLanguage?: string;
}

function envelopeTree(envelope: unknown, language: string): PuckDataTree | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const langs = (envelope as { languages?: Record<string, unknown> }).languages;
  if (!langs || typeof langs !== 'object') return null;
  const tree = langs[language];
  return tree && typeof tree === 'object' ? (tree as PuckDataTree) : null;
}

function defaultSubject(email: TransactionalEmail, language: string, fallback?: string): string {
  const map = email.defaultSubject ?? {};
  return map[language] ?? (fallback ? map[fallback] : undefined) ?? Object.values(map)[0] ?? '';
}

function defaultContent(email: TransactionalEmail, language: string, fallback?: string): PuckDataTree {
  return (
    envelopeTree(email.defaultContent, language) ??
    (fallback ? envelopeTree(email.defaultContent, fallback) : null) ??
    { root: { props: {} }, content: [] }
  );
}

export class ContentResolver {
  async resolve(
    em: EntityManager,
    email: TransactionalEmail,
    opts: ResolveOptions,
  ): Promise<ResolvedContent> {
    const langs = [opts.language, ...(opts.fallbackLanguage ? [opts.fallbackLanguage] : [])];

    // 1. Per-channel override (requested language, then fallback language).
    if (opts.salesChannelId) {
      for (const lang of langs) {
        const row = await em.findOne(TransactionalEmailContent, {
          emailId: email.id,
          salesChannelId: opts.salesChannelId,
          language: lang,
        });
        if (row) {
          return { subject: row.subject, content: row.content as PuckDataTree, source: 'channel', version: row.version, language: lang };
        }
      }
    }

    // 2. Global override (requested language, then fallback language).
    for (const lang of langs) {
      const row = await em.findOne(TransactionalEmailContent, {
        emailId: email.id,
        salesChannelId: null,
        language: lang,
      });
      if (row) {
        return { subject: row.subject, content: row.content as PuckDataTree, source: 'global', version: row.version, language: lang };
      }
    }

    // 3. Module default.
    return {
      subject: defaultSubject(email, opts.language, opts.fallbackLanguage),
      content: defaultContent(email, opts.language, opts.fallbackLanguage),
      source: 'default',
      version: null,
      language: opts.language,
    };
  }
}
