import { useId, type DragEvent, type ReactNode } from 'react';
import { AlertCircle, GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  FORM_FIELD_TYPES,
  type FormDefinition,
  type FormDefinitionIssueCode,
  type FormField,
  type FormFieldType,
} from '@endora-commerce/contracts';
import { ReorderAnnouncer, useGroupedReorder, type GroupedReorderLabels } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  FIELD_TYPE_DRAG_FORMAT,
  moveField,
  moveSection,
  removeSection,
  setColumns,
  setText,
  setVisibility,
  textOf,
} from '../lib/definition-draft.js';
import { ConditionRuleEditor } from './ConditionRuleEditor.js';

/**
 * The builder's canvas (`specs/170-forms-module/` FR-015, FR-016, research R-19): the form's
 * sections in order, each a grid of one to three columns with its fields across their widths.
 *
 * Reordering is admin-kit's `useGroupedReorder` — fields within and across sections, sections among
 * themselves — by pointer, touch and the keyboard's grab mode, every move announced. A field type
 * dragged from the palette is a second kind of drop the hook does not know: each section accepts it
 * first and hands every other drop to the hook. The keyboard adds fields through each section's
 * *Add field* menu, so no addition needs a pointer.
 */
export interface BuilderCanvasProps {
  readonly definition: FormDefinition;
  /** The form's default language: the texts the canvas shows and edits. */
  readonly language: string;
  readonly selectedId: string | null;
  /** Publish refusals by element id (FR-011), shown beside their element. */
  readonly issues: ReadonlyMap<string, readonly FormDefinitionIssueCode[]>;
  readonly disabled?: boolean;
  readonly onChange: (next: FormDefinition) => void;
  readonly onSelect: (elementId: string) => void;
  readonly onAddField: (sectionId: string, type: FormFieldType, index?: number) => void;
  readonly onAddSection: () => void;
}

const GRID_COLUMNS: Record<1 | 2 | 3, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };
const SPAN: Record<number, string> = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3' };

function hasFieldType(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(FIELD_TYPE_DRAG_FORMAT);
}

