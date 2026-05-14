import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

// Feature 002 (T035) — DB-level value types. Foundation 001 had
// the original 5 (string, number, boolean, enum, date); 002 adds
// `multiselect` and `price`. The presentation hint
// `displayAsSlider` is honored only when valueType ∈ (number, price).
const VALUE_TYPES = [
  'string',
  'number',
  'boolean',
  'enum',
  'multiselect',
  'price',
] as const;
type ValueType = (typeof VALUE_TYPES)[number];

interface AdminAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  /** Feature 012 — fallback label used when active locale is missing from `label`. */
  labelDefault: string;
  valueType: ValueType;
  /** Legacy projection from `attribute_options` rows (feature 012 read shape). */
  enumValues: string[] | null;
  isSearchable: boolean;
  isFilterable: boolean;
  isVariantAxis: boolean;
  displayAsSlider: boolean;
  isComparable: boolean;
  /** Feature 012 — enforced at product save time when in the assigned set. */
  isRequired: boolean;
  /** Feature 012 — surfaces the attribute in the Promotion Rule criterion picker. */
  isPromoRule: boolean;
  /** Feature 012 — ascending sort order on the storefront filter sidebar. */
  filterPosition: number;
  /** Feature 012 — gates inclusion in the storefront PDP "Parametry produktu" tab. */
  isVisibleOnProductPage: boolean;
}

