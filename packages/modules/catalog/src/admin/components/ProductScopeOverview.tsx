import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, RotateCcw, Trash2 } from 'lucide-react';
import { apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { scopeSaveErrorMessage } from '../lib/product-scopes-api.js';
import {
  describeOverviewField,
  getScopeOverview,
  isTextField,
  orphanDeleteRequest,
  pickLocalized,
  resetRequestFor,
  sendScopeFieldRequest,
  type OverviewLevel,
  type ScopeFieldRequest,
  type ScopeOverview,
  type ScopeOverviewCell,
  type ScopeOverviewOrphan,
} from '../lib/scope-overview.js';
import { urlKeyErrorMessage } from '../lib/product-url-keys-api.js';

/**
 * Feature 163 (T094; US4, FR-015, FR-041) — the product editor's scope overview: one
 * table of channels × languages (`GET …/scope-overview`).
 *
 * Each override is shown, and reset, **where it lives** (Common Region): a channel value
 * in its row's "whole channel" cell, a language value in the "every channel" row of its
 * column, a channel × language value in its cell — never inside a header cell (D11). A cell also names the channel and language
 * values that win there, without a second reset button for them, so one override never
 * has two controls (Similarity). A reset goes to the field's owning endpoint with `null`
 * for that field only (`lib/scope-overview.ts`) and reloads the table. Owner decision
 * UX-1 = A: a reset of a text value and every orphan delete ask first in a dialog naming
 * the field, the scope and the outcome; any other reset is one click. After a reset
 * focus returns to the overview's heading, since the button went with the value (D11b). A per-language value of the product itself (its German
 * description) is the product's own text, edited on the Details and Attributes tabs,
 * and has no reset here.
 *
 * What the completeness gate would report at a cell (`missing`) is a text marker with an
 * icon — never colour alone. Overrides the resolution ignores (orphans, FR-015) are listed
 * below the table with a delete each. Without `catalog:write` nothing here is actionable.
 */

export interface ProductScopeOverviewProps {
  productId: string;
}

interface AttributeSummary {
  key: string;
  label?: Record<string, string>;
  labelDefault?: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;

export function ProductScopeOverview({ productId }: ProductScopeOverviewProps): ReactNode {
  const t = useTranslation('catalog');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const headingId = useId();
  const orphansHeadingId = useId();
  const confirmBodyId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  /** Where focus lands when the confirmation closes: the heading after a done action, else the opener. */
  const dialogFinalFocus = useRef<HTMLElement | null>(null);

  const [overview, setOverview] = useState<ScopeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [attributes, setAttributes] = useState<AttributeSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  /** A text reset or an orphan delete waiting on the operator's yes (UX-1 = A). */
  const [confirming, setConfirming] = useState<{
    kind: 'reset' | 'delete';
    request: ScopeFieldRequest;
    field: string;
    scope: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    getScopeOverview(productId)
      .then((data) => {
        if (cancelled) return;
        setOverview(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [productId, reloadToken]);

  // Labels only: an attribute that cannot be read is shown by its key.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ data: AttributeSummary[] }>('/api/v1/admin/catalog/attributes')
      .then((res) => {
        if (!cancelled) setAttributes(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, []);

  const attributeLabel = useCallback(
    (key: string): string | null => {
      const attribute = attributes.find((a) => a.key === key);
      if (!attribute) return null;
      return pickLocalized(attribute.label, language) || attribute.labelDefault || null;
    },
    [attributes, language],
  );

  const channelName = useCallback(
    (channelId: string | null): string => {
      const channel = overview?.channels.find((c) => c.channelId === channelId);
      return channel ? pickLocalized(channel.name, language) : t('productEditor.scopeOverview.unknownChannel');
    },
    [overview, language, t],
  );

  const fieldLabel = useCallback(
    (field: string): string => describeOverviewField(field, t, attributeLabel),
    [t, attributeLabel],
  );

  const run = useCallback(
    async (request: ScopeFieldRequest, doneKey: string): Promise<void> => {
      setBusy(true);
      setActionError(null);
      setStatus('');
      try {
        await sendScopeFieldRequest(productId, request);
        setStatus(t(doneKey));
        setReloadToken((n) => n + 1);
        // D11b — the control unmounts with the value it removed; keep focus in the overview.
        dialogFinalFocus.current = headingRef.current;
        headingRef.current?.focus();
      } catch (err) {
        setActionError(
          urlKeyErrorMessage(err, t) ??
            scopeSaveErrorMessage(err, channelName, t, 'productEditor.scopeOverview.error.generic'),
        );
      } finally {
        setBusy(false);
        setConfirming(null);
      }
    },
    [productId, t, channelName],
  );

  /** Every reset passes here: a text value asks first (UX-1 = A), anything else is one click. */
  const reset = (request: ScopeFieldRequest | null, field: string, scope: string): void => {
    if (!request) return;
    if (isTextField(field)) {
      dialogFinalFocus.current = null;
      setConfirming({ kind: 'reset', request, field, scope });
      return;
    }
    void run(request, 'productEditor.scopeOverview.resetDone');
  };

  const members = useMemo(() => overview?.channels.filter((c) => c.isMember) ?? [], [overview]);

  // Mounted before it carries text so an outcome is announced (WCAG 4.1.3).
  const liveRegion = (
    <p role="status" aria-live="polite" className="b2b-help" style={{ margin: 0 }}>
      {status}
    </p>
  );

  if (loading) {
    return (
      <p role="status" aria-live="polite" className="b2b-help" aria-busy="true">
        {t('productEditor.scopeOverview.loading')}
      </p>
    );
  }
  if (loadFailed || !overview) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <span>{t('productEditor.scopeOverview.loadFailed')}</span>{' '}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(): void => {
              setLoading(true);
              setReloadToken((n) => n + 1);
            }}
          >
            {t('productEditor.scopeOverview.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // 168-shim: the Language row is gone (FR-010, FR-100); T132 removes it from this view.
  const languageColumnOf = (_code: string): string[] => [];

  /** A language's own values, with their resets — rendered in a body cell, never a header (D11). */
  const languageValues = (code: string): ReactNode => {
    const fields = languageColumnOf(code);
    if (fields.length === 0) return <span className="b2b-help">{t('productEditor.scopeOverview.nothingSet')}</span>;
    return (
      <FieldList
        fields={fields}
        fieldLabel={fieldLabel}
        resetFor={(field): ScopeFieldRequest | null =>
          canWrite ? resetRequestFor({ field, level: 'language', channelId: '', languageCode: code }) : null
        }
        resetLabel={(field): string =>
          t('productEditor.scopeOverview.resetAria', { field: fieldLabel(field), scope: code.toUpperCase() })
        }
        busy={busy}
        onReset={(request, field): void => reset(request, field, code.toUpperCase())}
        t={t}
      />
    );
  };

  /** Sticky row headers keep the channel in view while the languages scroll (D11). */
  const stickyRowHeader = { position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 } as const;

  return (
    <section className="b2b-col" style={{ gap: 12 }} aria-labelledby={headingId} aria-busy={busy || undefined}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-sm font-semibold" style={{ margin: 0 }}>
        {t('productEditor.scopeOverview.title')}
      </h3>
      <p className="b2b-help" style={{ margin: 0 }}>
        {t('productEditor.scopeOverview.help')}
      </p>
      {!canWrite ? (
        <p className="b2b-help" style={{ margin: 0 }}>
          {t('productEditor.scopeOverview.readOnly')}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-destructive" style={{ margin: 0 }}>
          {actionError}
        </p>
      ) : null}
      {liveRegion}

      {members.length === 0 ? (
        <>
          <Alert role="note">
            <AlertDescription>{t('productEditor.scopeOverview.noChannels')}</AlertDescription>
          </Alert>
          <div
            role="region"
            tabIndex={0}
            aria-label={t('productEditor.scopeOverview.languagesCaption')}
            style={{ overflowX: 'auto' }}
          >
            <table className="b2b-tbl" style={{ width: '100%' }}>
              <caption className="sr-only">{t('productEditor.scopeOverview.languagesCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('productEditor.scopeOverview.languageColumn')}</th>
                  <th scope="col">{t('productEditor.scopeOverview.languageValues')}</th>
                </tr>
              </thead>
              <tbody>
                {overview.languages.map((code) => (
                  <tr key={code}>
                    <th scope="row" style={{ verticalAlign: 'top', textAlign: 'left' }}>
                      <span className="font-semibold">{code.toUpperCase()}</span>
                    </th>
                    <td style={{ verticalAlign: 'top' }}>{languageValues(code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div
          role="region"
          tabIndex={0}
          aria-label={t('productEditor.scopeOverview.tableRegion')}
          style={{ overflowX: 'auto' }}
        >
          <table className="b2b-tbl" style={{ width: '100%' }}>
            <caption className="sr-only">{t('productEditor.scopeOverview.title')}</caption>
            <thead>
              <tr>
                <th scope="col" style={stickyRowHeader}>
                  {t('productEditor.scopeOverview.channelColumn')}
                </th>
                <th scope="col">{t('productEditor.scopeOverview.wholeChannelColumn')}</th>
                {overview.languages.map((code) => (
                  <th key={code} scope="col" style={{ verticalAlign: 'top' }}>
                    <span className="font-semibold">{code.toUpperCase()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" style={{ ...stickyRowHeader, verticalAlign: 'top', textAlign: 'left' }}>
                  <span className="font-semibold">{t('productEditor.scopeOverview.everyChannelRow')}</span>
                </th>
                <td style={{ verticalAlign: 'top' }}>
                  <span className="b2b-help" aria-hidden="true">
                    —
                  </span>
                </td>
                {overview.languages.map((code) => (
                  <td key={code} style={{ verticalAlign: 'top' }}>
                    {languageValues(code)}
                  </td>
                ))}
              </tr>
              {overview.channels.map((channel) => {
                const name = pickLocalized(channel.name, language);
                const rowFields =
                  overview.channelRows.find((r) => r.channelId === channel.channelId)?.overriddenFields ?? [];
                return (
                  <tr key={channel.channelId}>
                    <th scope="row" style={{ ...stickyRowHeader, verticalAlign: 'top', textAlign: 'left' }}>
                      <span className="font-semibold">{name}</span>
                      {!channel.isMember ? (
                        <>
                          {' '}
                          <Badge variant="outline">{t('productEditor.scopeOverview.notAMember')}</Badge>
                        </>
                      ) : null}
                    </th>
                    <td style={{ verticalAlign: 'top' }}>
                      {rowFields.length > 0 ? (
                        <FieldList
                          fields={rowFields}
                          fieldLabel={fieldLabel}
                          resetFor={(field): ScopeFieldRequest | null =>
                            canWrite
                              ? resetRequestFor({ field, level: 'channel', channelId: channel.channelId, languageCode: '' })
                              : null
                          }
                          resetLabel={(field): string =>
                            t('productEditor.scopeOverview.resetAria', { field: fieldLabel(field), scope: name })
                          }
                          busy={busy}
                          onReset={(request, field): void => reset(request, field, name)}
                          t={t}
                        />
                      ) : (
                        <span className="b2b-help">{t('productEditor.scopeOverview.nothingSetChannel')}</span>
                      )}
                    </td>
                    {overview.languages.map((code) => {
                      const cell = overview.cells.find(
                        (c) => c.channelId === channel.channelId && c.languageCode === code,
                      );
                      const offered = channel.isMember && channel.languages.includes(code);
                      const scopeName = `${name} · ${code.toUpperCase()}`;
                      return (
                        <td key={code} style={{ verticalAlign: 'top' }}>
                          {cell && offered ? (
                            <OverviewCell
                              cell={cell}
                              scopeName={scopeName}
                              canWrite={canWrite}
                              busy={busy}
                              fieldLabel={fieldLabel}
                              onReset={(request, field): void => reset(request, field, scopeName)}
                              t={t}
                            />
                          ) : (
                            <span className="b2b-help">{t('productEditor.scopeOverview.notOffered')}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby={orphansHeadingId} className="b2b-col" style={{ gap: 8 }}>
        <h4 id={orphansHeadingId} className="text-sm font-semibold" style={{ margin: 0 }}>
          {t('productEditor.scopeOverview.orphans.title')}
        </h4>
        {overview.orphans.length === 0 ? (
          <p className="b2b-help" style={{ margin: 0 }}>
            {t('productEditor.scopeOverview.orphans.none')}
          </p>
        ) : (
          <>
            <Alert variant="warning" role="note">
              <AlertDescription>{t('productEditor.scopeOverview.orphans.help')}</AlertDescription>
            </Alert>
            <ul className="b2b-col" style={{ gap: 6, margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {overview.orphans.map((orphan, index) => (
                <OrphanItem
                  key={`${orphan.field}|${orphan.channelId ?? ''}|${orphan.languageCode ?? ''}|${index}`}
                  orphan={orphan}
                  scope={orphanScope(orphan, channelName)}
                  canWrite={canWrite}
                  busy={busy}
                  fieldLabel={fieldLabel}
                  onDelete={(request): void => {
                    dialogFinalFocus.current = null;
                    setConfirming({
                      kind: 'delete',
                      request,
                      field: orphan.field,
                      scope: orphanScope(orphan, channelName),
                    });
                  }}
                  t={t}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {confirming ? (
        <ModalDialog
          title={t(
            confirming.kind === 'reset'
              ? 'productEditor.scopeOverview.confirmReset.title'
              : 'productEditor.scopeOverview.confirmDelete.title',
            { field: fieldLabel(confirming.field), scope: confirming.scope },
          )}
          aria-describedby={confirmBodyId}
          busy={busy}
          finalFocusRef={dialogFinalFocus}
          onClose={(): void => setConfirming(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setConfirming(null)}>
                {t('productEditor.scopeOverview.confirm.cancel')}
              </Button>
              <Button
                type="button"
                variant={confirming.kind === 'delete' ? 'destructive' : 'default'}
                disabled={busy}
                aria-busy={busy}
                onClick={(): void =>
                  void run(
                    confirming.request,
                    confirming.kind === 'reset'
                      ? 'productEditor.scopeOverview.resetDone'
                      : 'productEditor.scopeOverview.orphans.deleted',
                  )
                }
              >
                {t(
                  confirming.kind === 'reset'
                    ? 'productEditor.scopeOverview.reset'
                    : 'productEditor.scopeOverview.orphans.delete',
                )}
              </Button>
            </>
          }
        >
          <p id={confirmBodyId} className="text-sm">
            {t(
              confirming.kind === 'reset'
                ? 'productEditor.scopeOverview.confirmReset.body'
                : 'productEditor.scopeOverview.confirmDelete.body',
              { field: fieldLabel(confirming.field), scope: confirming.scope },
            )}
          </p>
        </ModalDialog>
      ) : null}
    </section>
  );
}

function orphanScope(orphan: ScopeOverviewOrphan, channelName: (id: string | null) => string): string {
  const parts: string[] = [];
  if (orphan.channelId !== null) parts.push(channelName(orphan.channelId));
  if (orphan.languageCode !== null) parts.push(orphan.languageCode.toUpperCase());
  return parts.join(' · ');
}

const LEVEL_KEYS: Record<OverviewLevel, string> = {
  channel_language: 'productEditor.scopeOverview.level.here',
  channel: 'productEditor.scopeOverview.level.channel',
  language: 'productEditor.scopeOverview.level.language',
};

const STATUS_SOURCE_KEYS: Record<ScopeOverviewCell['statusSource'], string> = {
  channel_language: 'productEditor.scopeOverview.statusSource.channelLanguage',
  channel: 'productEditor.scopeOverview.statusSource.channel',
  global: 'productEditor.scopeOverview.statusSource.global',
};

function OverviewCell({
  cell,
  scopeName,
  canWrite,
  busy,
  fieldLabel,
  onReset,
  t,
}: {
  cell: ScopeOverviewCell;
  scopeName: string;
  canWrite: boolean;
  busy: boolean;
  fieldLabel: (field: string) => string;
  onReset: (request: ScopeFieldRequest | null, field: string) => void;
  t: Translate;
}): ReactNode {
  const missing = cell.missing ?? [];
  return (
    <div className="b2b-col" style={{ gap: 4 }}>
      <span className="b2b-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="font-medium">{t(`productEditor.scopeControls.statusValue.${cell.effectiveStatus}`)}</span>
        <span className="b2b-row b2b-help" style={{ gap: 4, alignItems: 'center', margin: 0 }}>
          {cell.available ? <CheckCircle2 size={13} aria-hidden="true" /> : <CircleSlash size={13} aria-hidden="true" />}
          {cell.available ? t('productEditor.scopeOverview.live') : t('productEditor.scopeOverview.notLive')}
        </span>
      </span>
      <span className="b2b-help" style={{ margin: 0 }}>
        {t(STATUS_SOURCE_KEYS[cell.statusSource])}
      </span>
      {cell.overriddenFields.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} className="b2b-col">
          {cell.overriddenFields.map(({ field, level }) => {
            // A channel or language value is reset in its own header, not here.
            const request =
              canWrite && level === 'channel_language'
                ? resetRequestFor({ field, level, channelId: cell.channelId, languageCode: cell.languageCode })
                : null;
            return (
              <li key={`${field}|${level}`} className="b2b-row" style={{ gap: 6, alignItems: 'center' }}>
                <span>
                  {fieldLabel(field)} <span className="b2b-help">· {t(LEVEL_KEYS[level])}</span>
                </span>
                {request ? (
                  <ResetButton
                    label={t('productEditor.scopeOverview.resetAria', { field: fieldLabel(field), scope: scopeName })}
                    busy={busy}
                    onClick={(): void => onReset(request, field)}
                    t={t}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {missing.length > 0 ? (
        <p className="b2b-row text-sm" style={{ gap: 4, alignItems: 'flex-start', margin: 0 }}>
          <AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {t('productEditor.scopeOverview.incomplete', { missing: missing.map((m) => fieldLabel(m)).join(', ') })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function FieldList({
  fields,
  fieldLabel,
  resetFor,
  resetLabel,
  busy,
  onReset,
  t,
}: {
  fields: readonly string[];
  fieldLabel: (field: string) => string;
  resetFor: (field: string) => ScopeFieldRequest | null;
  resetLabel: (field: string) => string;
  busy: boolean;
  onReset: (request: ScopeFieldRequest | null, field: string) => void;
  t: Translate;
}): ReactNode {
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', gap: 4 }} className="b2b-col">
      {fields.map((field) => {
        const request = resetFor(field);
        return (
          <li key={field} className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
            <span>{fieldLabel(field)}</span>
            {request ? (
              <ResetButton label={resetLabel(field)} busy={busy} onClick={(): void => onReset(request, field)} t={t} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ResetButton({
  label,
  busy,
  onClick,
  t,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  t: Translate;
}): ReactNode {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
      style={{ minHeight: 24, minWidth: 24 }}
    >
      <RotateCcw size={12} aria-hidden="true" /> {t('productEditor.scopeOverview.reset')}
    </Button>
  );
}

const ORPHAN_REASON_KEYS: Record<ScopeOverviewOrphan['reason'], string> = {
  not_a_member: 'productEditor.scopeOverview.orphans.reason.notAMember',
  language_not_offered: 'productEditor.scopeOverview.orphans.reason.languageNotOffered',
  attribute_scope_changed: 'productEditor.scopeOverview.orphans.reason.attributeScopeChanged',
};

function OrphanItem({
  orphan,
  scope,
  canWrite,
  busy,
  fieldLabel,
  onDelete,
  t,
}: {
  orphan: ScopeOverviewOrphan;
  scope: string;
  canWrite: boolean;
  busy: boolean;
  fieldLabel: (field: string) => string;
  onDelete: (request: ScopeFieldRequest) => void;
  t: Translate;
}): ReactNode {
  const request = canWrite ? orphanDeleteRequest(orphan) : null;
  const field = fieldLabel(orphan.field);
  return (
    <li className="b2b-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>
        <span className="font-medium">{field}</span> — {scope}:{' '}
        <span className="b2b-help">{t(ORPHAN_REASON_KEYS[orphan.reason])}</span>
      </span>
      {request ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t('productEditor.scopeOverview.orphans.deleteAria', { field, scope })}
          disabled={busy}
          onClick={(): void => onDelete(request)}
        >
          <Trash2 size={12} aria-hidden="true" /> {t('productEditor.scopeOverview.orphans.delete')}
        </Button>
      ) : null}
    </li>
  );
}
