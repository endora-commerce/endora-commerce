import { useId, type DragEvent, type ReactNode } from 'react';
import { AlertCircle, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
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
  Card,
  CardContent,
  CardHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  FIELD_TYPE_DRAG_FORMAT,
  moveField,
  moveSection,
  removeSection,
  setColumns,
  setVisibility,
  textOf,
} from '../lib/definition-draft.js';
import { FIELD_TYPE_ICONS } from '../lib/field-icons.js';
import { ConditionRuleEditor } from './ConditionRuleEditor.js';
import { TranslatableText } from './TranslatableText.js';

/**
 * The builder's canvas (`specs/170-forms-module/` FR-015, FR-016, research R-19): the form's
 * sections in order, each a grid of one to three columns with its fields across their widths.
 *
 * Reordering is admin-kit's `useGroupedReorder` — fields within and across sections, sections among
 * themselves — by pointer, touch and the keyboard's grab mode, every move announced. A field type
 * dragged from the palette is a second kind of drop the hook does not know: each section accepts it
 * first and hands every other drop to the hook. The keyboard adds fields through each section's
 * *Add field* menu, so no addition needs a pointer.
 *
 * Each section is a card: its handle, name, columns and actions in the header, its title,
 * description and visibility rule above its fields. Each field is a bordered row with its type's
 * icon; the row being edited is marked by more than colour — an accent bar, a pencil and the word
 * *Editing* — and by `aria-current`.
 *
 * The canvas speaks the builder's content language (User Story 7). In another language than the
 * default only the section texts are editable; moving, adding and removing, the columns and the
 * rules are the default language's, so they are disabled there.
 */
export interface BuilderCanvasProps {
  readonly definition: FormDefinition;
  /** The content language: the texts the canvas shows and edits. */
  readonly language: string;
  /** The form's default language; the structure is editable only in it. Defaults to `language`. */
  readonly defaultLanguage?: string;
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
  const defaultLanguage = props.defaultLanguage ?? language;
  const t = useTranslation('forms');
  const baseId = useId();
  const instructionsId = `${baseId}-instructions`;
  // In another language the structure is locked: only the texts are that language's.
  const locked = disabled || language !== defaultLanguage;
  const shown = (textId: string): string => textOf(definition, language, textId) || textOf(definition, defaultLanguage, textId);

