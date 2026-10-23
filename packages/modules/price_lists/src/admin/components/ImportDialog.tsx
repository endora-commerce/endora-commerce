import { useId, useState, type ReactNode } from 'react';
import { Download, Upload } from 'lucide-react';
import type { PriceBook, PriceBookDiffRow, PriceBookRowsDryRun } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Label } from '@endora-commerce/admin-kit/ui';
import { errorCode, errorMessage } from '../lib/api-errors.js';
import { downloadText } from '../lib/download.js';
import {
  CSV_MAX_BYTES,
  columnHeader,
  decodeCsv,
  fileSizeRefusal,
  parseCsv,
  refusedRowsCsv,
  serverLineErrors,
  type CsvEncoding,
  type CsvFileError,
  type CsvLanguage,
  type CsvLineError,
  type CsvParsed,
} from '../lib/price-book-csv.js';
import { formatPriceCell } from '../lib/price-cell.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * Importing a CSV file into a book (feature 161, T093; US9; FR-038–FR-041).
 *
 * The file is checked locally first (size, encoding, header, every line's
 * syntax — `price-book-csv.ts`); the readable lines are then previewed by the
 * server (`PUT …/rows?dryRun=true`), which resolves the keys and applies the
 * book's rules without writing. The preview lists what would change, with the
 * file line of each, and every refused row with its line, column and reason.
 * Nothing is written until *Import* — which is offered only for a preview with
 * changes and no refused row — and then the same body goes once, against the
 * version the preview was made from; a book saved since is refused and a new
 * preview offered (FR-041). When the bytes are not UTF-8 the administrator
 * chooses the encoding, seeing the first lines as read (FR-039).
 */

type Mode = 'merge' | 'replace';

interface Preview {
  readonly file: CsvParsed;
  readonly answer: PriceBookRowsDryRun;
  readonly errors: readonly CsvLineError[];
  readonly mode: Mode;
}

type Phase =
  | { readonly kind: 'choose' }
  | { readonly kind: 'encoding'; readonly sample: string }
  | { readonly kind: 'previewing' }
  | { readonly kind: 'preview'; readonly preview: Preview }
  | { readonly kind: 'importing'; readonly preview: Preview }
  | { readonly kind: 'stale'; readonly preview: Preview };

/** Rows a preview list shows before it says how many more there are. */
const LIST_LIMIT = 200;

