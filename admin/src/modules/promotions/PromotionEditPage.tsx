import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { RuleBuilder, type RuleAttributeField, type RuleFieldOptions } from '@/components/rule-builder/RuleBuilder';
import { useTranslation } from '@/i18n/useTranslation';
import type { PromotionAction, PromotionActionType, PromotionRule } from '@b2b/contracts';
import { promotionsClient, promotionRulesClient, type Coupon } from './client';
import { CouponGeneratorForm } from './CouponGeneratorForm';
import type { PromotionRuleRecord } from '@b2b/contracts';

const ACTION_TYPES: PromotionActionType[] = [
  'free_delivery',
  'percentage_off_cart',
  'amount_off_cart',
  'buy_x_get_y_free',
  'spend_x_percent_off',
  'spend_x_amount_off',
  'every_nth_product_percent_off',
  'buy_x_units_y_free',
  'buy_x_units_percent_off',
  'buy_x_units_amount_off',
];

function defaultAction(type: PromotionActionType): PromotionAction {
  switch (type) {
    case 'free_delivery':
      return { type };
    case 'percentage_off_cart':
      return { type, percent: 10 };
    case 'amount_off_cart':
      return { type, amount: 10, currency: 'PLN' };
    case 'buy_x_get_y_free':
      return { type, buyQuantity: 2, freeQuantity: 1, target: 'cheapest' };
    case 'spend_x_percent_off':
      return { type, spendStep: 100, percent: 5, currency: 'PLN' };
    case 'spend_x_amount_off':
      return { type, spendStep: 100, amount: 5, currency: 'PLN' };
    case 'every_nth_product_percent_off':
      return { type, nth: 3, percent: 50 };
    case 'buy_x_units_y_free':
      return { type, productId: '', buyUnits: 2, freeUnits: 1 };
    case 'buy_x_units_percent_off':
      return { type, productId: '', buyUnits: 3, percent: 10 };
    case 'buy_x_units_amount_off':
      return { type, productId: '', buyUnits: 3, amount: 10, currency: 'PLN' };
  }
}

