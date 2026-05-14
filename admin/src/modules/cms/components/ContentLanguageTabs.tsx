import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/useTranslation';

export function ContentLanguageTabs({
  languages,
  activeLanguage,
  onChange,
}: {
  languages: string[];
  activeLanguage: string | null;
  onChange: (language: string) => void;
}): ReactNode {
  const t = useTranslation('cms');

  if (languages.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('languageTabs.empty')}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('languageTabs.ariaLabel')}>
      {languages.map((language) => {
        const active = language === activeLanguage;
        return (
          <Button
            key={language}
            type="button"
            variant={active ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(language)}
            role="tab"
            aria-selected={active}
          >
            {language}
          </Button>
        );
      })}
    </div>
  );
}