export function AttributesManager(): ReactNode {
  const t = useTranslation('catalog');
  const [attrs, setAttrs] = useState<AdminAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminAttribute[] }>(
        '/api/v1/admin/catalog/attributes',
      );
      setAttrs(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      key: string;
      labelEn: string;
      labelPl: string;
      valueType: ValueType;
      enumValues: string;
      isSearchable: boolean;
      isFilterable: boolean;
      isVariantAxis: boolean;
      displayAsSlider: boolean;
      isComparable: boolean;
    }): Promise<void> => {
      const label: Record<string, string> = {};
      if (input.labelEn) label['en-US'] = input.labelEn;
      if (input.labelPl) label['pl-PL'] = input.labelPl;
      // enumValues required for both `enum` (single-select / legacy) and
      // `multiselect` (new in feature 002).
      const enumValues =
        input.valueType === 'enum' || input.valueType === 'multiselect'
          ? input.enumValues
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      try {
        await apiClient.post<{ data: AdminAttribute }>('/api/v1/admin/catalog/attributes', {
          key: input.key,
          label,
          valueType: input.valueType,
          ...(enumValues !== undefined ? { enumValues } : {}),
          isSearchable: input.isSearchable,
          isFilterable: input.isFilterable,
          isVariantAxis: input.isVariantAxis,
          ...(input.isComparable ? { isComparable: true } : {}),
          // Honor displayAsSlider only on numeric types (matches the
          // backend service-side guard); the form keeps the box hidden
          // for non-numeric types so this branch rarely fires.
          ...(input.displayAsSlider && (input.valueType === 'number' || input.valueType === 'price')
            ? { displayAsSlider: true }
            : {}),
        });
        setInfo(t('attributes.success.create', { key: input.key }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.create'));
      }
    },
    [refresh],
  );

  const handleToggle = useCallback(
    async (
      attr: AdminAttribute,
      patch: {
        isSearchable?: boolean;
        isFilterable?: boolean;
        isVariantAxis?: boolean;
        isComparable?: boolean;
        // Feature 012 — these flag patches are now accepted by the
        // backend; the visual editor exposes them in a follow-up admin
        // iteration.
        isRequired?: boolean;
        isPromoRule?: boolean;
        filterPosition?: number;
        isVisibleOnProductPage?: boolean;
        labelDefault?: string;
      },
    ): Promise<void> => {
      try {
        await apiClient.patch<{ data: AdminAttribute }>(
          `/api/v1/admin/catalog/attributes/${attr.key}`,
          patch,
        );
        setInfo(t('attributes.success.update', { key: attr.key }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.update'));
      }
    },
    [refresh],
  );

  return (
    <>
      <PageHeader
        title={t('attributes.page.title')}
        description={t('attributes.page.description')}
      />

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
          <CardTitle>{t('attributes.create.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateAttributeForm onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('attributes.loading')}</p>
          ) : attrs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('attributes.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('attributes.column.key')}</TableHead>
                  <TableHead>{t('attributes.column.label')}</TableHead>
                  <TableHead>{t('attributes.column.type')}</TableHead>
                  <TableHead>{t('attributes.column.enumValues')}</TableHead>
                  <TableHead>{t('attributes.column.searchable')}</TableHead>
                  <TableHead>{t('attributes.column.filterable')}</TableHead>
                  <TableHead>{t('attributes.column.variantAxis')}</TableHead>
                  <TableHead>{t('attributes.column.comparable')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attrs.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{a.key}</code>
                    </TableCell>
                    <TableCell>
                      {a.label['en-US'] ?? Object.values(a.label)[0] ?? ''}
                    </TableCell>
                    <TableCell>{a.valueType}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.enumValues ? a.enumValues.join(', ') : '—'}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={a.isSearchable}
                        onChange={(e): void =>
                          void handleToggle(a, { isSearchable: e.target.checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={a.isFilterable}
                        onChange={(e): void =>
                          void handleToggle(a, { isFilterable: e.target.checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={a.isVariantAxis}
                        onChange={(e): void =>
                          void handleToggle(a, { isVariantAxis: e.target.checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={a.isComparable}
                        onChange={(e): void =>
                          void handleToggle(a, { isComparable: e.target.checked })
                        }
                      />
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
}

function CreateAttributeForm({
  onSubmit,
}: {
  onSubmit: (input: {
    key: string;
    labelEn: string;
    labelPl: string;
    valueType: ValueType;
    enumValues: string;
    isSearchable: boolean;
    isFilterable: boolean;
    isVariantAxis: boolean;
    displayAsSlider: boolean;
    isComparable: boolean;
  }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [key, setKey] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelPl, setLabelPl] = useState('');
  const [valueType, setValueType] = useState<ValueType>('string');
  const [enumValues, setEnumValues] = useState('');
  const [isSearchable, setIsSearchable] = useState(false);
  const [isFilterable, setIsFilterable] = useState(false);
  const [isVariantAxis, setIsVariantAxis] = useState(false);
  const [displayAsSlider, setDisplayAsSlider] = useState(false);
  const [isComparable, setIsComparable] = useState(false);
  const isNumeric = valueType === 'number' || valueType === 'price';

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          key,
          labelEn,
          labelPl,
          valueType,
          enumValues,
          isSearchable,
          isFilterable,
          isVariantAxis,
          displayAsSlider,
          isComparable,
        }).then(() => {
          setKey('');
          setLabelEn('');
          setLabelPl('');
          setEnumValues('');
          setIsSearchable(false);
          setIsFilterable(false);
          setIsVariantAxis(false);
          setDisplayAsSlider(false);
          setIsComparable(false);
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="akey">{t('attributes.field.key')}</Label>
          <Input
            id="akey"
            value={key}
            onChange={(e): void => setKey(e.target.value)}
            pattern="[a-z][a-z0-9_]*"
            required
            maxLength={64}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="atype">{t('attributes.field.type')}</Label>
          <Select
            id="atype"
            value={valueType}
            onChange={(e): void => setValueType(e.target.value as ValueType)}
          >
            {VALUE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="alen">{t('attributes.field.labelEn')}</Label>
          <Input id="alen" value={labelEn} onChange={(e): void => setLabelEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="alpl">{t('attributes.field.labelPl')}</Label>
          <Input id="alpl" value={labelPl} onChange={(e): void => setLabelPl(e.target.value)} />
        </div>
      </div>
      {valueType === 'enum' || valueType === 'multiselect' ? (
        <div className="space-y-2">
          <Label htmlFor="aenum">{t('attributes.field.enumValues')}</Label>
          <Input
            id="aenum"
            value={enumValues}
            onChange={(e): void => setEnumValues(e.target.value)}
            placeholder={t('attributes.field.enumValuesPlaceholder')}
            required
          />
          <p className="text-xs text-muted-foreground">
            {valueType === 'multiselect'
              ? t('attributes.field.enumValues.help.multiselect')
              : t('attributes.field.enumValues.help.enum')}
          </p>
        </div>
      ) : null}
      {isNumeric ? (
        <div>
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={displayAsSlider}
              onChange={(e): void => setDisplayAsSlider(e.target.checked)}
            />
            {t('attributes.flag.displayAsSlider')}
          </label>
        </div>
      ) : null}
      <div className="space-y-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <Checkbox
            checked={isSearchable}
            onChange={(e): void => setIsSearchable(e.target.checked)}
          />
          {t('attributes.flag.searchable')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isFilterable}
            onChange={(e): void => setIsFilterable(e.target.checked)}
          />
          {t('attributes.flag.filterable')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isVariantAxis}
            onChange={(e): void => setIsVariantAxis(e.target.checked)}
          />
          {t('attributes.flag.variantAxis')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isComparable}
            onChange={(e): void => setIsComparable(e.target.checked)}
          />
          {t('attributes.flag.comparable')}
        </label>
      </div>
      <Button type="submit">{t('attributes.action.create')}</Button>
    </form>
  );
}