export function ImportDialog(props: {
  readonly book: PriceBook;
  readonly onClose: () => void;
  readonly onImported: (changes: number) => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { language: adminLanguage } = useTranslationContext();
  const language: CsvLanguage = adminLanguage === 'pl' ? 'pl' : 'en';
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>('merge');
  const [encoding, setEncoding] = useState<CsvEncoding | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const fileErrorText = (error: CsvFileError): string => {
    switch (error.code) {
      case 'tooLarge':
        return t('import.file.tooLarge', { max: Math.round(error.maxBytes / (1024 * 1024)) });
      case 'empty':
        return t('import.file.empty');
      case 'tooManyRows':
        return t('import.file.tooManyRows', { count: error.count, max: error.max });
      case 'unknownColumns':
        return t('import.file.unknownColumns', { columns: error.columns.join(', ') });
      case 'duplicateColumns':
        return t('import.file.duplicateColumns', { columns: error.columns.join(', ') });
      case 'missingColumns':
        return t('import.file.missingColumns', { columns: error.columns.join(', ') });
      case 'columnOrder':
        return t('import.file.columnOrder', { columns: error.expected.join(', ') });
      case 'unclosedQuote':
        return t('import.file.unclosedQuote', { line: error.line });
    }
  };

  const reasonText = (error: CsvLineError): string => t(`import.reason.${error.code}`, { ...error.params });

  const restart = (): void => {
    setPhase({ kind: 'choose' });
    setProblem(null);
  };

  const preview = async (): Promise<void> => {
    setProblem(null);
    if (!file) {
      setProblem(t('import.file.required'));
      return;
    }
    const tooLarge = fileSizeRefusal(file.size);
    if (tooLarge) {
      setProblem(fileErrorText(tooLarge));
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setProblem(t('import.error.read'));
      return;
    }
    const decoded = decodeCsv(bytes, encoding ?? undefined);
    if (decoded.uncertain && phase.kind !== 'encoding') {
      setEncoding(decoded.encoding);
      setPhase({ kind: 'encoding', sample: sampleOf(bytes, decoded.encoding) });
      return;
    }
    const parsed = parseCsv(decoded.text);
    if (!parsed.ok) {
      setPhase({ kind: 'choose' });
      setProblem(fileErrorText(parsed.error));
      return;
    }
    await ask(parsed, mode);
  };

  const ask = async (parsed: CsvParsed, asked: Mode): Promise<void> => {
    setPhase({ kind: 'previewing' });
    setStatus(t('import.previewing'));
    try {
      const answer = await api.previewRows(props.book.id, { mode: asked, upsert: parsed.rows.map((r) => r.input), delete: [] });
      const errors = [...parsed.errors, ...serverLineErrors(answer.errors, parsed.rows, answer.resolved)].sort(
        (a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER),
      );
      setPhase({ kind: 'preview', preview: { file: parsed, answer, errors, mode: asked } });
      setStatus(t('import.previewed', { changes: changesOf(answer), refused: errors.length }));
    } catch (err) {
      setPhase({ kind: 'choose' });
      setStatus('');
      setProblem(errorMessage(err, t('import.error.preview')));
    }
  };

  const confirm = async (current: Preview): Promise<void> => {
    setPhase({ kind: 'importing', preview: current });
    setStatus(t('import.importing'));
    try {
      await api.writeRows(
        props.book.id,
        { mode: current.mode, upsert: current.file.rows.map((r) => r.input), delete: [] },
        current.answer.version,
      );
      props.onImported(changesOf(current.answer));
    } catch (err) {
      setStatus('');
      if (errorCode(err) === 'PRICE_BOOK_STALE') {
        setPhase({ kind: 'stale', preview: current });
      } else {
        setPhase({ kind: 'preview', preview: current });
        setProblem(errorMessage(err, t('import.error.import')));
      }
    }
  };

  const downloadRefused = (current: Preview): void => {
    const byLine = new Map(current.file.lines.map((l) => [l.line, l.cells]));
    const lines = current.errors
      .filter((e) => e.line !== null && byLine.has(e.line))
      .map((e) => ({ cells: byLine.get(e.line!)!, reason: reasonText(e) }));
    const base = (file?.name ?? 'price-book').replace(/\.csv$/i, '');
    downloadText(`${base}-refused.csv`, refusedRowsCsv(lines, current.file.headerLanguage));
  };

  const busy = phase.kind === 'previewing' || phase.kind === 'importing';
  const shown = phase.kind === 'preview' || phase.kind === 'importing' || phase.kind === 'stale' ? phase.preview : null;
  const changes = shown ? changesOf(shown.answer) : 0;
  const blockedId = `${id}-blocked`;
  const blocked = shown ? (shown.errors.length > 0 ? t('import.confirmBlocked.refused') : changes === 0 ? t('import.confirmBlocked.none') : null) : null;

  const footer = (
    <>
      <Button type="button" variant="outline" onClick={props.onClose} disabled={busy}>
        {t('priceBooks.common.cancel')}
      </Button>
      {shown === null ? (
        <Button type="button" onClick={(): void => void preview()} disabled={busy} aria-busy={phase.kind === 'previewing'}>
          <Upload aria-hidden="true" />
          {phase.kind === 'previewing' ? t('import.previewing') : t('import.preview')}
        </Button>
      ) : phase.kind === 'stale' ? (
        <Button type="button" onClick={(): void => void ask(shown.file, shown.mode)}>
          {t('import.previewAgain')}
        </Button>
      ) : (
        <Button
          type="button"
          onClick={(): void => void confirm(shown)}
          disabled={busy || blocked !== null}
          aria-busy={phase.kind === 'importing'}
          {...(blocked !== null ? { 'aria-describedby': blockedId } : {})}
        >
          {phase.kind === 'importing' ? t('import.importing') : t('import.confirm', { count: changes })}
        </Button>
      )}
    </>
  );

  return (
    <ModalDialog title={t('import.title')} onClose={props.onClose} busy={busy} footer={footer}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">
        {shown === null ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${id}-file`}>{t('import.file')}</Label>
              <input
                id={`${id}-file`}
                type="file"
                accept=".csv,text/csv"
                aria-describedby={`${id}-file-help`}
                className="block w-full text-sm"
                onChange={(event): void => {
                  setFile(event.target.files?.[0] ?? null);
                  setEncoding(null);
                  setPhase({ kind: 'choose' });
                  setProblem(null);
                }}
              />
              <p id={`${id}-file-help`} className="text-xs text-muted-foreground">
                {t('import.fileHelp', { max: Math.round(CSV_MAX_BYTES / (1024 * 1024)) })}
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('import.mode')}</legend>
              {(['merge', 'replace'] as const).map((value) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm sm:min-h-0">
                  <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={(): void => setMode(value)} className="mt-1" />
                  <span>{t(`import.mode.${value}`)}</span>
                </label>
              ))}
            </fieldset>
            {phase.kind === 'encoding' ? (
              <fieldset className="space-y-2 rounded-md border p-3" aria-describedby={`${id}-encoding-body`}>
                <legend className="px-1 text-sm font-medium">{t('import.encoding.title')}</legend>
                <p id={`${id}-encoding-body`} className="text-sm">
                  {t('import.encoding.body')}
                </p>
                {(['windows-1250', 'utf-8'] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`${id}-encoding`}
                      value={value}
                      checked={encoding === value}
                      onChange={(): void => {
                        setEncoding(value);
                        void file?.arrayBuffer().then((buffer) => setPhase({ kind: 'encoding', sample: sampleOf(new Uint8Array(buffer), value) }));
                      }}
                    />
                    {t(`import.encoding.${value === 'utf-8' ? 'utf8' : 'windows1250'}`)}
                  </label>
                ))}
                <p className="text-xs font-medium">{t('import.encoding.sample')}</p>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{phase.sample}</pre>
              </fieldset>
            ) : null}
          </>
        ) : (
          <PreviewView
            preview={shown}
            language={language}
            reasonText={reasonText}
            onDownloadRefused={(): void => downloadRefused(shown)}
            onChooseAnother={restart}
            busy={busy}
          />
        )}
        {phase.kind === 'stale' ? (
          <Alert variant="destructive">
            <AlertDescription>{t('import.stale')}</AlertDescription>
          </Alert>
        ) : null}
        {shown && phase.kind !== 'stale' && shown.mode === 'replace' && shown.answer.diff.removed.length > 0 ? (
          <p className="text-sm font-medium">{t('import.replaceRemoves', { count: shown.answer.diff.removed.length })}</p>
        ) : null}
        {blocked !== null && phase.kind !== 'stale' ? (
          <p id={blockedId} className="text-sm text-muted-foreground">
            {blocked}
          </p>
        ) : null}
        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        <p role="status" className="sr-only">
          {status}
        </p>
      </div>
    </ModalDialog>
  );
}

function changesOf(answer: PriceBookRowsDryRun): number {
  return answer.diff.added.length + answer.diff.changed.length + answer.diff.removed.length;
}

/** The first lines of the file as `encoding` reads them. */
function sampleOf(bytes: Uint8Array, encoding: CsvEncoding): string {
  return decodeCsv(bytes, encoding).text.split(/\r?\n/).slice(0, 4).join('\n');
}

function PreviewView(props: {
  readonly preview: Preview;
  readonly language: CsvLanguage;
  readonly reasonText: (error: CsvLineError) => string;
  readonly onDownloadRefused: () => void;
  readonly onChooseAnother: () => void;
  readonly busy: boolean;
}): ReactNode {
  const t = useTranslation('price_lists');
  const { preview, language } = props;
  const { diff, resolved } = preview.answer;
  const lineOfId = new Map<string, number>();
  resolved.forEach((row, index) => {
    if (row?.id) lineOfId.set(row.id, preview.file.rows[index]!.line);
  });
  const lineOf = (row: PriceBookDiffRow): string => (row.id && lineOfId.has(row.id) ? String(lineOfId.get(row.id)) : '');
  const price = (row: PriceBookDiffRow): string => formatPriceCell(row.price, language);
  const describe = (row: PriceBookDiffRow): string => describeRow(t, row);
  const changes = changesOf(preview.answer);
  const counts: Array<readonly [string, number]> = [
    ['changed', diff.changed.length],
    ['added', diff.added.length],
    ...(preview.mode === 'replace' ? ([['removed', diff.removed.length]] as const) : []),
    ['unchanged', diff.unchangedCount],
    ['refused', preview.errors.length],
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{t('import.nothingWritten')}</p>
      {/* Checkpoint 11 ruling: lines the file could not read are not sent, so in
          replace mode their stored counterparts read as removed; Import stays
          disabled while any line is refused, and this says why the list may. */}
      {preview.file.errors.length > 0 ? <p className="text-sm text-muted-foreground">{t('import.notCompared')}</p> : null}
      <ul aria-label={t('import.summary')} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {counts.map(([key, count]) => (
          <li key={key}>{t(`import.count.${key}`, { count })}</li>
        ))}
      </ul>
      {changes === 0 && preview.errors.length === 0 ? <p className="text-sm">{t('import.noChanges')}</p> : null}

      {diff.changed.length > 0 ? (
        <PreviewTable
          caption={t('import.section.changed')}
          headers={[t('import.column.line'), t('import.column.row'), t('import.column.before'), t('import.column.after')]}
          rows={diff.changed.map((c) => [lineOf(c.after), describe(c.after), price(c.before), price(c.after)])}
        />
      ) : null}
      {diff.added.length > 0 ? (
        <PreviewTable
          caption={t('import.section.added')}
          headers={[t('import.column.line'), t('import.column.row'), t('import.column.price')]}
          rows={diff.added.map((r) => [lineOf(r), describe(r), price(r)])}
        />
      ) : null}
      {diff.removed.length > 0 ? (
        <PreviewTable
          caption={t('import.section.removed')}
          headers={[t('import.column.row'), t('import.column.price')]}
          rows={diff.removed.map((r) => [describe(r), price(r)])}
        />
      ) : null}
      {preview.errors.length > 0 ? (
        <>
          <PreviewTable
            caption={t('import.section.refused')}
            headers={[t('import.column.line'), t('import.column.column'), t('import.column.reason')]}
            rows={preview.errors.map((e) => [
              e.line === null ? '—' : String(e.line),
              e.column === null ? '—' : columnHeader(e.column, preview.file.headerLanguage),
              props.reasonText(e),
            ])}
          />
          <Button type="button" variant="outline" onClick={props.onDownloadRefused}>
            <Download aria-hidden="true" />
            {t('import.downloadRefused')}
          </Button>
        </>
      ) : null}
      <Button type="button" variant="ghost" onClick={props.onChooseAnother} disabled={props.busy}>
        {t('import.chooseAnother')}
      </Button>
    </div>
  );
}

function PreviewTable(props: { readonly caption: string; readonly headers: readonly string[]; readonly rows: ReadonlyArray<readonly string[]> }): ReactNode {
  const t = useTranslation('price_lists');
  const shown = props.rows.slice(0, LIST_LIMIT);
  return (
    <div className="space-y-1">
      <table className="w-full text-sm">
        <caption className="text-left font-medium">{props.caption}</caption>
        <thead>
          <tr>
            {props.headers.map((h) => (
              <th key={h} scope="col" className="py-1 pr-3 text-left font-normal text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((cells, i) => (
            <tr key={i} className="border-t">
              {cells.map((cell, j) => (
                <td key={j} className="py-1 pr-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {props.rows.length > shown.length ? (
        <p className="text-xs text-muted-foreground">{t('import.more', { count: props.rows.length - shown.length })}</p>
      ) : null}
    </div>
  );
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A diff row in words: what it selects and its quantity window. */
function describeRow(t: Translate, row: PriceBookDiffRow): string {
  const key = row.naturalKey;
  const attribute = key.attribute ? `${key.attribute.key} = ${key.attribute.valueCode}` : '';
  const selection =
    row.selectionKind === 'all'
      ? t('import.row.all')
      : row.selectionKind === 'product'
        ? t('import.row.product', { sku: key.productSku ?? '' })
        : row.selectionKind === 'variant'
          ? t('import.row.variant', { sku: key.variantSku ?? '' })
          : row.selectionKind === 'category'
            ? t('import.row.category', { path: key.categoryPath ?? '' })
            : row.selectionKind === 'attribute'
              ? t('import.row.attribute', { attribute })
              : t('import.row.categoryAttribute', { path: key.categoryPath ?? '', attribute });
  const window =
    row.maxQuantity === null
      ? t('import.row.from', { min: row.minQuantity })
      : t('import.row.window', { min: row.minQuantity, max: row.maxQuantity });
  return `${selection} · ${window}`;
}
