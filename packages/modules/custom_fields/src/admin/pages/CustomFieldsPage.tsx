import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  CustomFieldValueType,
  SupportedEntityType,
} from '@endora-commerce/contracts';

/** Pre-API fallback so the page renders before the entity-types fetch resolves. */
const FALLBACK_ENTITY_TYPES: CustomFieldEntityTypeInfo[] = (
  ['category', 'order', 'organization', 'customer', 'quote_request'] as SupportedEntityType[]
).map((entityType) => ({
  entityType,
  labelKey: `customFields.entity.${entityType === 'quote_request' ? 'quoteRequest' : entityType}`,
}));
const VALUE_TYPES: CustomFieldValueType[] = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
];
const SELECT_TYPES = new Set<CustomFieldValueType>(['select', 'multiselect']);

/** Custom-field definition management (feature 055). List + create per entity type. */
export function CustomFieldsPage(): ReactNode {
  // One namespace, this module's own (feature 091, R8). The screen used to
  // read `customFields.title` and `customFields.description` out of the shared
  // `core` bundle beside four keys of its own; both were already written in
  // this module's `i18n/{en,pl}.json`, so the `core` reader was a second copy
  // of two strings and nothing else. `customFields.title` and
  // `customFields.save` stay in `_i18n` because
  // `@endora-commerce/admin-kit`'s `CustomFieldValuesPanel` renders them, and a
  // kit component reads the shared namespace by construction.
  const t = useTranslation('custom_fields');
  const [entityTypes, setEntityTypes] = useState<CustomFieldEntityTypeInfo[]>(
    FALLBACK_ENTITY_TYPES,
  );
  const [entityType, setEntityType] = useState<SupportedEntityType>('organization');
  const [rows, setRows] = useState<CustomFieldDefinitionDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Host-managed marker for the selected type (feature 061): definitions are
  // rendered read-only with a link to the owning module's surface.
  const managedBy = entityTypes.find((i) => i.entityType === entityType)?.managedBy;

  // New-definition form state.
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [valueType, setValueType] = useState<CustomFieldValueType>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setRows(await customFieldsClient.list(entityType));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    }
  }, [entityType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        setEntityTypes(await customFieldsClient.listEntityTypes());
      } catch {
        // Keep the static fallback; the definitions list still works.
      }
    })();
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Action failed.');
      }
    },
    [refresh],
  );

  const submit = (): void => {
    const opts = SELECT_TYPES.has(valueType)
      ? options
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((value, i) => ({
            value,
            label: {},
            labelDefault: value,
            isDefault: false,
            sortOrder: i,
          }))
      : [];
    void run(async () => {
      await customFieldsClient.create({
        entityType,
        key: key.trim(),
        label: label.trim() ? { en: label.trim() } : {},
        labelDefault: label.trim() || key.trim(),
        valueType,
        required,
        sortOrder: rows.length,
        config: {},
        options: opts,
      });
      setKey('');
      setLabel('');
      setOptions('');
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('customFields.title')} description={t('customFields.description')} />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="entity">Entity</Label>
          <Select
            id="entity"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as SupportedEntityType)}
          >
            {entityTypes.map((info) => (
              <option key={info.entityType} value={info.entityType}>
                {t(info.labelKey)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {managedBy && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('customFields.managedBy.notice')}</span>
            <Link to={managedBy.route} className="font-medium underline underline-offset-4">
              {t(managedBy.labelKey)}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Options</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.key}</TableCell>
                  <TableCell>{d.label['en'] ?? d.labelDefault}</TableCell>
                  <TableCell>{d.valueType}</TableCell>
                  <TableCell>
                    <Badge variant={d.required ? 'default' : 'secondary'}>
                      {d.required ? 'required' : 'optional'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {d.options.map((o) => o.value).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    {!managedBy && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void run(() => customFieldsClient.remove(d.id))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!managedBy && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="key">Key</Label>
              <input
                id="key"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="po_number"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="label">Label (EN)</Label>
              <input
                id="label"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vt">Type</Label>
              <Select
                id="vt"
                value={valueType}
                onChange={(e) => setValueType(e.target.value as CustomFieldValueType)}
              >
                {VALUE_TYPES.map((vt) => (
                  <option key={vt} value={vt}>
                    {vt}
                  </option>
                ))}
              </Select>
            </div>
            {SELECT_TYPES.has(valueType) && (
              <div className="space-y-1">
                <Label htmlFor="opts">Options (comma-separated)</Label>
                <input
                  id="opts"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="gold, silver"
                />
              </div>
            )}
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
              Required
            </label>
            <Button size="sm" disabled={!key.trim()} onClick={submit}>
              Add field
            </Button>
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CustomFieldsPage;