  const sectionName = (sectionId: string): string =>
    t('canvas.section', { number: definition.sections.findIndex((section) => section.id === sectionId) + 1 });
  const fieldName = (field: FormField): string =>
    shown(`fields.${field.id}.label`) ||
    (field.type === 'section_break' ? shown(`fields.${field.id}.title`) : '') ||
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
    disabled: locked,
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
          <Card
            key={section.id}
            role="group"
            aria-label={name}
            className={cn('transition-colors', targeted ? 'border-primary ring-1 ring-primary' : '')}
            onDragOver={(event) => {
              if (locked) return;
              if (hasFieldType(event)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                return;
              }
              hook.onDragOver(event);
            }}
            onDragLeave={hook.onDragLeave}
            onDrop={(event) => {
              if (locked) return;
              const type = event.dataTransfer?.getData(FIELD_TYPE_DRAG_FORMAT);
              if (type && (FORM_FIELD_TYPES as readonly string[]).includes(type)) {
                event.preventDefault();
                onAddField(section.id, type as FormFieldType);
                return;
              }
              hook.onDrop(event);
            }}
          >
            <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 border-b border-border px-4 py-3">
              <button
                {...reorder.getSectionHandleProps(section.id)}
                className="inline-flex h-9 w-7 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GripVertical size={16} aria-hidden="true" />
              </button>
              <h3 className="mr-auto text-sm font-semibold">{name}</h3>
              <div className="flex items-center gap-2">
                <Label htmlFor={columnsId} className="text-xs text-muted-foreground">
                  {t('canvas.columns')}
                </Label>
                <Select
                  id={columnsId}
                  value={section.columns}
                  disabled={locked}
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
              {/* Not modal: a modal menu locks the body's scroll, which clips this long page to the
                  viewport and throws the operator back to its top. Capped to the room on screen, so
                  the list never lands under the pointer that opened it. */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={locked}>
                    <Plus size={14} aria-hidden="true" />
                    {t('canvas.addField')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  collisionPadding={8}
                  className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
                >
                  {FORM_FIELD_TYPES.map((type) => {
                    const Icon = FIELD_TYPE_ICONS[type];
                    return (
                      <DropdownMenuItem key={type} onSelect={() => onAddField(section.id, type)}>
                        <Icon size={14} aria-hidden="true" className="mr-2 text-muted-foreground" />
                        {t(`fieldTypes.${type}`)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              {definition.sections.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  aria-label={t('canvas.removeSection', { name })}
                  onClick={() => onChange(removeSection(definition, section.id))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <TranslatableText
                  id={titleId}
                  label={t('canvas.sectionTitle')}
                  definition={definition}
                  language={language}
                  defaultLanguage={defaultLanguage}
                  textId={`sections.${section.id}.title`}
                  disabled={disabled}
                  onChange={onChange}
                />
                <TranslatableText
                  id={`${baseId}-${section.id}-description`}
                  label={t('canvas.sectionDescription')}
                  definition={definition}
                  language={language}
                  defaultLanguage={defaultLanguage}
                  textId={`sections.${section.id}.description`}
                  disabled={disabled}
                  onChange={onChange}
                />
              </div>
              <SectionRule
                definition={definition}
                language={defaultLanguage}
                sectionId={section.id}
                issueCodes={issues.get(section.id) ?? []}
                disabled={locked}
                onChange={onChange}
              />
              {section.fields.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  {locked && !disabled ? t('canvas.emptyLocked') : t('canvas.empty')}
                </p>
              ) : (
                <ul className={cn('grid grid-cols-1 gap-2', GRID_COLUMNS[section.columns])}>
                  {section.fields.map((field) => {
                    const label = fieldName(field);
                    const fieldIssues = issues.get(field.id) ?? [];
                    const selected = field.id === selectedId;
                    const issuesId = `${baseId}-${field.id}-issues`;
                    const Icon = FIELD_TYPE_ICONS[field.type];
                    return (
                      <li
                        key={field.id}
                        data-field-label={label}
                        {...reorder.getItemProps(field.id)}
                        className={cn(
                          SPAN[Math.min(field.width, section.columns)],
                          'group rounded-md border bg-background p-1.5 transition-colors',
                          selected
                            ? 'border-primary border-l-4 bg-primary/5'
                            : fieldIssues.length > 0
                              ? 'border-destructive hover:bg-muted/50'
                              : 'border-border hover:border-primary/50 hover:bg-muted/50',
                          reorder.dropTarget === field.id && 'border-t-4 border-t-primary',
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <button
                            {...reorder.getItemHandleProps(field.id)}
                            className="inline-flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <GripVertical size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('canvas.edit', { name: label })}
                            aria-current={selected ? 'true' : undefined}
                            {...(fieldIssues.length > 0 ? { 'aria-describedby': issuesId } : {})}
                            onClick={() => onSelect(field.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Icon size={16} aria-hidden="true" className={cn('shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {label}
                                {'required' in field && field.required ? (
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">({t('canvas.required')})</span>
                                ) : null}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {t(`fieldTypes.${field.type}`)}
                                {section.columns > 1
                                  ? ` · ${t('canvas.width', { width: Math.min(field.width, section.columns), columns: section.columns })}`
                                  : ''}
                              </span>
                            </span>
                            {selected ? (
                              <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                                <Pencil size={12} />
                                {t('canvas.selected')}
                              </span>
                            ) : null}
                          </button>
                        </div>
                        {fieldIssues.length > 0 ? (
                          <div id={issuesId} className="mt-1 space-y-0.5 px-1">
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
            </CardContent>
          </Card>
        );
      })}
      <Button type="button" variant="outline" className="w-full border-dashed" disabled={locked} onClick={onAddSection}>
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
    <details className="rounded-md border border-border bg-muted/30 px-3 py-2" open={issues.length > 0 || undefined}>
      <summary className="cursor-pointer rounded text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