export function BuilderCanvas(props: BuilderCanvasProps): ReactNode {
  const { definition, language, selectedId, issues, disabled = false, onChange, onSelect, onAddField, onAddSection } = props;
  const t = useTranslation('forms');
  const baseId = useId();
  const instructionsId = `${baseId}-instructions`;

  const sectionName = (sectionId: string): string =>
    t('canvas.section', { number: definition.sections.findIndex((section) => section.id === sectionId) + 1 });
  const fieldName = (field: FormField): string =>
    textOf(definition, language, `fields.${field.id}.label`) ||
    (field.type === 'section_break' ? textOf(definition, language, `fields.${field.id}.title`) : '') ||
    (field.type === 'content' || field.type === 'section_break' ? t(`fieldTypes.${field.type}`) : t('canvas.untitled'));
  const fieldById = new Map(definition.sections.flatMap((section) => section.fields.map((field) => [field.id, field])));

  const labels: GroupedReorderLabels = {
    itemGrabbed: (c) => t('reorder.itemGrabbed', { ...c }),
    itemMoved: (c) => t('reorder.itemMoved', { ...c }),
    itemDropped: (c) => t('reorder.itemDropped', { ...c }),
    itemCancelled: (c) => t('reorder.itemCancelled', { ...c }),
    groupGrabbed: (c) => t('reorder.groupGrabbed', { ...c }),
    groupMoved: (c) => t('reorder.groupMoved', { ...c }),
    groupDropped: (c) => t('reorder.groupDropped', { ...c }),
    groupCancelled: (c) => t('reorder.groupCancelled', { ...c }),
    atStart: (c) => t('reorder.atStart', c),
    atEnd: (c) => t('reorder.atEnd', c),
    itemHandle: (c) => t('reorder.itemHandle', c),
    groupHandle: (c) => t('reorder.groupHandle', c),
    roleDescription: t('reorder.roleDescription'),
  };

  const reorder = useGroupedReorder({
    model: { sections: definition.sections.map((section) => ({ key: section.id, itemIds: section.fields.map((field) => field.id) })) },
    getItemLabel: (id) => {
      const field = fieldById.get(id);
      return field ? fieldName(field) : id;
    },
    getSectionLabel: sectionName,
    onMoveItem: (id, toSectionKey, toIndex) => onChange(moveField(definition, id, toSectionKey, toIndex)),
    onMoveSection: (key, toIndex) => onChange(moveSection(definition, key, toIndex)),
    labels,
    disabled,
    instructionsId,
  });

  return (
    <div className="space-y-4">
      <ReorderAnnouncer message={reorder.announcement} instructions={t('canvas.instructions')} instructionsId={instructionsId} />
      {definition.sections.map((section) => {
        const name = sectionName(section.id);
        const hook = reorder.getSectionProps(section.id);
        const columnsId = `${baseId}-${section.id}-columns`;
        const titleId = `${baseId}-${section.id}-title`;
        const targeted = reorder.dropTarget === `section:${section.id}`;
        return (
          <section
            key={section.id}
            role="group"
            aria-label={name}
            className={cn(
              'space-y-3 rounded-lg border bg-card p-3',
              targeted ? 'border-primary' : 'border-border',
            )}
            onDragOver={(event) => {
              if (disabled) return;
              if (hasFieldType(event)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                return;
              }
              hook.onDragOver(event);
            }}
            onDragLeave={hook.onDragLeave}
            onDrop={(event) => {
              if (disabled) return;
              const type = event.dataTransfer?.getData(FIELD_TYPE_DRAG_FORMAT);
              if (type && (FORM_FIELD_TYPES as readonly string[]).includes(type)) {
                event.preventDefault();
                onAddField(section.id, type as FormFieldType);
                return;
              }
              hook.onDrop(event);
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <button
                {...reorder.getSectionHandleProps(section.id)}
                className="inline-flex h-9 w-7 cursor-grab items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
              >
                <GripVertical size={16} aria-hidden="true" />
              </button>
              <h3 className="self-center text-sm font-semibold">{name}</h3>
              <div className="min-w-40 flex-1 space-y-1">
                <Label htmlFor={titleId} className="text-xs">
                  {t('canvas.sectionTitle')}
                </Label>
                <Input
                  id={titleId}
                  value={textOf(definition, language, `sections.${section.id}.title`)}
                  disabled={disabled}
                  onChange={(event) => onChange(setText(definition, language, `sections.${section.id}.title`, event.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={columnsId} className="text-xs">
                  {t('canvas.columns')}
                </Label>
                <Select
                  id={columnsId}
                  value={section.columns}
                  disabled={disabled}
                  onChange={(event) => onChange(setColumns(definition, section.id, Number(event.target.value) as 1 | 2 | 3))}
                  className="w-20"
                >
                  {[1, 2, 3].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </Select>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={disabled}>
                    <Plus size={14} aria-hidden="true" />
                    {t('canvas.addField')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {FORM_FIELD_TYPES.map((type) => (
                    <DropdownMenuItem key={type} onSelect={() => onAddField(section.id, type)}>
                      {t(`fieldTypes.${type}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {definition.sections.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={t('canvas.removeSection', { name })}
                  onClick={() => onChange(removeSection(definition, section.id))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            <SectionRule
              definition={definition}
              language={language}
              sectionId={section.id}
              issueCodes={issues.get(section.id) ?? []}
              disabled={disabled}
              onChange={onChange}
            />
            {section.fields.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {t('canvas.empty')}
              </p>
            ) : (
              <ul className={cn('grid grid-cols-1 gap-2', GRID_COLUMNS[section.columns])}>
                {section.fields.map((field) => {
                  const label = fieldName(field);
                  const fieldIssues = issues.get(field.id) ?? [];
                  const selected = field.id === selectedId;
                  const issuesId = `${baseId}-${field.id}-issues`;
                  return (
                    <li
                      key={field.id}
                      data-field-label={label}
                      {...reorder.getItemProps(field.id)}
                      className={cn(
                        SPAN[Math.min(field.width, section.columns)],
                        'rounded-md border bg-background p-2',
                        selected ? 'border-primary ring-1 ring-primary' : fieldIssues.length > 0 ? 'border-destructive' : 'border-border',
                        reorder.dropTarget === field.id && 'border-t-4 border-t-primary',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <button
                          {...reorder.getItemHandleProps(field.id)}
                          className="inline-flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                        >
                          <GripVertical size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('canvas.edit', { name: label })}
                          aria-current={selected ? 'true' : undefined}
                          {...(fieldIssues.length > 0 ? { 'aria-describedby': issuesId } : {})}
                          onClick={() => onSelect(field.id)}
                          className="min-w-0 flex-1 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block truncate text-sm font-medium">
                            {label}
                            {'required' in field && field.required ? (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">({t('canvas.required')})</span>
                            ) : null}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {t(`fieldTypes.${field.type}`)}
                            {section.columns > 1 ? ` · ${t('canvas.width', { width: Math.min(field.width, section.columns), columns: section.columns })}` : ''}
                          </span>
                        </button>
                      </div>
                      {fieldIssues.length > 0 ? (
                        <div id={issuesId} className="mt-1 space-y-0.5">
                          {fieldIssues.map((code) => (
                            <p key={code} className="flex items-start gap-1 text-xs text-destructive">
                              <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                              <span>{t(`issues.${code}`)}</span>
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      <Button type="button" variant="outline" disabled={disabled} onClick={onAddSection}>
        <Plus size={14} aria-hidden="true" />
        {t('canvas.addSection')}
      </Button>
    </div>
  );
}

/**
 * A section's visibility rule (FR-030, US3-2): folded under a native disclosure — keyboard operable,
 * no state of its own — whose summary says whether the section is always shown, and which opens by
 * itself when the last publish refused something about the rule.
 */
function SectionRule(props: {
  readonly definition: FormDefinition;
  readonly language: string;
  readonly sectionId: string;
  readonly issueCodes: readonly FormDefinitionIssueCode[];
  readonly disabled: boolean;
  readonly onChange: (next: FormDefinition) => void;
}): ReactNode {
  const { definition, language, sectionId, issueCodes, disabled, onChange } = props;
  const t = useTranslation('forms');
  const section = definition.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return null;
  const count = section.visibility?.groups.flat().length ?? 0;
  const issues = issueCodes.map((code) => ({ code, elementId: sectionId, path: '' }));
  return (
    <details className="rounded-md border border-border px-2 py-1" open={issues.length > 0 || undefined}>
      <summary className="cursor-pointer text-xs font-medium">
        {count === 0 ? t('canvas.sectionRule.always') : t('canvas.sectionRule.conditional', { count })}
        {issues.length > 0 ? (
          <AlertCircle size={14} aria-label={t('canvas.sectionRule.attention')} className="ml-1 inline text-destructive" />
        ) : null}
      </summary>
      <div className="pt-2">
        <ConditionRuleEditor
          definition={definition}
          language={language}
          ownerId={sectionId}
          rule={section.visibility}
          issues={issues}
          disabled={disabled}
          onChange={(rule) => onChange(setVisibility(definition, sectionId, rule))}
        />
      </div>
    </details>
  );
}
