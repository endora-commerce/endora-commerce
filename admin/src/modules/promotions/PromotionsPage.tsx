import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
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
import { useTranslation } from '@/i18n/useTranslation';
import { CurrencyPicker } from '../dictionaries/components/CurrencyPicker';

interface PromotionActionView {
  type: string;
  percent?: number;
  amount?: number;
  currency?: string;
  [k: string]: unknown;
}

interface AdminPromotion {
  id: string;
  code: string | null;
  name: string;
  // Feature 045 — null on action-based promotions.
  kind: 'percentage_off' | 'amount_off' | 'free_delivery' | null;
  value: number | null;
  currency: string | null;
  minCartSubtotal: number | null;
  validFrom: string | null;
  validUntil: string | null;
  criteria?: AttributeCriterion[];
  isActive: boolean;
  createdAt: string;
  // Feature 045 — engine fields.
  description?: string | null;
  priority?: number;
  stopFurther?: boolean;
  action?: PromotionActionView | null;
}

/** Human-readable summary of a promotion's effect (legacy kind or action). */
function describeEffect(p: AdminPromotion): string {
  if (p.action) {
    const a = p.action;
    if (a.type === 'percentage_off_cart') return `${a.percent}% off cart`;
    if (a.type === 'amount_off_cart') return `${a.amount} ${a.currency} off cart`;
    if (a.type === 'free_delivery') return 'Free delivery';
    return a.type;
  }
  if (p.kind === 'percentage_off') return `${p.value}%`;
  if (p.kind === 'amount_off') return `${p.value} ${p.currency ?? ''}`.trim();
  if (p.kind === 'free_delivery') return 'Free delivery';
  return '—';
}

/**
 * Feature 012 / US8 — admin-side editor for the new `attribute` promotion
 * criterion. Other criterion variants (category / product / customerGroup
 * / organization) are served by the existing flat fields and have no
 * editor surface yet.
 */
type AttributeOp = 'equals' | 'in' | 'range';
type AttributeValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'select'
  | 'multiselect'
  | 'price';

interface AttributeCriterion {
  type: 'attribute';
  attributeKey: string;
  op: AttributeOp;
  values: unknown[];
}

interface PromoRuleAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: AttributeValueType;
  options?: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
}

const KINDS = ['percentage_off', 'amount_off', 'free_delivery'] as const;

function allowedOpsFor(valueType: AttributeValueType): AttributeOp[] {
  switch (valueType) {
    case 'string':
    case 'select':
    case 'enum':
      return ['equals', 'in'];
    case 'multiselect':
      return ['in'];
    case 'number':
    case 'price':
    case 'date':
      return ['equals', 'range'];
    case 'boolean':
      return ['equals'];
    default:
      return [];
  }
}

