import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FileCheck, Plus } from 'lucide-react';
import { ApiError, formatDateTime } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import {
  ConfirmDialog,
  ContentLanguageTabs,
  ModalDialog,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  SalesChannelPicker,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { LANGUAGE_FALLBACK, SUPPORTED_LANGUAGES, type ReturnCaseClauseDto } from '@endora-commerce/contracts';
import { returnsClient, type ClauseBody } from '../api/returns-client.js';

const LANGUAGES: string[] = [...SUPPORTED_LANGUAGES];
const TEXT_MAX = 5000;

type Draft = {
  label: Record<string, string>;
  text: Record<string, string>;
  linkUrl: Record<string, string>;
  appliesTo: ReturnCaseClauseDto['appliesTo'];
  mode: ReturnCaseClauseDto['mode'];
  salesChannelId: string | null;
  weight: number;
  isActive: boolean;
};

const EMPTY: Draft = {
  label: {},
  text: {},
  linkUrl: {},
  appliesTo: 'both',
  mode: 'must_accept',
  salesChannelId: null,
  weight: 100,
  isActive: true,
};

/** The non-empty entries of a per-language map. */
function filled(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
}

/**
 * The clauses shown on the returns form (`specs/180-off-platform-complaints/` FR-B30 –
 * FR-B32, D-1, D-10; design review R-9): per-language label, text and an optional link,
 * the kinds and the channel they apply to, and whether the customer must accept them.
 */
export function ReturnClausesPage(): ReactNode {
  const tr = useTranslation('returns');
  const [clauses, setClauses] = useState<ReturnCaseClauseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ clause: ReturnCaseClauseDto | null } | null>(null);
  const [deleting, setDeleting] = useState<ReturnCaseClauseDto | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setClauses(await returnsClient.clauses());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tr('clauses.error.load'));
    }
  }, [tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const columns: ResponsiveColumn<ReturnCaseClauseDto>[] = [
    {
      id: 'label',
      header: tr('clauses.col.label'),
      primary: true,
      render: (c) => {
        const missing = LANGUAGES.filter((l) => !c.label[l] || !c.text[l]);
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span>{c.label[LANGUAGE_FALLBACK] ?? Object.values(c.label)[0]}</span>
            {missing.length > 0 && (
              <Badge variant="outline">{tr('clauses.missingLanguages', { languages: missing.join(', ') })}</Badge>
            )}
          </span>
        );
      },
    },
    {
      id: 'channel',
      header: tr('clauses.col.channel'),
      render: (c) => (c.salesChannelId ? <span className="font-mono text-xs">{c.salesChannelId}</span> : tr('clauses.allChannels')),
    },
    { id: 'appliesTo', header: tr('clauses.col.appliesTo'), render: (c) => tr(`clauses.appliesTo.${c.appliesTo}`) },
    { id: 'mode', header: tr('clauses.col.mode'), render: (c) => tr(`clauses.mode.${c.mode}`) },
    { id: 'active', header: tr('clauses.col.active'), render: (c) => (c.isActive ? tr('clauses.yes') : tr('clauses.no')) },
    { id: 'revision', header: tr('clauses.col.revision'), hideOnMobile: true, render: (c) => c.revision },
    { id: 'updated', header: tr('clauses.col.updated'), hideOnMobile: true, render: (c) => formatDateTime(c.updatedAt) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={tr('clauses.title')}
        actions={
          <Button ref={addRef} size="sm" onClick={() => setEditing({ clause: null })}>
            <Plus />
            {tr('clauses.add')}
          </Button>
        }
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent>
          {clauses === null ? null : (
            <ResponsiveTable
              data={clauses}
              keyExtractor={(c) => c.id}
              columns={columns}
              emptyState={
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileCheck className="size-4" aria-hidden="true" />
                  {tr('clauses.empty')}
                </p>
              }
              renderActions={(c) => (
                <RowActionMenu label={tr('clauses.actions', { label: c.label[LANGUAGE_FALLBACK] ?? '' })}>
                  <RowActionMenuItem onSelect={() => setEditing({ clause: c })}>{tr('clauses.edit')}</RowActionMenuItem>
                  <RowActionMenuItem destructive onSelect={() => setDeleting(c)}>
                    {tr('clauses.delete')}
                  </RowActionMenuItem>
                </RowActionMenu>
              )}
            />
          )}
        </CardContent>
      </Card>

      {editing && (
        <ClauseDialog
          clause={editing.clause}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={tr('clauses.deleteTitle')}
          message={tr('clauses.deleteMessage')}
          confirmLabel={tr('clauses.delete')}
          cancelLabel={tr('clauses.cancel')}
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            void (async () => {
              try {
                await returnsClient.deleteClause(deleting.id);
                setDeleting(null);
                await refresh();
              } catch (err) {
                setDeleting(null);
                setError(err instanceof ApiError ? err.envelope.error.message : tr('clauses.error.action'));
              }
            })()
          }
        />
      )}
    </div>
  );
}

