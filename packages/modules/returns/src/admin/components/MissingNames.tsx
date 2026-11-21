import type { ReactNode } from 'react';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { SupportedLanguage } from '@endora-commerce/contracts';
import { missingLanguages } from '../labels.js';

/**
 * A badge naming the shipped languages a reason or status has no name in, beside the
 * name the row shows — so a gap is seen in the list, not recalled from opening each
 * row (recognition over recall). Nothing when every language has one.
 */
export function MissingNames({ names }: { names: Readonly<Record<string, string>> | null | undefined }): ReactNode {
  const tr = useTranslation('returns');
  const missing = missingLanguages(names);
  if (missing.length === 0) return null;
  const languageName: Record<SupportedLanguage, string> = {
    en: tr('names.language.en'),
    pl: tr('names.language.pl'),
  };
  return (
    <Badge variant="outline">{tr('names.missing', { languages: missing.map((lang) => languageName[lang]).join(', ') })}</Badge>
  );
}
