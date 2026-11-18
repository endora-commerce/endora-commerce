'use client';

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { tForLocale, type MessageKey } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';
import {
  RETURN_FORM_LIMITS,
  acceptAttribute,
  attachmentBudget,
  budgetLine,
  fileRefusal,
  formatBytes,
  type AttachmentLimits,
  type ReturnAttachmentType,
} from '../../lib/returns/attachments';

/**
 * One typed file control of the returns form (`specs/180-off-platform-complaints/` FR-B20;
 * design review R-2.5). The type is the control's — photos, a receipt, other documents — so
 * the customer never picks it from a list.
 *
 * **Without JavaScript** it is a labelled `<input type="file" multiple>` with explicit MIME
 * types (never `capture`, which would block the gallery) posted with the form; the route
 * handler uploads the bytes. **With JavaScript** each file is checked against the limits,
 * uploaded at once through `POST /returns/uploads` (or the guest's `uploadAction`) with its progress shown, and kept as a
 * hidden `uploadId`; the native input is cleared so the post carries no bytes. Each row says
 * its state in words, never by colour alone, and the budget line lives in a `role="status"`
 * region mounted empty (WCAG 4.1.3).
 */

interface Row {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly state: 'uploading' | 'attached' | 'refused';
  readonly progress: number;
  readonly uploadId?: string;
  readonly message?: string;
}

export function AttachmentField({
  type,
  locale,
  id,
  label,
  hint,
  limits = RETURN_FORM_LIMITS,
  kept = [],
  line,
  uploadAction = '/returns/uploads',
}: {
  type: ReturnAttachmentType;
  locale: string;
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  limits?: AttachmentLimits;
  /** Files accepted on an earlier, refused attempt (no-JS path): kept by id. */
  kept?: ReadonlyArray<{ uploadId: string; filename: string }>;
  /** A line's photos (`lines.N.…`): the files post under the line slot, not for the whole case. */
  line?: number;
  /** The route handler the JS upload posts to — the guest form's is `/returns/guest/uploads` (181 F-10). */
  uploadAction?: string;
}): ReactNode {
  const prefix = line === undefined ? '' : `lines.${line}.`;
  const t = tForLocale(locale);
  const [enhanced, setEnhanced] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setEnhanced(true), []);

  // A post sent while a file is still uploading carries no id for it, and the case is filed
  // without it (or refused for a missing receipt). The form waits: the submit is held and the
  // field says why, until every upload has an answer.
  const uploading = rows.some((r) => r.state === 'uploading');
  const uploadingRef = useRef(false);
  uploadingRef.current = uploading;
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onSubmit = (event: SubmitEvent): void => {
      if (!uploadingRef.current) return;
      event.preventDefault();
      setHeld(true);
      inputRef.current?.closest('.b2b-auth__field')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  const attached = rows.filter((r) => r.state !== 'refused');
  const budget = attachmentBudget(attached, limits);

  const update = (key: string, patch: Partial<Row>): void =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const upload = (file: File, key: string): void => {
    const body = new FormData();
    body.append('type', type);
    body.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadAction);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) update(key, { progress: event.loaded / event.total });
    };
    xhr.onload = () => {
      try {
        const answer = JSON.parse(xhr.responseText) as { data?: { uploadId: string }; error?: { reason?: string } };
        if (xhr.status === 201 && answer.data) {
          update(key, { state: 'attached', uploadId: answer.data.uploadId, progress: 1 });
          return;
        }
        const reason = answer.error?.reason ?? 'type_not_accepted';
        update(key, { state: 'refused', message: refusalText(reason, file) });
      } catch {
        update(key, { state: 'refused', message: t('returns.errors.generic') });
      }
    };
    xhr.onerror = () => update(key, { state: 'refused', message: t('returns.errors.generic') });
    xhr.send(body);
  };

  const refusalText = (reason: string, file: File): string =>
    format(t(`returns.attachments.refused.${reason}` as MessageKey), { name: file.name, size: formatBytes(file.size, locale) });

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (!enhanced) return;
    const files = Array.from(event.target.files ?? []);
    const added: Row[] = [];
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const refusal = fileRefusal(file, limits);
      const next = attachmentBudget([...attached, ...added.filter((r) => r.state !== 'refused'), file], limits);
      const over =
        next.count > limits.maxFilesPerCase ? 'too_many' : next.bytes > limits.maxSubmissionBytes ? 'submission_too_large' : null;
      const reason = refusal ?? over;
      if (reason) {
        added.push({ key, name: file.name, size: file.size, state: 'refused', progress: 0, message: refusalText(reason, file) });
        continue;
      }
      added.push({ key, name: file.name, size: file.size, state: 'uploading', progress: 0 });
      upload(file, key);
    }
    setRows((current) => [...current, ...added]);
    // The bytes went with the uploads; the post carries the ids.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="b2b-auth__field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        name={`${prefix}files_${type}`}
        type="file"
        multiple
        accept={acceptAttribute(limits)}
        aria-describedby={`${id}-hint ${id}-status`}
        disabled={enhanced && budget.full}
        onChange={onChange}
        // With JavaScript the files are listed below, so the native control — whose button and
        // "no file chosen" speak the browser's language — gives way to the page's own button.
        {...(enhanced ? { className: 'sr-only' } : {})}
      />
      {enhanced ? (
        <label htmlFor={id} className="b2b-stacked__pick">
          {t('returns.attachments.choose')}
        </label>
      ) : null}
      <p id={`${id}-hint`} className="text-[12px] text-muted">
        {hint ? <>{hint} </> : null}
        {t('returns.attachments.hint')}
      </p>
      {kept.length > 0 ? (
        <ul className="text-[13px]">
          {kept.map((k) => (
            <li key={k.uploadId}>
              <input type="hidden" name={`${prefix}keepUpload`} value={k.uploadId} />
              {k.filename} · {t('returns.attachments.alreadyAttached')}
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length > 0 ? (
        <ul className="text-[13px]">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-2">
              <span>
                {row.name} · {formatBytes(row.size, locale)}
              </span>
              {row.state === 'uploading' ? (
                <progress max={1} value={row.progress} aria-label={format(t('returns.attachments.uploading'), { name: row.name })} />
              ) : row.state === 'attached' ? (
                <span>
                  <input type="hidden" name={`${prefix}uploadId`} value={row.uploadId} />✓ {t('returns.attachments.attached')}
                </span>
              ) : (
                <span className="b2b-auth__error m-0">{row.message}</span>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm min-h-11 min-w-11 justify-center"
                aria-label={format(t('returns.attachments.remove'), { name: row.name })}
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p id={`${id}-status`} role="status" aria-live="polite" className="text-[12px] text-muted">
        {held && uploading ? (
          <span className="font-medium text-warn">{t('returns.attachments.waitForUploads')}</span>
        ) : enhanced && rows.length > 0 ? (
          budgetLine(budget, locale)
        ) : null}
      </p>
    </div>
  );
}
