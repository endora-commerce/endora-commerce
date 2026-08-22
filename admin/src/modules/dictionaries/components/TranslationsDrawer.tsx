import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DictionaryEntryType, DictionaryLanguage, DictionaryTranslation } from '@endora-commerce/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n/useTranslation';
import { dictionaryClient } from '../client';

interface TranslationsDrawerProps {
  entryType: DictionaryEntryType;
  entryCode: string | null;
  languages: DictionaryLanguage[];
}

export function TranslationsDrawer({
  entryType,
  entryCode,
  languages,
}: TranslationsDrawerProps): ReactNode {
  const t = useTranslation('dictionaries');
  const [rows, setRows] = useState<DictionaryTranslation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingLanguage, setSavingLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryCode) {
      setRows([]);
      setDrafts({});
      return;
    }
    let cancelled = false;
    setError(null);
    void dictionaryClient
      .listTranslations(entryType, entryCode)
      .then((res) => {
        if (cancelled) return;
        setRows(res.data);
        setDrafts(Object.fromEntries(res.data.map((row) => [row.languageCode, row.label])));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(formatError(err, t('translations.error.load')));
      });
    return () => {
      cancelled = true;
    };
  }, [entryCode, entryType, t]);

  const byLanguage = useMemo(
    () => new Map(rows.map((row) => [row.languageCode, row])),
    [rows],
  );

  if (!entryCode) return null;

  const save = async (languageCode: string): Promise<void> => {
    const label = drafts[languageCode]?.trim() ?? '';
    if (!label) return;
    setSavingLanguage(languageCode);
    setError(null);
    try {
      const res = await dictionaryClient.upsertTranslation(entryType, entryCode, languageCode, {
        label,
      });
      setRows((prev) => [
        ...prev.filter((row) => row.languageCode !== languageCode),
        res.data,
      ].sort((a, b) => a.languageCode.localeCompare(b.languageCode)));
    } catch (err) {
      setError(formatError(err, t('translations.error.save')));
    } finally {
      setSavingLanguage(null);
    }
  };

  const remove = async (languageCode: string): Promise<void> => {
    if (!confirm(t('translations.confirmRemove', { languageCode }))) return;
    setSavingLanguage(languageCode);
    setError(null);
    try {
      await dictionaryClient.removeTranslation(entryType, entryCode, languageCode);
      setRows((prev) => prev.filter((row) => row.languageCode !== languageCode));
      setDrafts((prev) => ({ ...prev, [languageCode]: '' }));
    } catch (err) {
      setError(formatError(err, t('translations.error.remove')));
    } finally {
      setSavingLanguage(null);
    }
  };

  return (
    <div className="border-t pt-4">
      <div className="mb-2 text-sm font-medium">{t('translations.title')}</div>
      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-2 rounded-md border p-2">
        {languages.map((language) => {
          const existing = byLanguage.get(language.code);
          const value = drafts[language.code] ?? '';
          return (
            <div key={language.code} className="grid gap-2 md:grid-cols-[110px_1fr_auto_auto]">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs">{language.code}</span>
                {!language.isActive ? (
                  <span className="text-xs text-muted-foreground">{t('translations.inactive')}</span>
                ) : null}
              </div>
              <Input
                value={value}
                maxLength={160}
                placeholder={language.label}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [language.code]: event.target.value }))
                }
              />
              <Button
                type="button"
                size="sm"
                disabled={savingLanguage === language.code || value.trim().length === 0}
                onClick={() => void save(language.code)}
              >
                {t('translations.save')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={savingLanguage === language.code || !existing}
                onClick={() => void remove(language.code)}
              >
                {t('translations.remove')}
              </Button>
            </div>
          );
        })}
        {languages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('translations.noLanguages')}</p>
        ) : null}
      </div>
    </div>
  );
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.envelope.error.message;
  return fallback;
}