export const PromotionsPage = (): ReactNode => {
  const t = useTranslation('core');
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPromotion[] }>('/api/v1/admin/promotions');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      code: string;
      name: string;
      kind: AdminPromotion['kind'];
      value: number;
      currency: string;
      isActive: boolean;
      criteria: AttributeCriterion[];
    }): Promise<void> => {
      try {
        await apiClient.post<{ data: AdminPromotion }>('/api/v1/admin/promotions', {
          ...(input.code ? { code: input.code } : {}),
          name: input.name,
          kind: input.kind,
          value: input.value,
          ...(input.kind === 'amount_off' ? { currency: input.currency } : {}),
          ...(input.criteria.length > 0 ? { criteria: input.criteria } : {}),
          isActive: input.isActive,
        });
        setInfo(t('promotions.success.create', { name: input.code || input.name }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.save'));
      }
    },
    [refresh, t],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('promotions.deleteConfirm'))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/promotions/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.delete'));
      }
    },
    [refresh, t],
  );

  return (
    <>
      <PageHeader
        title={t('promotions.page.title')}
        description={t('promotions.page.description')}
      />

      <div className="mb-4">
        <Button type="button" onClick={() => navigate('/promotions/new')}>
          <Plus /> {t('promotions.edit.titleNew')}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('promotions.create.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreatePromotionForm onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('promotions.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('promotions.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('promotions.column.code')}</TableHead>
                  <TableHead>{t('promotions.column.name')}</TableHead>
                  <TableHead>{t('promotions.column.kind')}</TableHead>
                  <TableHead>{t('promotions.column.value')}</TableHead>
                  <TableHead>{t('promotions.column.minCart')}</TableHead>
                  <TableHead>{t('promotions.column.valid')}</TableHead>
                  <TableHead>{t('promotions.column.criteria')}</TableHead>
                  <TableHead>{t('promotions.column.active')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{p.code ?? '—'}</code>
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.action ? p.action.type : (p.kind ?? '—')}</TableCell>
                    <TableCell className="tabular-nums">{describeEffect(p)}</TableCell>
                    <TableCell className="tabular-nums">
                      {p.minCartSubtotal != null ? p.minCartSubtotal.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.validFrom ? formatDateTime(p.validFrom) : '—'}
                      {' → '}
                      {p.validUntil ? formatDateTime(p.validUntil) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.criteria && p.criteria.length > 0
                        ? p.criteria
                            .map(
                              (c) =>
                                `${c.attributeKey} ${c.op} [${c.values.map((v) => String(v)).join(', ')}]`,
                            )
                            .join('; ')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? 'success' : 'secondary'}>
                        {p.isActive ? t('promotions.active.yes') : t('promotions.active.no')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className="mr-2"
                        onClick={() => navigate(`/promotions/${p.id}`)}
                      >
                        <Pencil />
                        {t('promotions.edit.titleEdit')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className="mr-2"
                        onClick={() => navigate(`/promotions/${p.id}/stats`)}
                      >
                        <BarChart3 />
                        {t('promotionStats.title')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        type="button"
                        onClick={(): void => void handleDelete(p.id)}
                      >
                        <Trash2 />
                        {t('promotions.action.delete')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
};

const CreatePromotionForm = ({
  onSubmit,
}: {
  onSubmit: (input: {
    code: string;
    name: string;
    kind: 'percentage_off' | 'amount_off' | 'free_delivery';
    value: number;
    currency: string;
    isActive: boolean;
    criteria: AttributeCriterion[];
  }) => Promise<void>;
}): ReactNode => {
  const t = useTranslation('core');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percentage_off' | 'amount_off' | 'free_delivery'>('percentage_off');
  const [value, setValue] = useState('10');
  const [currency, setCurrency] = useState('PLN');
  const [isActive, setIsActive] = useState(true);
  const [criteria, setCriteria] = useState<AttributeCriterion[]>([]);

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          code,
          name,
          kind,
          value: Number(value),
          currency,
          isActive,
          criteria,
        }).then(() => {
          setCode('');
          setName('');
          setValue('10');
          setCriteria([]);
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="prcode">{t('promotions.field.code')}</Label>
          <Input id="prcode" value={code} onChange={(e): void => setCode(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prname">{t('promotions.field.name')}</Label>
          <Input
            id="prname"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prkind">{t('promotions.field.kind')}</Label>
          <Select
            id="prkind"
            value={kind}
            onChange={(e): void => setKind(e.target.value as typeof kind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="prvalue">
            {kind === 'percentage_off'
              ? t('promotions.field.valuePercent')
              : kind === 'amount_off'
                ? t('promotions.field.value')
                : t('promotions.field.valueIgnored')}
          </Label>
          <Input
            id="prvalue"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e): void => setValue(e.target.value)}
          />
        </div>
        {kind === 'amount_off' ? (
          <div className="space-y-2">
            <Label htmlFor="prcur">{t('promotions.field.currency')}</Label>
            <CurrencyPicker
              id="prcur"
              value={currency}
              onChange={(e): void => setCurrency(e.target.value)}
              required
            />
          </div>
        ) : null}
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <Checkbox
          checked={isActive}
          onChange={(e): void => setIsActive(e.target.checked)}
        />
        {t('promotions.field.active')}
      </label>

      <CriteriaEditor value={criteria} onChange={setCriteria} />

      <div>
        <Button type="submit">{t('promotions.action.create')}</Button>
      </div>
    </form>
  );
};

/**
 * Feature 012 / US8 — admin editor for the `attribute` promotion criterion
 * variant. Loads the rule-target picker payload once and lets the operator
 * add/remove criteria. The value picker switches its UI based on the
 * selected attribute's `valueType`:
 *
 *   - select / enum / multiselect → checkbox list of option values
 *   - number / price → equals (single number) OR range (min, max)
 *   - boolean → true/false toggle
 *   - string → comma-separated text
 *   - date → equals (datetime) OR range (from / to)
 */
const CriteriaEditor = ({
  value,
  onChange,
}: {
  value: AttributeCriterion[];
  onChange: (next: AttributeCriterion[]) => void;
}): ReactNode => {
  const t = useTranslation('core');
  const [attrs, setAttrs] = useState<PromoRuleAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient.get<{ data: { items: PromoRuleAttribute[] } }>(
          '/api/v1/admin/promotions/rule-targets/attributes',
        );
        if (!cancelled) setAttrs(res.data.items);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.loadAttributes'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [t]);

  const addCriterion = (): void => {
    const first = attrs[0];
    if (!first) return;
    onChange([
      ...value,
      {
        type: 'attribute',
        attributeKey: first.key,
        op: allowedOpsFor(first.valueType)[0] ?? 'equals',
        values: defaultValuesFor(first),
      },
    ]);
  };

  const removeCriterion = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateCriterion = (idx: number, next: AttributeCriterion): void => {
    onChange(value.map((c, i) => (i === idx ? next : c)));
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>{t('promotions.criteria.title')}</Label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loading || attrs.length === 0}
          onClick={addCriterion}
        >
          {t('promotions.criteria.add')}
        </Button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">{t('promotions.criteria.loading')}</p>
      ) : loadError ? (
        <p className="text-xs text-destructive">{loadError}</p>
      ) : attrs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('promotions.criteria.noAttributes')}
        </p>
      ) : value.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('promotions.criteria.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((c, idx) => (
            <li key={idx} className="rounded border p-2">
              <CriterionRow
                criterion={c}
                attrs={attrs}
                onChange={(next): void => updateCriterion(idx, next)}
                onRemove={(): void => removeCriterion(idx)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const CriterionRow = ({
  criterion,
  attrs,
  onChange,
  onRemove,
}: {
  criterion: AttributeCriterion;
  attrs: PromoRuleAttribute[];
  onChange: (next: AttributeCriterion) => void;
  onRemove: () => void;
}): ReactNode => {
  const t = useTranslation('core');
  const attr = attrs.find((a) => a.key === criterion.attributeKey);
  const allowedOps = attr ? allowedOpsFor(attr.valueType) : [];

  const handleAttrChange = (key: string): void => {
    const next = attrs.find((a) => a.key === key);
    if (!next) return;
    const op = allowedOpsFor(next.valueType)[0] ?? 'equals';
    onChange({
      type: 'attribute',
      attributeKey: key,
      op,
      values: defaultValuesFor(next),
    });
  };

  const handleOpChange = (op: AttributeOp): void => {
    if (!attr) return;
    onChange({
      ...criterion,
      op,
      values: defaultValuesFor(attr, op),
    });
  };

  return (
    <div className="grid gap-2 md:grid-cols-[1fr_120px_2fr_auto]">
      <Select
        value={criterion.attributeKey}
        onChange={(e): void => handleAttrChange(e.target.value)}
      >
        {attrs.map((a) => (
          <option key={a.key} value={a.key}>
            {a.labelDefault} ({a.valueType})
          </option>
        ))}
      </Select>
      <Select value={criterion.op} onChange={(e): void => handleOpChange(e.target.value as AttributeOp)}>
        {allowedOps.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>
      {attr ? (
        <ValuePicker
          attr={attr}
          op={criterion.op}
          values={criterion.values}
          onChange={(values): void => onChange({ ...criterion, values })}
        />
      ) : (
        <Input disabled placeholder={t('promotions.criterion.unknownAttribute')} />
      )}
      <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
};

const ValuePicker = ({
  attr,
  op,
  values,
  onChange,
}: {
  attr: PromoRuleAttribute;
  op: AttributeOp;
  values: unknown[];
  onChange: (next: unknown[]) => void;
}): ReactNode => {
  const t = useTranslation('core');
  const isSelectStyle = attr.valueType === 'select' || attr.valueType === 'enum' || attr.valueType === 'multiselect';

  if (isSelectStyle && attr.options) {
    const selected = new Set(values.map((v) => String(v)));
    return (
      <div className="flex flex-wrap gap-2 text-xs">
        {attr.options.map((o) => {
          const checked = selected.has(o.value);
          return (
            <label key={o.value} className="inline-flex items-center gap-1">
              <Checkbox
                checked={checked}
                onChange={(e): void => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o.value);
                  else next.delete(o.value);
                  // For `equals` keep at most one value.
                  if (op === 'equals') {
                    onChange(e.target.checked ? [o.value] : []);
                  } else {
                    onChange([...next]);
                  }
                }}
              />
              {o.labelDefault}
            </label>
          );
        })}
      </div>
    );
  }

  if (attr.valueType === 'boolean') {
    return (
      <Select
        value={values[0] === true ? 'true' : 'false'}
        onChange={(e): void => onChange([e.target.value === 'true'])}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    );
  }

  if (attr.valueType === 'number' || attr.valueType === 'price') {
    if (op === 'range') {
      return (
        <div className="flex gap-1">
          <Input
            type="number"
            value={String(values[0] ?? '')}
            onChange={(e): void => onChange([Number(e.target.value), values[1] ?? 0])}
            placeholder={t('promotions.range.min')}
          />
          <Input
            type="number"
            value={String(values[1] ?? '')}
            onChange={(e): void => onChange([values[0] ?? 0, Number(e.target.value)])}
            placeholder={t('promotions.range.max')}
          />
        </div>
      );
    }
    return (
      <Input
        type="number"
        value={String(values[0] ?? '')}
        onChange={(e): void => onChange([Number(e.target.value)])}
      />
    );
  }

  if (attr.valueType === 'date') {
    if (op === 'range') {
      return (
        <div className="flex gap-1">
          <Input
            type="datetime-local"
            value={String(values[0] ?? '')}
            onChange={(e): void => onChange([e.target.value, values[1] ?? ''])}
          />
          <Input
            type="datetime-local"
            value={String(values[1] ?? '')}
            onChange={(e): void => onChange([values[0] ?? '', e.target.value])}
          />
        </div>
      );
    }
    return (
      <Input
        type="datetime-local"
        value={String(values[0] ?? '')}
        onChange={(e): void => onChange([e.target.value])}
      />
    );
  }

  // string fallback
  return (
    <Input
      placeholder={op === 'in' ? t('promotions.placeholder.csv') : t('promotions.placeholder.value')}
      value={values.map((v) => String(v)).join(', ')}
      onChange={(e): void => {
        const parts = e.target.value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        onChange(op === 'equals' ? parts.slice(0, 1) : parts);
      }}
    />
  );
};

const defaultValuesFor = (attr: PromoRuleAttribute, op?: AttributeOp): unknown[] => {
  const effectiveOp = op ?? allowedOpsFor(attr.valueType)[0] ?? 'equals';
  if (attr.valueType === 'boolean') return [true];
  if (attr.valueType === 'number' || attr.valueType === 'price') {
    return effectiveOp === 'range' ? [0, 0] : [0];
  }
  if (attr.valueType === 'date') {
    return effectiveOp === 'range' ? ['', ''] : [''];
  }
  return [];
};
