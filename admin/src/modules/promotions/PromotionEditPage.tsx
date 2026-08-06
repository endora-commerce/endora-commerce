import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RuleBuilder, type RuleAttributeField, type RuleFieldOptions } from '@/components/rule-builder/RuleBuilder';
import { PaginationFooter } from '@/components/PaginationFooter';
import { usePageSizePreference } from '@/lib/use-page-size-preference';
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

/** Deep-copy a rule definition so the promotion owns an independent snapshot. */
function cloneRule(rule: PromotionRule): PromotionRule {
  return JSON.parse(JSON.stringify(rule)) as PromotionRule;
}

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
  const [savedRules, setSavedRules] = useState<PromotionRuleRecord[]>([]);
  // Legacy promotions that linked a saved rule by id: resolved into an
  // independent snapshot once `savedRules` has loaded.
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
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
        if (p.rule) {
          setRule(p.rule);
        } else if (p.ruleId) {
          setPendingRuleId(p.ruleId);
        } else {
          setRule({ kind: 'all' });
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

  // Resolve a legacy linked rule into an independent snapshot once the saved
  // rule list is available.
  useEffect(() => {
    if (!pendingRuleId) return;
    const found = savedRules.find((r) => r.id === pendingRuleId);
    if (found) {
      setRule(cloneRule(found.definition));
      setPendingRuleId(null);
    }
  }, [pendingRuleId, savedRules]);

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
          rule,
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
      name, description, isActive, priority, stopFurther, action, rule, code,
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
            <div className="flex flex-col gap-1">
              <Label htmlFor="ruleCopyFrom">{t('promotions.edit.ruleCopyFrom')}</Label>
              <Select
                id="ruleCopyFrom"
                className="w-72"
                value=""
                disabled={savedRules.length === 0}
                onChange={(e) => {
                  const found = savedRules.find((r) => r.id === e.target.value);
                  if (found) setRule(cloneRule(found.definition));
                }}
              >
                <option value="">—</option>
                {savedRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{t('promotions.edit.ruleCopyHint')}</p>
            </div>
            <RuleBuilder
              value={rule}
              onChange={setRule}
              attributeFields={attributeFields}
              fieldOptions={fieldOptions}
              // This screen has option sets too (payment and delivery methods),
              // so it gets the same value picker — and its copy translated
              // rather than the component's English fallback.
              labels={{
                valuesPlaceholder: t('ruleBuilder.values.placeholder'),
                valuesLabel: t('ruleBuilder.values.label'),
                valuesSearchPlaceholder: t('ruleBuilder.values.search'),
              }}
            />
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

      {!isNew && id ? (
        <CouponsSection promotionId={id} />
      ) : (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t('promotions.coupons.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('promotions.coupons.saveFirst')}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
};

// Renders a coupon code with a hover-revealed copy affordance. Clicking the
// code text or the copy icon writes the code to the clipboard; the icon briefly
// switches to a check mark to confirm.
function CouponCodeCell({ code }: { code: string }): ReactNode {
  const t = useTranslation('core');
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently ignore.
    }
  }, [code]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={copied ? t('promotions.coupons.copied') : t('promotions.coupons.copyCode')}
      aria-label={t('promotions.coupons.copyCode')}
      className="group inline-flex items-center gap-1.5 font-mono hover:opacity-80"
    >
      {code}
      {copied ? (
        <Check className="size-3.5 text-green-600" aria-hidden />
      ) : (
        <Copy
          className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60"
          aria-hidden
        />
      )}
    </button>
  );
}

function CouponsSection({ promotionId }: { promotionId: string }): ReactNode {
  const t = useTranslation('core');
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const { pageSize, setPageSize } = usePageSizePreference('promotion-coupons');

  const reload = useCallback(() => {
    void promotionsClient
      .listCoupons(promotionId)
      .then((rows) => {
        setCoupons(rows);
        // Drop any selection that no longer exists.
        setSelected((prev) => new Set(rows.filter((c) => prev.has(c.id)).map((c) => c.id)));
      })
      .catch(() => setCoupons([]));
  }, [promotionId]);
  useEffect(() => reload(), [reload]);

  // Keep the current page within bounds as the list or page size changes.
  const pageCount = Math.max(1, Math.ceil(coupons.length / pageSize));
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);
  const visibleCoupons = coupons.slice(page * pageSize, page * pageSize + pageSize);

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

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = coupons.length > 0 && selected.size === coupons.length;
  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(coupons.map((c) => c.id)));
  };

  const bulkSetActive = async (isActive: boolean): Promise<void> => {
    if (selected.size === 0) return;
    setErr(null);
    setBusy(true);
    try {
      await promotionsClient.bulkSetCouponActive(promotionId, [...selected], isActive);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.envelope.error.message : t('promotions.error.save'));
    } finally {
      setBusy(false);
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
          <>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || selected.size === 0}
                onClick={() => void bulkSetActive(true)}
              >
                {t('promotions.coupons.activate')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || selected.size === 0}
                onClick={() => void bulkSetActive(false)}
              >
                {t('promotions.coupons.deactivate')}
              </Button>
              {selected.size > 0 ? (
                <span className="text-sm text-muted-foreground">
                  {t('promotions.coupons.selectedCount', { count: selected.size })}
                </span>
              ) : null}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={t('promotions.coupons.colCode')}
                    />
                  </TableHead>
                  <TableHead>{t('promotions.coupons.colCode')}</TableHead>
                  <TableHead>{t('promotions.coupons.colScope')}</TableHead>
                  <TableHead>{t('promotions.coupons.colStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCoupons.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={c.code}
                      />
                    </TableCell>
                    <TableCell>
                      <CouponCodeCell code={c.code} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.limitScope}</TableCell>
                    <TableCell>
                      <Badge variant={c.isActive ? 'success' : 'secondary'}>
                        {c.isActive
                          ? t('promotions.coupons.active')
                          : t('promotions.coupons.inactive')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationFooter
              page={page}
              pageSize={pageSize}
              total={coupons.length}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(0);
              }}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            />
          </>
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
