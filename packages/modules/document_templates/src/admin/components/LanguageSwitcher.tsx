import { useId, type ReactNode } from 'react';
import { Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The language being edited (FR-014). Hidden for a type printed in one
 * language only (invoices, owner answer N5). Choosing a language the template
 * does not hold yet offers to start it as a copy of the current one.
 */
export interface LanguageSwitcherProps {
  readonly languages: readonly string[];
  readonly current: string;
  /** Languages the template holds a layout for. */
  readonly stored: readonly string[];
  /** The language a new one would be copied from; `null` when there is none to copy. */
  readonly copyFrom: string | null;
  readonly onSelect: (language: string) => void;
  readonly onStart: (language: string) => void;
}

export function LanguageSwitcher(props: LanguageSwitcherProps): ReactNode {
  const { languages, current, stored, copyFrom, onSelect, onStart } = props;
  const t = useTranslation('document_templates');
  const id = useId();
  if (languages.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="language-switcher">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{t('editor.language')}</Label>
        <Select id={id} className="w-auto" value={current} onChange={(event) => onSelect(event.target.value)}>
          {languages.map((language) => (
            <option key={language} value={language}>
              {stored.includes(language) ? language : `${language} — ${t('editor.languageMissing')}`}
            </option>
          ))}
        </Select>
      </div>
      {!stored.includes(current) && copyFrom !== null ? (
        <Button variant="outline" onClick={() => onStart(current)}>
          {t('editor.startFrom', { language: copyFrom })}
        </Button>
      ) : null}
    </div>
  );
}
