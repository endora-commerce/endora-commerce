import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Issue #1532 (UX audit CONTENT-12) — a rendered PDF shown **in the page**, in a
 * dialog, rather than in a tab opened with `window.open`: a pop-up blocker could
 * stop that tab, and the editor was left saying "previewing" over nothing.
 *
 * The dialog draws the PDF in an `<iframe>` (the browser's own viewer) and keeps
 * *Open in a new tab* as an ordinary link — a click the operator makes, which no
 * blocker refuses, for a browser that does not draw a PDF inline.
 */
export interface PdfPreview {
  readonly url: string;
  readonly title: string;
}

export interface PdfPreviewState {
  /** The preview on screen, or `null`. */
  readonly preview: PdfPreview | null;
  /** Shows `blob` under `title`, replacing any preview already open. */
  readonly show: (blob: Blob, title: string) => void;
  /** Closes the preview and releases its object URL. */
  readonly close: () => void;
}

/** The object URL of the shown PDF, released when it is closed, replaced or the screen unmounts. */
export function usePdfPreview(): PdfPreviewState {
  const [preview, setPreview] = useState<PdfPreview | null>(null);
  const current = useRef<string | null>(null);

  const release = useCallback((): void => {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = null;
  }, []);

  const show = useCallback(
    (blob: Blob, title: string): void => {
      release();
      const url = URL.createObjectURL(blob);
      current.current = url;
      setPreview({ url, title });
    },
    [release],
  );

  const close = useCallback((): void => {
    release();
    setPreview(null);
  }, [release]);

  useEffect(() => release, [release]);

  return useMemo(() => ({ preview, show, close }), [preview, show, close]);
}

export interface PdfPreviewDialogProps {
  readonly preview: PdfPreview | null;
  readonly onClose: () => void;
}

export function PdfPreviewDialog({ preview, onClose }: PdfPreviewDialogProps): ReactNode {
  const t = useTranslation('document_templates');
  const tCore = useTranslation('core');
  if (!preview) return null;
  return (
    <ModalDialog
      title={preview.title}
      onClose={onClose}
      widthClassName="max-w-5xl"
      footer={
        <>
          <Button variant="outline" asChild>
            <a href={preview.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              {t('editor.previewOpen')}
            </a>
          </Button>
          <Button onClick={onClose}>{tCore('common.action.close')}</Button>
        </>
      }
    >
      <iframe title={preview.title} src={preview.url} className="h-[70vh] w-full rounded-md border" />
    </ModalDialog>
  );
}