export const PromotionEditPage = (): ReactNode => {
  const t = useTranslation('core');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [priority, setPriority] = useState(0);
  const [stopFurther, setStopFurther] = useState(false);
  const [action, setAction] = useState<PromotionAction>(defaultAction('percentage_off_cart'));
  const [rule, setRule] = useState<PromotionRule>({ kind: 'all' });
  const [ruleMode, setRuleMode] = useState<'inline' | 'saved'>('inline');
  const [ruleId, setRuleId] = useState<string>('');
  const [savedRules, setSavedRules] = useState<PromotionRuleRecord[]>([]);
  const [usageGlobal, setUsageGlobal] = useState('');
  const [usagePerOrg, setUsagePerOrg] = useState('');
  const [usagePerCustomer, setUsagePerCustomer] = useState('');
  const [attributeFields, setAttributeFields] = useState<RuleAttributeField[]>([]);
  const [fieldOptions, setFieldOptions] = useState<RuleFieldOptions>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void promotionsClient
      .ruleAttributes()
      .then((items) =>
        setAttributeFields(items.map((a) => ({ attributeKey: a.key, label: a.labelDefault || a.key }))),
      )
      .catch(() => setAttributeFields([]));
    void promotionRulesClient.list().then(setSavedRules).catch(() => setSavedRules([]));
    void (async (): Promise<void> => {
      try {
        const [groups, orgs, cats, pays, ships] = await Promise.all([
          promotionsClient.ruleTarget('customer-groups'),
          promotionsClient.ruleTarget('organizations'),
          promotionsClient.ruleTarget('categories'),
          promotionsClient.ruleTarget('payment-methods'),
          promotionsClient.ruleTarget('delivery-methods'),
        ]);
        setFieldOptions({
          customerGroup: groups.map((g) => ({ value: g.id, label: g.name || g.code || g.id })),
          organization: orgs.map((o) => ({ value: o.id, label: o.name || o.id })),
          category: cats.map((c) => ({ value: c.id, label: c.name || c.slug || c.id })),
          paymentMethod: pays.map((p) => ({ value: p.code ?? p.id, label: p.name || p.code || p.id })),
          deliveryMethod: ships.map((s) => ({ value: s.code ?? s.id, label: s.name || s.code || s.id })),
        });
      } catch {
        setFieldOptions({});
      }
    })();
  }, []);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    void promotionsClient
      .get(id)
      .then((p) => {
        setName(p.name);
        setDescription(p.description ?? '');
        setCode(p.code ?? '');
        setIsActive(p.isActive);
        setPriority(p.priority);
        setStopFurther(p.stopFurther);
        if (p.action) setAction(p.action);
        setRule(p.rule ?? { kind: 'all' });
        if (p.ruleId) {
          setRuleMode('saved');
          setRuleId(p.ruleId);
        }
        setUsageGlobal(p.usageLimitGlobal != null ? String(p.usageLimitGlobal) : '');
        setUsagePerOrg(p.usageLimitPerOrganization != null ? String(p.usageLimitPerOrganization) : '');
        setUsagePerCustomer(p.usageLimitPerCustomer != null ? String(p.usageLimitPerCustomer) : '');
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.load')),
      )
      .finally(() => setLoading(false));
  }, [id, isNew, t]);

  const intOrNull = (s: string): number | null => {
    const n = Number(s);
    return s.trim() === '' || !Number.isFinite(n) ? null : Math.trunc(n);
  };

  const onSubmit = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      setError(null);
      setSaving(true);
      try {
        const payload = {
          name,
          description: description.trim() === '' ? null : description,
          isActive,
          priority,
          stopFurther,
          action,
          ...(ruleMode === 'saved' && ruleId ? { ruleId } : { rule }),
          code: code.trim() === '' ? null : code,
          usageLimitGlobal: intOrNull(usageGlobal),
          usageLimitPerOrganization: intOrNull(usagePerOrg),
          usageLimitPerCustomer: intOrNull(usagePerCustomer),
        };
        if (isNew) await promotionsClient.create(payload);
        else await promotionsClient.update(id, payload);
        navigate('/promotions');
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.save'));
      } finally {
        setSaving(false);
      }
    },
    [
      name, description, isActive, priority, stopFurther, action, rule, ruleMode, ruleId, code,
      usageGlobal, usagePerOrg, usagePerCustomer, isNew, id, navigate, t,
    ],
  );

  if (loading) return <p className="p-4 text-sm text-muted-foreground">{t('promotions.loading')}</p>;

  return (
    <>
      <PageHeader
        title={isNew ? t('promotions.edit.titleNew') : t('promotions.edit.titleEdit')}
        description={t('promotions.edit.description')}
      />
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('promotions.edit.general')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="name">{t('promotions.field.name')}</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="code">{t('promotions.field.code')}</Label>
              <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label htmlFor="description">{t('promotions.field.description')}</Label>
              <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="priority">{t('promotions.field.priority')}</Label>
              <Input
                id="priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Math.trunc(Number(e.target.value) || 0))}
              />
            </div>
            <div className="flex items-center gap-4 pt-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                {t('promotions.field.active')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={stopFurther} onChange={(e) => setStopFurther(e.target.checked)} />
                {t('promotions.field.stopFurther')}
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('promotions.edit.action')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label>{t('promotions.edit.actionType')}</Label>
              <Select
                className="w-72"
                value={action.type}
                onChange={(e) => setAction(defaultAction(e.target.value as PromotionActionType))}
              >
                {ACTION_TYPES.map((tpe) => (
                  <option key={tpe} value={tpe}>
                    {t(`action.${tpe}`)}
                  </option>
                ))}
              </Select>
            </div>
            <ActionConfigEditor action={action} onChange={setAction} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('promotions.edit.rule')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Select className="w-48" value={ruleMode} onChange={(e) => setRuleMode(e.target.value as 'inline' | 'saved')}>
                <option value="inline">{t('promotions.edit.ruleInline')}</option>
                <option value="saved">{t('promotions.edit.ruleSaved')}</option>
              </Select>
              {ruleMode === 'saved' ? (
                <Select className="w-72" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
                  <option value="">—</option>
                  {savedRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
            {ruleMode === 'inline' ? (
              <RuleBuilder
                value={rule}
                onChange={setRule}
                attributeFields={attributeFields}
                fieldOptions={fieldOptions}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('promotions.edit.limits')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ug">{t('limits.global')}</Label>
              <Input id="ug" type="number" value={usageGlobal} onChange={(e) => setUsageGlobal(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="uo">{t('limits.perOrganization')}</Label>
              <Input id="uo" type="number" value={usagePerOrg} onChange={(e) => setUsagePerOrg(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="uc">{t('limits.perCustomer')}</Label>
              <Input id="uc" type="number" value={usagePerCustomer} onChange={(e) => setUsagePerCustomer(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? t('promotions.loading') : t('promotions.edit.save')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/promotions')}>
            {t('promotions.edit.cancel')}
          </Button>
        </div>
      </form>

      {!isNew && id ? <CouponsSection promotionId={id} /> : null}
    </>
  );
};

function CouponsSection({ promotionId }: { promotionId: string }): ReactNode {
  const t = useTranslation('core');
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    void promotionsClient.listCoupons(promotionId).then(setCoupons).catch(() => setCoupons([]));
  }, [promotionId]);
  useEffect(() => reload(), [reload]);

  const add = async (): Promise<void> => {
    setErr(null);
    try {
      await promotionsClient.createCoupon(promotionId, code.trim());
      setCode('');
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.envelope.error.message : t('promotions.error.save'));
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('promotions.coupons.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {err ? (
          <Alert variant="destructive">
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="couponCode">{t('promotions.coupons.code')}</Label>
            <Input id="couponCode" value={code} onChange={(e) => setCode(e.target.value)} className="w-64" />
          </div>
          <Button type="button" disabled={code.trim() === ''} onClick={() => void add()}>
            {t('promotions.coupons.add')}
          </Button>
        </div>
        <CouponGeneratorForm promotionId={promotionId} onGenerated={reload} />
        {coupons.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('promotions.coupons.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {coupons.map((c) => (
              <li key={c.id} className="font-mono">
                {c.code} <span className="text-muted-foreground">({c.limitScope})</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}

function ActionConfigEditor({
  action,
  onChange,
}: {
  action: PromotionAction;
  onChange: (a: PromotionAction) => void;
}): ReactNode {
  const t = useTranslation('core');
  const grid = 'grid gap-3 md:grid-cols-3';
  switch (action.type) {
    case 'free_delivery':
      return <p className="text-sm text-muted-foreground">{t('promotions.edit.noConfig')}</p>;
    case 'percentage_off_cart':
      return (
        <div className={grid}>
          <NumberField label="percent" value={action.percent} onChange={(percent) => onChange({ ...action, percent })} />
        </div>
      );
    case 'amount_off_cart':
      return (
        <div className={grid}>
          <NumberField label="amount" value={action.amount} onChange={(amount) => onChange({ ...action, amount })} />
          <CurrencyField value={action.currency} onChange={(currency) => onChange({ ...action, currency })} />
        </div>
      );
    case 'buy_x_get_y_free':
      return (
        <div className={grid}>
          <NumberField label="buyQuantity" value={action.buyQuantity} onChange={(buyQuantity) => onChange({ ...action, buyQuantity })} />
          <NumberField label="freeQuantity" value={action.freeQuantity} onChange={(freeQuantity) => onChange({ ...action, freeQuantity })} />
          <div className="flex flex-col gap-1">
            <Label>target</Label>
            <Select value={action.target} onChange={(e) => onChange({ ...action, target: e.target.value as 'cheapest' | 'most_expensive' })}>
              <option value="cheapest">cheapest</option>
              <option value="most_expensive">most_expensive</option>
            </Select>
          </div>
        </div>
      );
    case 'spend_x_percent_off':
      return (
        <div className={grid}>
          <NumberField label="spendStep" value={action.spendStep} onChange={(spendStep) => onChange({ ...action, spendStep })} />
          <NumberField label="percent" value={action.percent} onChange={(percent) => onChange({ ...action, percent })} />
          <CurrencyField value={action.currency} onChange={(currency) => onChange({ ...action, currency })} />
        </div>
      );
    case 'spend_x_amount_off':
      return (
        <div className={grid}>
          <NumberField label="spendStep" value={action.spendStep} onChange={(spendStep) => onChange({ ...action, spendStep })} />
          <NumberField label="amount" value={action.amount} onChange={(amount) => onChange({ ...action, amount })} />
          <CurrencyField value={action.currency} onChange={(currency) => onChange({ ...action, currency })} />
        </div>
      );
    case 'every_nth_product_percent_off':
      return (
        <div className={grid}>
          <NumberField label="nth" value={action.nth} onChange={(nth) => onChange({ ...action, nth })} />
          <NumberField label="percent" value={action.percent} onChange={(percent) => onChange({ ...action, percent })} />
        </div>
      );
    case 'buy_x_units_y_free':
      return (
        <div className={grid}>
          <ProductIdField value={action.productId} onChange={(productId) => onChange({ ...action, productId })} />
          <NumberField label="buyUnits" value={action.buyUnits} onChange={(buyUnits) => onChange({ ...action, buyUnits })} />
          <NumberField label="freeUnits" value={action.freeUnits} onChange={(freeUnits) => onChange({ ...action, freeUnits })} />
        </div>
      );
    case 'buy_x_units_percent_off':
      return (
        <div className={grid}>
          <ProductIdField value={action.productId} onChange={(productId) => onChange({ ...action, productId })} />
          <NumberField label="buyUnits" value={action.buyUnits} onChange={(buyUnits) => onChange({ ...action, buyUnits })} />
          <NumberField label="percent" value={action.percent} onChange={(percent) => onChange({ ...action, percent })} />
        </div>
      );
    case 'buy_x_units_amount_off':
      return (
        <div className={grid}>
          <ProductIdField value={action.productId} onChange={(productId) => onChange({ ...action, productId })} />
          <NumberField label="buyUnits" value={action.buyUnits} onChange={(buyUnits) => onChange({ ...action, buyUnits })} />
          <NumberField label="amount" value={action.amount} onChange={(amount) => onChange({ ...action, amount })} />
          <CurrencyField value={action.currency} onChange={(currency) => onChange({ ...action, currency })} />
        </div>
      );
  }
}

function CurrencyField({ value, onChange }: { value: string; onChange: (v: string) => void }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <Label>currency</Label>
      <Input value={value} maxLength={3} onChange={(e) => onChange(e.target.value.toUpperCase())} />
    </div>
  );
}

function ProductIdField({ value, onChange }: { value: string; onChange: (v: string) => void }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <Label>productId</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="product UUID" />
    </div>
  );
}
