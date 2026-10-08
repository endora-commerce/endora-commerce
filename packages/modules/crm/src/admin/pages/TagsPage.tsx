import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { OpportunityTag } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  ColorPicker,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { ModalDialog } from '../components/ModalDialog.js';
import { errorMessage } from '../lib/labels.js';

/** The colour a new tag starts with — the neutral the seeded statuses use. */
const DEFAULT_COLOR = '#64748b';
const NAME_MAX = 64;

type DialogState = { kind: 'create' } | { kind: 'edit'; tag: OpportunityTag } | null;

/**
 * The tag list (`specs/143-crm-sales-opportunities/`, User Story 6 — FR-048,
 * FR-049): the labels an Opportunity may carry, managed in one place for the
 * whole platform.
 *
 * Managing the list is configuration (`crm:configure`, the code the route
 * opens on); *using* a tag is done on the Opportunity. Deleting a tag takes it
 * off every Opportunity that carries it, so the confirmation names how many
 * the operator can see — the server's `usageCount`, which counts only those.
 */
export function TagsPage(): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const [tags, setTags] = useState<OpportunityTag[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<OpportunityTag | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const found = await crmApi.listTags();
      if (current === sequence.current) setTags(found);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('tags.error.load')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await crmApi.deleteTag(pendingDelete.id);
      setNotice(t('tags.deleted', { name: pendingDelete.name }));
      setPendingDelete(null);
      await load();
    } catch (failure) {
      setDeleteError(errorMessage(failure, t('tags.error.delete')));
    } finally {
      setDeleting(false);
    }
  };

  const addButton = (
    <Button className="min-h-11 sm:min-h-9" onClick={(): void => setDialog({ kind: 'create' })}>
      <Plus aria-hidden="true" className="size-4" />
      {t('tags.add')}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('tags.title')} description={t('tags.description')} actions={addButton} />

      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {tags === null ? (
            loading ? (
              <p role="status" className="text-sm text-muted-foreground">
                {tCore('common.state.loading')}
              </p>
            ) : null
          ) : tags.length === 0 ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">{t('tags.empty')}</p>
              {addButton}
            </div>
          ) : (
            <Table aria-label={t('tags.title')} aria-busy={loading}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('tags.col.tag')}</TableHead>
                  <TableHead className="text-right">{t('tags.col.usage')}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t('tags.col.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.map((tag) => (
                  <TableRow key={tag.id}>
                    <TableCell>
                      <Badge className="font-medium" style={statusBadgeStyle(tag.color)}>
                        {tag.name}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{tag.usageCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                          aria-label={t('tags.edit', { name: tag.name })}
                          onClick={(): void => setDialog({ kind: 'edit', tag })}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                          aria-label={t('tags.delete', { name: tag.name })}
                          onClick={(): void => {
                            setDeleteError(null);
                            setPendingDelete(tag);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialog ? (
        <TagDialog
          tag={dialog.kind === 'edit' ? dialog.tag : null}
          onClose={(): void => setDialog(null)}
          onSaved={async (name): Promise<void> => {
            setDialog(null);
            setNotice(t('tags.savedTag', { name }));
            await load();
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ModalDialog
          title={t('tags.delete.title')}
          busy={deleting}
          onClose={(): void => setPendingDelete(null)}
          footer={
            <>
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                onClick={(): void => setPendingDelete(null)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                aria-busy={deleting}
                onClick={(): void => void confirmDelete()}
              >
                {t('tags.delete.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {t('tags.delete.body', { name: pendingDelete.name, count: pendingDelete.usageCount })}
          </p>
          {deleteError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
        </ModalDialog>
      ) : null}
    </>
  );
}

/** Create a tag, or rename / recolour one. An edit sends only what changed. */
function TagDialog(props: {
  tag: OpportunityTag | null;
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}): ReactNode {
  const { tag, onClose, onSaved } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const fieldId = useId();
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? DEFAULT_COLOR);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError(t('tags.error.nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (tag === null) {
        await crmApi.createTag({ name: trimmed, color });
      } else {
        const patch = {
          ...(trimmed !== tag.name ? { name: trimmed } : {}),
          ...(color !== tag.color ? { color } : {}),
        };
        if (Object.keys(patch).length > 0) await crmApi.updateTag(tag.id, patch);
      }
      await onSaved(trimmed);
    } catch (failure) {
      setError(errorMessage(failure, t('tags.error.save')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t(tag === null ? 'tags.dialog.createTitle' : 'tags.dialog.editTitle')}
      busy={busy}
      onClose={onClose}
    >
      <form noValidate className="space-y-5" onSubmit={(event): void => void submit(event)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-name`}>{t('tags.field.name')}</Label>
          <Input
            id={`${fieldId}-name`}
            value={name}
            maxLength={NAME_MAX}
            autoFocus
            aria-invalid={nameError !== null}
            aria-describedby={`${fieldId}-name-hint`}
            onChange={(event): void => {
              setName(event.target.value);
              setNameError(null);
            }}
          />
          <p
            id={`${fieldId}-name-hint`}
            className={nameError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
          >
            {nameError ?? t('tags.field.nameHint')}
          </p>
        </div>
        <div className="space-y-1">
          <span className="block text-sm font-medium leading-none">{t('tags.field.color')}</span>
          <ColorPicker
            value={color}
            onChange={setColor}
            label={t('tags.field.color')}
            customLabel={t('tags.field.colorCustom')}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button className="min-h-11 sm:min-h-9" type="button" variant="outline" disabled={busy} onClick={onClose}>
            {tCore('common.action.cancel')}
          </Button>
          <Button className="min-h-11 sm:min-h-9" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? tCore('common.state.saving') : tCore('common.action.save')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TagsPage;
