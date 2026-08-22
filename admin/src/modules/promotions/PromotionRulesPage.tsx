import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { RuleBuilder, type RuleAttributeField } from '@/components/rule-builder/RuleBuilder';
import { useTranslation } from '@/i18n/useTranslation';
import type { PromotionRule, PromotionRuleRecord } from '@endora-commerce/contracts';
import { promotionRulesClient, promotionsClient } from './client';

/**
 * Feature 045 (US6) — standalone named-rule library. Build a rule with the
 * shared RuleBuilder, save it by name, and reuse it across promotions. Existing
 * rules can be loaded back into the builder to edit and re-save in place.
 */
export const PromotionRulesPage = (): ReactNode => {
  const t = useTranslation('core');
  const [rows, setRows] = useState<PromotionRuleRecord[]>([]);
  const [name, setName] = useState('');
  const [rule, setRule] = useState<PromotionRule>({ kind: 'all' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [attributeFields, setAttributeFields] = useState<RuleAttributeField[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void promotionRulesClient.list().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => refresh(), [refresh]);

  // Promo-rule-flagged catalog attributes power the RuleBuilder's attribute
  // conditions (feature: attributes promoRule toggle). Best-effort: a failure
  // leaves the attribute list empty rather than breaking the builder.
  useEffect(() => {
    void promotionsClient
      .ruleAttributes()
      .then((items) =>
        setAttributeFields(items.map((a) => ({ attributeKey: a.key, label: a.labelDefault || a.key }))),
      )
      .catch(() => setAttributeFields([]));
  }, []);

  const resetForm = (): void => {
    setEditingId(null);
    setName('');
    setRule({ kind: 'all' });
    setDescription(null);
  };

  const startEdit = (r: PromotionRuleRecord): void => {
    setEditingId(r.id);
    setName(r.name);
    setRule(r.definition);
    setDescription(r.description);
    setError(null);
  };

  const save = async (): Promise<void> => {
    setError(null);
    try {
      const payload = { name: name.trim(), description, definition: rule };
      if (editingId) {
        await promotionRulesClient.update(editingId, payload);
      } else {
        await promotionRulesClient.create(payload);
      }
      resetForm();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.envelope.error.message : t('promotions.error.save'));
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await promotionRulesClient.remove(id);
      if (editingId === id) resetForm();
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
          <CardTitle>{editingId ? t('common.action.edit') : t('promotionRules.create.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ruleName">{t('promotionRules.field.name')}</Label>
            <Input id="ruleName" value={name} onChange={(e) => setName(e.target.value)} className="w-72" />
          </div>
          <RuleBuilder value={rule} onChange={setRule} attributeFields={attributeFields} />
          <div className="flex gap-2">
            <Button type="button" disabled={name.trim() === ''} onClick={() => void save()}>
              {editingId ? t('common.action.save') : t('promotionRules.create.save')}
            </Button>
            {editingId ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                <X /> {t('common.action.cancel')}
              </Button>
            ) : null}
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
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(r)}>
                      <Pencil /> {t('common.action.edit')}
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => void remove(r.id)}>
                      <Trash2 /> {t('promotions.action.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
};
