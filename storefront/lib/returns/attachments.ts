import { tForLocale } from '../i18n/messages';
import { format } from '../i18n/format';

/**
 * The returns form's attachment rules (`specs/180-off-platform-complaints/` FR-B20; design
 * review R-2.5) as pure functions, so the field, the route handler and the SSR tests read
 * one copy: JPEG, PNG, WebP or PDF, 10 MB per file, 30 MB and 10 files per submission.
 */

export const RETURN_ATTACHMENT_TYPES = ['photo', 'proof_of_purchase', 'other'] as const;
export type ReturnAttachmentType = (typeof RETURN_ATTACHMENT_TYPES)[number];

export interface AttachmentLimits {
  readonly maxFileBytes: number;
  readonly maxSubmissionBytes: number;
  readonly maxFilesPerCase: number;
  readonly acceptedMimeTypes: readonly string[];
}

const MB = 1024 * 1024;

/** The limits the backend answers in `form-config`; the defaults until it does. */
export const RETURN_FORM_LIMITS: AttachmentLimits = {
  maxFileBytes: 10 * MB,
  maxSubmissionBytes: 30 * MB,
  maxFilesPerCase: 10,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
};

/** The `accept` attribute: explicit MIME types, never `image/*` (iOS then converts HEIC to JPEG). */
export function acceptAttribute(limits: AttachmentLimits = RETURN_FORM_LIMITS): string {
  return limits.acceptedMimeTypes.join(',');
}

/** Why one file cannot be attached, judged before it is sent; `null` when it can. */
export function fileRefusal(
  file: { readonly name: string; readonly size: number; readonly type: string },
  limits: AttachmentLimits,
): 'too_large' | 'type_not_accepted' | null {
  if (!limits.acceptedMimeTypes.includes(file.type)) return 'type_not_accepted';
  if (file.size > limits.maxFileBytes) return 'too_large';
  return null;
}

/** `480 KB`, `12.4 MB` — in the reader's number format. */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes < MB) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / 1024)))} KB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / MB)} MB`;
}

export interface AttachmentBudget {
  readonly count: number;
  readonly maxFiles: number;
  readonly bytes: number;
  readonly maxBytes: number;
  /** No further file fits: the count or the bytes are spent. */
  readonly full: boolean;
}

export function attachmentBudget(files: ReadonlyArray<{ readonly size: number }>, limits: AttachmentLimits): AttachmentBudget {
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  return {
    count: files.length,
    maxFiles: limits.maxFilesPerCase,
    bytes,
    maxBytes: limits.maxSubmissionBytes,
    full: files.length >= limits.maxFilesPerCase || bytes >= limits.maxSubmissionBytes,
  };
}

/** "3 of 10 files · 12.4 of 30 MB". */
export function budgetLine(budget: AttachmentBudget, locale: string): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return format(tForLocale(locale)('returns.attachments.budget'), {
    count: String(budget.count),
    max: String(budget.maxFiles),
    used: number.format(budget.bytes / MB),
    limit: number.format(budget.maxBytes / MB),
  });
}

/** D-9 — the no-JavaScript submission over 30 MB, refused before it was read. */
export function tooLargeSentence(locale: string): string {
  return tForLocale(locale)('returns.attachments.tooLarge');
}
