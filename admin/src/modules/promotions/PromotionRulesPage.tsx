import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { RuleBuilder } from '@/components/rule-builder/RuleBuilder';
import { useTranslation } from '@/i18n/useTranslation';
import type { PromotionRule, PromotionRuleRecord } from '@b2b/contracts';
import { promotionRulesClient } from './client';

/**
 * Feature 045 (US6) — standalone named-rule library. Build a rule with the
 * shared RuleBuilder, save it by name, and reuse it across promotions.
 */
export const PromotionRulesPage = (): ReactNode => {
  const t = useTranslation('core');
  const [rows, setRows] = useState<PromotionRuleRecord[]>([]);
  const [name, setName] = useState('');
  const [rule, setRule] = useState<PromotionRule>({ kind: 'all' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void promotionRulesClient.list().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => refresh(), [refresh]);

  const create = async (): Promise<void> => {
    setError(null);
    try {
      await promotionRulesClient.create({ name: name.trim(), definition: rule });
      setName('');
      setRule({ kind: 'all' });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.envelope.error.message : t('promotions.error.save'));
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await promotionRulesClient.remove(id);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.envelope.error.message : t('promotions.error.delete'));
    }
  };

  return (
    <>
      <PageHeader title={t('promotionRules.page.title')} description={t('promotionRules.page.description')} />
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('promotionRules.create.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ruleName">{t('promotionRules.field.name')}</Label>
            <Input id="ruleName" value={name} onChange={(e) => setName(e.target.value)} className="w-72" />
          </div>
          <RuleBuilder value={rule} onChange={setRule} />
          <div>
            <Button type="button" disabled={name.trim() === ''} onClick={() => void create()}>
              {t('promotionRules.create.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('promotionRules.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between border-b border-line pb-2">
                  <span className="font-medium">{r.name}</span>
                  <Button type="button" variant="destructive" size="sm" onClick={() => void remove(r.id)}>
                    <Trash2 /> {t('promotions.action.delete')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
};
