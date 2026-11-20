import type { GuestCaseView, ReturnAddressSnapshot } from '@endora-commerce/contracts';
import type { ReturnCaseDetail } from '../api/returns';

/**
 * One case, as the storefront shows it, whoever opens it (`specs/181-guest-complaints/` design
 * review F-12): the signed-in customer's case page and the guest's tracking page render the
 * same products, purchase, contact, files and conversation through `CaseSections`, from this
 * shape. Pure and React-free: the two adapters below are the only place the two API views
 * differ, and the node-only tests read them directly.
 *
 * Two differences are deliberate:
 * - the tracking page previews no image — its view has no MIME type, and every `<img>` would
 *   fetch through the token's URL;
 * - a comment's author is *Shop* or *You* there, never a staff name.
 */
export interface CaseViewFile {
  readonly id: string;
  readonly filename: string;
  readonly type: string;
  readonly sizeBytes: number;
  readonly href: string;
  /** Rendered as an image tile rather than an icon. */
  readonly preview: boolean;
}

export interface CaseViewItem {
  readonly key: string;
  readonly productName: string;
  readonly quantity: number;
  /** The product was typed, not chosen from the catalogue. */
  readonly modelAsTyped: boolean;
  readonly reasonLabel: string | null;
  readonly serialNumber: string | null;
  readonly description: string | null;
  readonly files: readonly CaseViewFile[];
}

export interface CaseViewComment {
  readonly id: string;
  /** The author kind the caller labels: `shop` / `you` for a guest, the account's otherwise. */
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface CaseViewContact {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
}

export interface CaseView {
  readonly items: readonly CaseViewItem[];
  readonly purchase: { readonly date: string | null; readonly proofNumber: string | null } | null;
  readonly contact: CaseViewContact | null;
  readonly returnAddress: ReturnAddressSnapshot | null;
  /** The files of the whole case: not tied to one of its products. */
  readonly caseFiles: readonly CaseViewFile[];
  readonly fileCount: number;
  readonly comments: readonly CaseViewComment[];
}

/** The signed-in customer's case (`GET /api/v1/returns/:id`); files under `fileBase` (`…/returns/<id>`). */
export function caseViewOfDetail(detail: ReturnCaseDetail, fileBase: string, authorOf: (kind: string) => string = (k) => k): CaseView {
  const attachments = detail.attachments ?? [];
  const file = (a: (typeof attachments)[number]): CaseViewFile => ({
    id: a.id,
    filename: a.filename,
    type: a.type,
    sizeBytes: a.sizeBytes,
    href: `${fileBase}/attachments/${a.id}`,
    preview: a.mimeType.startsWith('image/'),
  });
  const itemIds = new Set(detail.items.map((it) => it.id));
  return {
    items: detail.items.map((it) => ({
      key: it.id,
      productName: it.productName,
      quantity: it.quantity,
      modelAsTyped: it.productId == null,
      reasonLabel: null,
      serialNumber: it.serialNumber ?? null,
      description: it.description ?? null,
      files: attachments.filter((a) => a.returnCaseItemId === it.id).map(file),
    })),
    purchase: detail.purchase ? { date: detail.purchase.date ?? null, proofNumber: detail.purchase.proofNumber ?? null } : null,
    contact: detail.contact ? { name: detail.contact.name, email: detail.contact.email, phone: detail.contact.phone ?? null } : null,
    returnAddress: detail.returnAddress ?? null,
    caseFiles: attachments.filter((a) => !a.returnCaseItemId || !itemIds.has(a.returnCaseItemId)).map(file),
    fileCount: attachments.length,
    comments: detail.comments.map((c) => ({ id: c.id, author: authorOf(c.authorKind), body: c.body, createdAt: c.createdAt })),
  };
}

/** The guest's case (contract G8); files through `/returns/track/<token>/files/<id>` at `fileBase`. */
export function caseViewOfGuest(view: GuestCaseView, fileBase: string): CaseView {
  const file = (a: GuestCaseView['attachments'][number]): CaseViewFile => ({
    id: a.id,
    filename: a.filename,
    type: a.type,
    sizeBytes: a.sizeBytes,
    href: `${fileBase}/files/${a.id}`,
    preview: false,
  });
  return {
    items: view.lines.map((line, index) => ({
      key: String(index),
      productName: line.productName,
      quantity: line.quantity,
      modelAsTyped: false,
      reasonLabel: line.reasonLabel || null,
      serialNumber: line.serialNumber,
      description: line.description || null,
      files: view.attachments.filter((a) => a.lineIndex === index).map(file),
    })),
    purchase: { date: view.purchase.date || null, proofNumber: view.purchase.proofNumber },
    contact: view.contact,
    returnAddress: view.returnAddress,
    caseFiles: view.attachments.filter((a) => a.lineIndex === null || a.lineIndex >= view.lines.length).map(file),
    fileCount: view.attachments.length,
    comments: view.comments.map((c) => ({ id: c.id, author: c.authorKind, body: c.body, createdAt: c.createdAt })),
  };
}
