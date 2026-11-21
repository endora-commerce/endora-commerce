import { useId, useState, type ReactNode } from 'react';
import type { DocumentTemplateSummary } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { Button, Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Create a template, or duplicate one (FR-003, FR-004): a name, a scope — all
 * channels or one — fixed for good once created, the source (the built-in
 * layout or a template of the same type) and an explicit *Set as default*,
 * unticked: a new template changes no document until it is made the default.
 *
 * Issue #1535 (UX audit CONTENT-18) — the list's one *New template* opens this
 * dialog with the **document type** as its first question, preselected to the
 * type the list was opened on (Tesler: what the screen knows is not asked) and
 * not asked at all when only one type is available. A duplicate, or *Create
 * from this* on a type's built-in layout, fixes the type and does not show it.
 */
export interface NewTemplateValues {
  readonly documentType: string;
  readonly name: string;
  readonly salesChannelId: string | null;
  readonly sourceTemplateId: string | null;
  readonly setDefault: boolean;
}

export interface NewTemplateDialogType {
  readonly code: string;
  readonly label: string;
  readonly templates: readonly DocumentTemplateSummary[];
}

export interface NewTemplateDialogProps {
  readonly channels: readonly { id: string; name: string }[];
  /** The types a template can be created for. */
  readonly types: readonly NewTemplateDialogType[];
  /** The type selected when the dialog opens. */
  readonly initialType: string;
  /** Whether the type is fixed — a duplicate or a start from a type's built-in layout. */
  readonly typeFixed: boolean;
  readonly initialSource: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (values: NewTemplateValues) => void;
  readonly onClose: () => void;
}

export function NewTemplateDialog(props: NewTemplateDialogProps): ReactNode {
  const { channels, types, initialType, typeFixed, initialSource, busy, error, onSubmit, onClose } = props;
  const t = useTranslation('document_templates');
  const ids = {
    type: useId(),
    name: useId(),
    scope: useId(),
    scopeHint: useId(),
    source: useId(),
    setDefault: useId(),
    error: useId(),
  };
  const [documentType, setDocumentType] = useState<string>(initialType);
  const templates = types.find((type) => type.code === documentType)?.templates ?? [];
  const sourceName = templates.find((template) => template.id === initialSource)?.name;
  const [name, setName] = useState(sourceName ? t('dialog.copyOf', { name: sourceName }) : '');
  const [scope, setScope] = useState<string>('global');
  const [source, setSource] = useState<string>(initialSource ?? 'built_in');
  const [setDefault, setSetDefault] = useState(false);
  const askType = !typeFixed && types.length > 1;

  return (
    <ModalDialog
      title={initialSource ? t('dialog.duplicateTitle') : t('dialog.newTitle')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('dialog.cancel')}
          </Button>
          <Button
            disabled={busy || name.trim() === ''}
            aria-busy={busy || undefined}
            onClick={() =>
              onSubmit({
                documentType,
                name: name.trim(),
                salesChannelId: scope === 'global' ? null : scope,
                sourceTemplateId: source === 'built_in' ? null : source,
                setDefault,
              })
            }
          >
            {t('dialog.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {askType ? (
          <div className="space-y-1">
            <Label htmlFor={ids.type}>{t('dialog.documentType')}</Label>
            <Select
              id={ids.type}
              value={documentType}
              onChange={(event) => {
                setDocumentType(event.target.value);
                // A source is a template of the chosen type: another type starts from its built-in layout.
                setSource('built_in');
              }}
            >
              {types.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={ids.name}>{t('dialog.name')}</Label>
          <Input
            id={ids.name}
            value={name}
            maxLength={200}
            aria-describedby={error ? ids.error : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.scope}>{t('dialog.scope')}</Label>
          <Select id={ids.scope} aria-describedby={ids.scopeHint} value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="global">{t('page.allChannels')}</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </Select>
          <p id={ids.scopeHint} className="text-xs text-muted-foreground">
            {t('dialog.scopeHint')}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.source}>{t('dialog.source')}</Label>
          <Select id={ids.source} value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="built_in">{t('page.builtIn')}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id={ids.setDefault} checked={setDefault} onChange={(event) => setSetDefault(event.target.checked)} />
          <Label htmlFor={ids.setDefault}>{t('dialog.setDefault')}</Label>
        </div>
        {error ? (
          <p id={ids.error} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </ModalDialog>
  );
}
