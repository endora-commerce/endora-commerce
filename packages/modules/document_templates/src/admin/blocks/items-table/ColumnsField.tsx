import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { ITEMS_TABLE_LIMITS, type DocumentFieldDefinition } from '@endora-commerce/contracts';
import { Button, Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { InternalBadge, FieldPicker } from './FieldPicker.js';
import { newColumnId, NO_FIELDS, useCollection } from './collections-context.js';
import { asList, asRecord, FieldName, opOf, text, useListReorder, type Entry } from './shared.js';

/**
 * The Line items table's **Columns** field
 * (`specs/153-quote-request-pdf-template/contracts/admin-ui.md` §2): an ordered
 * list of columns, each showing its field (or *Unknown field*, FR-037), its
 * header, an **Internal** badge where it prints a value customers do not
 * otherwise see (owner answer Q7), and Edit, Move up / Move down and Remove. A
 * column's settings open inline. At most 16; the last column cannot be removed.
 *
 * Issue #1904 — a column whose field declares the page it may link to
 * (`DocumentFieldDefinition.linkPath`) offers *Print as a link*; off unless
 * ticked, and a column that never had it stores nothing new.
 */
export interface ColumnsFieldProps {
  readonly value: unknown;
  readonly onChange: (next: Entry[]) => void;
  readonly readOnly?: boolean;
}

const VISIBILITY = ['always', 'any_has_value', 'never'] as const;
const VISIBILITY_KEY: Record<(typeof VISIBILITY)[number], string> = {
  always: 'itemsTable.visibility.always',
  any_has_value: 'itemsTable.visibility.anyHasValue',
  never: 'itemsTable.visibility.never',
};

function visibilityKey(rule: unknown): string {
  const op = opOf(rule, 'always');
  return (VISIBILITY as readonly string[]).includes(op) ? VISIBILITY_KEY[op as (typeof VISIBILITY)[number]] : VISIBILITY_KEY.always;
}

export function ColumnsField({ value, onChange, readOnly = false }: ColumnsFieldProps): ReactNode {
  const t = useTranslation('document_templates');
  const collection = useCollection();
  const fields = collection?.fields ?? NO_FIELDS;
  const byPath = useMemo(() => new Map(fields.map((field) => [field.path, field])), [fields]);
  const columns = asList(value);
  const [editing, setEditing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const atLimit = columns.length >= ITEMS_TABLE_LIMITS.maxColumns;

  const nameOf = useCallback(
    (column: Entry): string => {
      const path = text(column['field']);
      return text(column['label']).trim() || byPath.get(path)?.label || path;
    },
    [byPath],
  );
  const { announcer, buttons } = useListReorder(columns, nameOf, onChange, readOnly);

  const update = (index: number, patch: Entry): void => {
    onChange(columns.map((column, i) => (i === index ? { ...column, ...patch } : column)));
  };
  const add = (field: DocumentFieldDefinition): void => {
    const ids = columns.map((column) => text(column['id']));
    onChange([
      ...columns,
      {
        id: newColumnId(ids),
        field: field.path,
        label: '',
        width: 'auto',
        align: 'auto',
        format: { ...(field.defaultFormat ?? {}) },
        emptyText: '',
        visibleWhen: { op: 'always' },
      },
    ]);
    setPicking(false);
  };

  return (
    <div className="space-y-2">
      {announcer}
      <p className="text-sm font-medium">{t('itemsTable.columns.title')}</p>
      {columns.length === 0 ? <p className="text-sm text-muted-foreground">{t('itemsTable.columns.empty')}</p> : null}
      <ol className="space-y-2">
        {columns.map((column, index) => {
          const path = text(column['field']);
          const field = byPath.get(path);
          const name = nameOf(column);
          const open = editing === index;
          return (
            <li key={`${index}:${text(column['id'])}`} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  <FieldName field={field} path={path} />
                  {text(column['label']).trim() !== '' ? (
                    <span className="ml-1 text-muted-foreground">“{text(column['label'])}”</span>
                  ) : null}
                  <span className="ml-1 text-xs text-muted-foreground">· {t(visibilityKey(column['visibleWhen']))}</span>
                </div>
                {field?.audience === 'internal' ? <InternalBadge /> : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={open}
                  aria-label={t('itemsTable.columns.edit', { name })}
                  onClick={() => setEditing(open ? null : index)}
                  disabled={readOnly}
                >
                  {open ? t('itemsTable.columns.done') : t('itemsTable.columns.editShort')}
                </Button>
                {buttons(index)}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('itemsTable.columns.remove', { name })}
                  title={columns.length <= 1 ? t('itemsTable.columns.lastColumn') : undefined}
                  disabled={readOnly || columns.length <= 1}
                  onClick={() => {
                    onChange(columns.filter((_, i) => i !== index));
                    setEditing(null);
                  }}
                >
                  ×
                </Button>
              </div>
              {open ? (
                <ColumnEditor
                  column={column}
                  field={field}
                  linkTarget={field?.linkPath ? byPath.get(field.linkPath) : undefined}
                  onChange={(patch) => update(index, patch)}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {picking ? (
        <FieldPicker fields={fields} onPick={add} onCancel={() => setPicking(false)} />
      ) : (
        <div className="space-y-1">
          <Button type="button" variant="outline" size="sm" disabled={readOnly || atLimit || fields.length === 0} onClick={() => setPicking(true)}>
            {t('itemsTable.columns.add')}
          </Button>
          {atLimit ? <p className="text-xs text-muted-foreground">{t('itemsTable.columns.limit', { max: ITEMS_TABLE_LIMITS.maxColumns })}</p> : null}
        </div>
      )}
    </div>
  );
}

function ColumnEditor({
  column,
  field,
  linkTarget,
  onChange,
}: {
  column: Entry;
  field: DocumentFieldDefinition | undefined;
  /** The field holding the page this column's field may link to; absent = no link option. */
  linkTarget: DocumentFieldDefinition | undefined;
  onChange: (patch: Entry) => void;
}): ReactNode {
  const t = useTranslation('document_templates');
  const base = useId();
  const width = column['width'];
  const widthMode = width === 'fill' ? 'fill' : typeof width === 'number' ? 'fixed' : 'auto';
  const format = asRecord(column['format']);
  const kind = field?.valueKind;
  const visibility = opOf(column['visibleWhen'], 'always');
  const setFormat = (patch: Entry): void => {
    const next: Entry = { ...format, ...patch };
    for (const key of Object.keys(next)) if (next[key] === '' || next[key] === undefined) delete next[key];
    onChange({ format: next });
  };
  return (
    <div className="mt-2 grid gap-2 border-t pt-2">
      <div>
        <Label htmlFor={`${base}-label`}>{t('itemsTable.columns.label')}</Label>
        <Input
          id={`${base}-label`}
          value={text(column['label'])}
          placeholder={field?.label ?? ''}
          maxLength={ITEMS_TABLE_LIMITS.maxLabelLength}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${base}-width`}>{t('itemsTable.columns.width')}</Label>
          <Select
            id={`${base}-width`}
            value={widthMode}
            onChange={(event) => {
              const mode = event.target.value;
              onChange({ width: mode === 'fixed' ? 80 : mode });
            }}
          >
            <option value="auto">{t('itemsTable.columns.width.auto')}</option>
            <option value="fill">{t('itemsTable.columns.width.fill')}</option>
            <option value="fixed">{t('itemsTable.columns.width.fixed')}</option>
          </Select>
        </div>
        {widthMode === 'fixed' ? (
          <div>
            <Label htmlFor={`${base}-points`}>{t('itemsTable.columns.widthPoints')}</Label>
            <Input
              id={`${base}-points`}
              type="number"
              min={10}
              max={400}
              value={typeof width === 'number' ? width : 80}
              onChange={(event) => {
                const n = Number(event.target.value);
                if (Number.isFinite(n)) onChange({ width: Math.min(400, Math.max(10, n)) });
              }}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor={`${base}-align`}>{t('itemsTable.columns.align')}</Label>
          <Select id={`${base}-align`} value={text(column['align'], 'auto')} onChange={(event) => onChange({ align: event.target.value })}>
            {(['auto', 'left', 'center', 'right'] as const).map((align) => (
              <option key={align} value={align}>
                {t(`itemsTable.columns.align.${align}`)}
              </option>
            ))}
          </Select>
        </div>
        {kind === 'number' || kind === 'money' || kind === 'percent' ? (
          <div>
            <Label htmlFor={`${base}-decimals`}>{t('itemsTable.columns.format.decimals')}</Label>
            <Select
              id={`${base}-decimals`}
              value={typeof format['decimals'] === 'number' ? String(format['decimals']) : ''}
              onChange={(event) => setFormat({ decimals: event.target.value === '' ? undefined : Number(event.target.value) })}
            >
              <option value="">{t('itemsTable.columns.align.auto')}</option>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {kind === 'money' ? (
          <div>
            <Label htmlFor={`${base}-currency`}>{t('itemsTable.columns.format.currencyDisplay')}</Label>
            <Select
              id={`${base}-currency`}
              value={text(format['currencyDisplay'], 'symbol')}
              onChange={(event) => setFormat({ currencyDisplay: event.target.value })}
            >
              {(['symbol', 'code', 'none'] as const).map((display) => (
                <option key={display} value={display}>
                  {t(`itemsTable.columns.format.currencyDisplay.${display}`)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {kind === 'date' ? (
          <div>
            <Label htmlFor={`${base}-date`}>{t('itemsTable.columns.format.dateStyle')}</Label>
            <Select id={`${base}-date`} value={text(format['dateStyle'], 'medium')} onChange={(event) => setFormat({ dateStyle: event.target.value })}>
              {(['short', 'medium', 'long'] as const).map((style) => (
                <option key={style} value={style}>
                  {t(`itemsTable.columns.format.dateStyle.${style}`)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      <div>
        <Label htmlFor={`${base}-empty`}>{t('itemsTable.columns.emptyText')}</Label>
        <Input
          id={`${base}-empty`}
          value={text(column['emptyText'])}
          maxLength={ITEMS_TABLE_LIMITS.maxEmptyTextLength}
          onChange={(event) => onChange({ emptyText: event.target.value })}
        />
      </div>
      {linkTarget ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={column['link'] === true || column['link'] === 'true'}
            onChange={(event) => onChange({ link: event.target.checked })}
          />
          {t('itemsTable.columns.link', { field: linkTarget.label })}
        </label>
      ) : null}
      <fieldset>
        <legend className="text-sm font-medium">{t('itemsTable.visibility')}</legend>
        {VISIBILITY.map((op) => (
          <label key={op} className="mr-3 inline-flex items-center gap-1 text-sm">
            <input
              type="radio"
              name={`${base}-visibility`}
              value={op}
              checked={visibility === op}
              onChange={() => onChange({ visibleWhen: { op } })}
            />
            {t(VISIBILITY_KEY[op])}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
