import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Unlink } from 'lucide-react';
import type { ProjectDetail, ProjectLink, ProjectRecordKind } from '@endora-commerce/contracts';
import { ApiError, formatMoney, useAuth, useModulePresence } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Combobox,
  Label,
  Select,
  type ComboboxOption,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { useRemoteOptions } from './LookupPickers.js';

/**
 * A Project's linked records (`specs/163-projects-and-tasks/`, User Story 6;
 * `contracts/admin-surfaces.md` §2; spec FR-021 – FR-024): Orders, Quote
 * Requests and Opportunities, a group each.
 *
 * A record is listed with its number — a link to its own screen — its status
 * and its amount, or as *unavailable* when the server cannot show it to this
 * reader (no read code for its kind, its module switched off, or it is gone).
 *
 * A writer links a record of one of the Project's Organizations — the picker
 * reads the owner's own list, filtered by that Organization — and unlinks any
 * record, an unavailable one included. A kind's picker is offered only while
 * its module is on and the writer holds the code that module reads its
 * records with; a switched-off module's group keeps its links and says why
 * nothing can be added. An internal Project has no Organization, so nothing
 * can be linked to it.
 */

const KINDS: readonly ProjectRecordKind[] = ['order', 'quote_request', 'opportunity'];

/** The module that owns each kind, and the code it reads its records with. */
const OWNER: Readonly<Record<ProjectRecordKind, { module: string; readPermission: string }>> = {
  order: { module: 'orders', readPermission: 'orders:read' },
  quote_request: { module: 'quote_requests', readPermission: 'rfqs:handle' },
  opportunity: { module: 'crm', readPermission: 'crm:read' },
};

type State = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; links: ProjectLink[] };

export interface LinkedRecordsProps {
  project: ProjectDetail;
  /** Told after a record was linked or unlinked — the Project's count of links changed. */
  onLinksChanged?: () => void;
}