function ClauseDialog(props: {
  clause: ReturnCaseClauseDto | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const tr = useTranslation('returns');
  const { clause } = props;
  const [draft, setDraft] = useState<Draft>(
    clause
      ? {
          label: { ...clause.label },
          text: { ...clause.text },
          linkUrl: { ...(clause.linkUrl ?? {}) },
          appliesTo: clause.appliesTo,
          mode: clause.mode,
          salesChannelId: clause.salesChannelId,
          weight: clause.weight,
          isActive: clause.isActive,
        }
      : EMPTY,
  );
  const [language, setLanguage] = useState<string>(LANGUAGE_FALLBACK);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  const setLocalized = (key: 'label' | 'text' | 'linkUrl', value: string): void =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], [language]: value } }));

  const save = async (): Promise<void> => {
    // The default language is required: show it, and put the cursor where it is missing.
    if (!draft.label[LANGUAGE_FALLBACK]?.trim() || !draft.text[LANGUAGE_FALLBACK]?.trim()) {
      setError(tr('clauses.error.defaultLanguage', { language: LANGUAGE_FALLBACK }));
      setLanguage(LANGUAGE_FALLBACK);
      window.setTimeout(() => labelRef.current?.focus(), 0);
      return;
    }
    const links = filled(draft.linkUrl);
    const body: ClauseBody = {
      label: filled(draft.label),
      text: filled(draft.text),
      linkUrl: Object.keys(links).length > 0 ? links : null,
      appliesTo: draft.appliesTo,
      mode: draft.mode,
      salesChannelId: draft.salesChannelId,
      weight: draft.weight,
      isActive: draft.isActive,
    };
    setBusy(true);
    setError(null);
    try {
      if (clause) await returnsClient.updateClause(clause.id, body);
      else await returnsClient.createClause(body);
      await props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tr('clauses.error.action'));
    } finally {
      setBusy(false);
    }
  };

  const text = draft.text[language] ?? '';
  return (
    <ModalDialog
      title={clause ? tr('clauses.dialog.edit') : tr('clauses.dialog.create')}
      onClose={props.onClose}
      busy={busy}
      initialFocusRef={labelRef}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>
            {tr('clauses.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {tr('clauses.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {clause?.isActive && (
          <Alert variant="warning">
            <AlertDescription>{tr('clauses.revisionWarning', { next: clause.revision + 1 })}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ContentLanguageTabs languages={LANGUAGES} activeLanguage={language} onChange={setLanguage} />
        <div className="space-y-1">
          <Label htmlFor="clause-label">{tr('clauses.field.label')}</Label>
          <Input
            id="clause-label"
            ref={labelRef}
            maxLength={120}
            value={draft.label[language] ?? ''}
            onChange={(e) => setLocalized('label', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="clause-text">{tr('clauses.field.text')}</Label>
          <Textarea
            id="clause-text"
            maxLength={TEXT_MAX}
            rows={6}
            value={text}
            onChange={(e) => setLocalized('text', e.target.value)}
            aria-describedby="clause-text-counter"
          />
          <p id="clause-text-counter" className="text-xs text-muted-foreground">
            {tr('clauses.counter', { count: text.length, max: TEXT_MAX })}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="clause-link">{tr('clauses.field.linkUrl')}</Label>
          <Input
            id="clause-link"
            type="url"
            inputMode="url"
            placeholder={tr('clauses.field.linkUrlPlaceholder')}
            value={draft.linkUrl[language] ?? ''}
            onChange={(e) => setLocalized('linkUrl', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="clause-channel">{tr('clauses.field.channel')}</Label>
          <SalesChannelPicker
            id="clause-channel"
            value={draft.salesChannelId}
            onChange={(salesChannelId) => setDraft((d) => ({ ...d, salesChannelId }))}
            clearable
            placeholder={tr('clauses.allChannels')}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="clause-applies">{tr('clauses.field.appliesTo')}</Label>
            <Select
              id="clause-applies"
              value={draft.appliesTo}
              onChange={(e) => setDraft((d) => ({ ...d, appliesTo: e.target.value as Draft['appliesTo'] }))}
            >
              {(['both', 'complaint', 'return'] as const).map((v) => (
                <option key={v} value={v}>
                  {tr(`clauses.appliesTo.${v}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="clause-mode">{tr('clauses.field.mode')}</Label>
            <Select
              id="clause-mode"
              value={draft.mode}
              onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value as Draft['mode'] }))}
            >
              {(['must_accept', 'inform_only'] as const).map((v) => (
                <option key={v} value={v}>
                  {tr(`clauses.mode.${v}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="clause-weight">{tr('clauses.field.weight')}</Label>
            <Input
              id="clause-weight"
              type="number"
              value={draft.weight}
              onChange={(e) => setDraft((d) => ({ ...d, weight: Number(e.target.value) }))}
            />
          </div>
          <label className="flex items-center gap-2 self-end text-sm" htmlFor="clause-active">
            <Checkbox
              id="clause-active"
              checked={draft.isActive}
              onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
            />
            {tr('clauses.field.active')}
          </label>
        </div>
      </div>
    </ModalDialog>
  );
}
export default ReturnClausesPage;
