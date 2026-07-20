import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { customFieldsClient } from './api/custom-fields-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  CustomFieldDefinitionDto,
  CustomFieldValueType,
  SupportedEntityType,
} from '@b2b/contracts';

const ENTITY_TYPES: SupportedEntityType[] = [
  'category',
  'order',
  'organization',
  'customer',
  'quote_request',
];
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
  const t = useTranslation('core');
  const [entityType, setEntityType] = useState<SupportedEntityType>('organization');
  const [rows, setRows] = useState<CustomFieldDefinitionDto[]>([]);
  const [error, setError] = useState<string | null>(null);

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
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </Select>
        </div>
      </div>

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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void run(() => customFieldsClient.remove(d.id))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

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
        </CardContent>
      </Card>
    </div>
  );
}