export function LinkedRecords({ project, onLinksChanged }: LinkedRecordsProps): ReactNode {
  const t = useTranslation('projects');
  const { isPresent } = useModulePresence();
  const { hasPermission } = useAuth();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    try {
      const links = await projectsApi.listLinks(project.id);
      if (current === sequence.current) setState({ phase: 'ready', links });
    } catch {
      if (current === sequence.current) setState({ phase: 'failed' });
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = async (message: string): Promise<void> => {
    setNotice(message);
    await load();
    onLinksChanged?.();
  };

  if (state.phase === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('links.loading')}
      </p>
    );
  }
  if (state.phase === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('links.error')}</AlertDescription>
      </Alert>
    );
  }

  const internal = project.organizations.length === 0;
  const linkedIds = new Set(state.links.map((link) => link.recordId));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{internal ? t('links.internal') : t('links.hint')}</p>
      {KINDS.map((kind) => {
        const present = isPresent(OWNER[kind].module);
        return (
          <LinkGroup
            key={kind}
            kind={kind}
            project={project}
            links={state.links.filter((link) => link.kind === kind)}
            ownerOff={!present}
            canUnlink={project.permissions.canWrite}
            canLink={project.permissions.canWrite && present && !internal && hasPermission(OWNER[kind].readPermission)}
            linkedIds={linkedIds}
            onChanged={changed}
          />
        );
      })}
      {/* Mounted before it has text, so the announcement is reliable (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>
  );
}

interface LinkGroupProps {
  kind: ProjectRecordKind;
  project: ProjectDetail;
  links: ProjectLink[];
  ownerOff: boolean;
  canUnlink: boolean;
  canLink: boolean;
  linkedIds: ReadonlySet<string>;
  onChanged: (message: string) => Promise<void>;
}

function amountLabel(link: ProjectLink): string | null {
  if (link.amount === undefined || link.currency === undefined) return null;
  const amount = Number(link.amount);
  return Number.isFinite(amount) ? formatMoney(amount, link.currency) : null;
}

/** One kind: its links, then — for a writer who may — the picker. */
function LinkGroup(props: LinkGroupProps): ReactNode {
  const { kind, links } = props;
  const t = useTranslation('projects');
  const headingId = useId();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unlink = async (link: ProjectLink): Promise<void> => {
    setBusyId(link.id);
    setError(null);
    try {
      await projectsApi.removeLink(props.project.id, link.id);
      await props.onChanged(link.number ? t('links.removed', { number: link.number }) : t('links.removedUnavailable'));
    } catch (failure) {
      setError(errorMessage(failure, t('links.removeError')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-md border p-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {t(`links.group.${kind}`)}
      </h3>
      {props.ownerOff && kind !== 'order' ? (
        <p className="text-sm text-muted-foreground">{t(`links.ownerOff.${kind}`)}</p>
      ) : null}
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('links.empty')}</p>
      ) : (
        <ul className="divide-y text-sm">
          {links.map((link) => {
            const amount = amountLabel(link);
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                {link.available && link.number ? (
                  <>
                    {link.href ? (
                      <Link to={link.href} className="font-medium text-primary underline-offset-4 hover:underline">
                        {link.number}
                      </Link>
                    ) : (
                      <span className="font-medium">{link.number}</span>
                    )}
                    {link.status ? (
                      <Badge variant="outline" className="font-normal">
                        {link.status}
                      </Badge>
                    ) : null}
                    {amount ? <span className="tabular-nums">{amount}</span> : null}
                    {amount && link.partiallyAgreed ? (
                      <Badge variant="outline" className="font-normal">
                        {t('links.partiallyAgreed')}
                      </Badge>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground" title={t('links.unavailableHint')}>
                    {t('links.unavailable')}
                  </span>
                )}
                {props.canUnlink ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto min-h-11 sm:min-h-8"
                    aria-label={link.number ? t('links.remove', { number: link.number }) : t('links.removeUnavailable')}
                    disabled={busyId !== null}
                    aria-busy={busyId === link.id}
                    onClick={(): void => void unlink(link)}
                  >
                    <Unlink aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {props.canLink ? (
        <LinkPicker kind={kind} project={props.project} linkedIds={props.linkedIds} onLinked={props.onChanged} />
      ) : null}
    </section>
  );
}

interface LinkPickerProps {
  kind: ProjectRecordKind;
  project: ProjectDetail;
  linkedIds: ReadonlySet<string>;
  onLinked: (message: string) => Promise<void>;
}

/**
 * A record of one of the Project's Organizations, chosen from its owner's own
 * list, then linked. With several Organizations the Organization is chosen
 * first — only the Project's are offered.
 */
function LinkPicker({ kind, project, linkedIds, onLinked }: LinkPickerProps): ReactNode {
  const t = useTranslation('projects');
  const organizationFieldId = useId();
  const recordFieldId = useId();
  const [organizationId, setOrganizationId] = useState(project.organizations[0]?.id ?? '');
  const [recordId, setRecordId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(
    async (query: string): Promise<ComboboxOption<string>[]> =>
      (await projectsApi.linkableRecords(kind, organizationId, query)).map((record) => ({
        value: record.id,
        label: record.number,
        description: record.detail,
      })),
    [kind, organizationId],
  );
  const remote = useRemoteOptions(loadRecords);

  const link = async (): Promise<void> => {
    if (!recordId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await projectsApi.addLink(project.id, kind, recordId);
      setRecordId(null);
      await onLinked(t('links.add.linked', { number: created.number ?? remote.labelOf(recordId) }));
    } catch (failure) {
      const holder =
        failure instanceof ApiError && failure.envelope.error.code === 'PROJECT_RECORD_ALREADY_LINKED'
          ? (failure.envelope.error.details as { project?: { number: string; title: string } } | undefined)?.project
          : undefined;
      setError(holder ? t('links.add.heldBy', { number: holder.number, title: holder.title }) : errorMessage(failure, t('links.add.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-end gap-2">
        {project.organizations.length > 1 ? (
          <div className="min-w-40 space-y-1">
            <Label htmlFor={organizationFieldId}>{t('links.add.organization')}</Label>
            <Select
              id={organizationFieldId}
              value={organizationId}
              disabled={busy}
              onChange={(event): void => {
                setOrganizationId(event.target.value);
                setRecordId(null);
              }}
            >
              {project.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor={recordFieldId}>{t(`links.add.record.${kind}`)}</Label>
          <Combobox<string>
            id={recordFieldId}
            ariaLabel={t(`links.add.record.${kind}`)}
            options={remote.options.map((option) => ({ ...option, disabled: linkedIds.has(option.value) }))}
            value={recordId}
            onChange={setRecordId}
            onSearchChange={remote.search}
            manualFilter
            loading={remote.loading}
            loadingMessage={t('picker.loading')}
            clearable
            disabled={busy}
            placeholder={t('links.add.placeholder')}
            emptyMessage={t('picker.empty')}
            selectedLabel={remote.labelOf(recordId)}
          />
          {remote.failed ? (
            <p role="alert" className="text-xs text-destructive">
              {t('picker.loadError')}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          disabled={busy || recordId === null}
          aria-busy={busy}
          onClick={(): void => void link()}
        >
          <Link2 aria-hidden="true" />
          {busy ? t('links.add.linking') : t(`links.add.submit.${kind}`)}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
