import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Circle, FileSpreadsheet, Layers, ListPlus, Percent, PlusCircle, RotateCcw, Save, SlidersHorizontal, Tag, TextCursorInput } from 'lucide-react';
import type { PriceBook, PriceBookLine, PriceBookRow, PriceBookRowError, PriceBookRowPrice, PriceBookSelectionKind } from '@endora-commerce/contracts';
import {
  EditableGrid,
  ModalDialog,
  PaginationFooter,
  ProductBrowserDialog,
  StickyFormActions,
  productDisplayName,
  type EditableGridCellChange,
  type EditableGridChangeReason,
  type EditableGridHandle,
  type EditableGridRenderContext,
  type EditableGridRow,
  type ProductBrowserItem,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { useAuth, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  addLines,
  afterSave,
  applySaveErrors,
  buildSave,
  cellText,
  cellToken,
  cellView,
  createEditState,
  editCells,
  editCellDetail,
  editedStarts,
  rebase,
  rowCountAfter,
  unsavedCount,
  withLines,
  type BookEditState,
  type EditLine,
  type NewLine,
} from '../lib/book-edit-state.js';
import { bulkText, type BulkAction } from '../lib/bulk.js';
import { errorCode, errorMessage } from '../lib/api-errors.js';
import { LINE_KINDS, inactiveText, kindLabel, lineLabel, priceKindText, refusalText } from '../lib/grid-labels.js';
import { formatPriceCell, type PriceCellLanguage } from '../lib/price-cell.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';
import { AddLineDialog, type AddLineMode } from './AddLineDialog.js';
import { BulkChangeDialog } from './BulkChangeDialog.js';
import { CellDetailDialog } from './CellDetailDialog.js';
import { ImportDialog } from './ImportDialog.js';
import { downloadText } from '../lib/download.js';
import { exportFiles } from '../lib/price-book-csv.js';
import { PRECEDENCE_ANCHOR } from './PrecedenceView.js';

/**
 * A price book's prices (feature 161, US2 — FR-006–FR-017, FR-036, FR-037).
 *
 * The admin kit's `EditableGrid` carries the interaction — keyboard, selection,
 * clipboard, undo — and this component the meaning: one line per selection,
 * one column per quantity tier, a price per cell, read with the price-cell
 * parser and kept in the edit state (`book-edit-state.ts`) until one batch is
 * saved against the version the edits started from.
 *
 * **Pages are pages of lines** (`GET …/lines`, G15): a line is never split, a
 * product's variant lines come on its page, and the total is the total of
 * lines. Edits are keyed by selection, so they survive page changes, and a page
 * read again shows them over what the server answers. Lines added through the
 * pickers sit at the top of every page until they are saved.
 *
 * **Render budget** (SC-004, FR-036): each cell's memo token is its view — its
 * price, window, inherited value and error — so a change renders the cells
 * whose view changed and no other; typing renders the edited cell only (the
 * kit's editor state).
 */

const PAGE_SIZES = [50, 100, 200] as const;
const MAX_ROWS = 5000;
/** Rows per read of an export (`GET …/rows` pages at most 1 000). */
const EXPORT_PAGE_SIZE = 1000;

type Notice =
  | { readonly kind: 'invalid'; readonly count: number }
  | { readonly kind: 'refused'; readonly count: number }
  | { readonly kind: 'stale'; readonly count: number }
  | { readonly kind: 'limit'; readonly count: number }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'existing'; readonly products: readonly { readonly name: string; readonly sku: string }[] };

type Dialog =
  | { readonly kind: 'products' }
  | { readonly kind: 'line'; readonly mode: AddLineMode }
  | { readonly kind: 'bulk'; readonly cells: readonly { rowKey: string; columnKey: string }[] }
  | { readonly kind: 'detail'; readonly lineKey: string; readonly start: number }
  | { readonly kind: 'tier' }
  | { readonly kind: 'import' };

/** Where a percentage of this book is taken from (FR-007). */
function referenceOf(book: PriceBook): 'base' | 'catalogue' | 'productBase' {
  if (book.isSystem) return 'productBase';
  return book.type === 'regular' && book.audience.kind === 'everyone' ? 'base' : 'catalogue';
}

export function PriceBookGrid(props: {
  readonly book: PriceBook;
  readonly editable: boolean;
  /** The book read again after a save or a stale refusal. */
  readonly onBookChanged: (book: PriceBook) => void;
  /** A search to open on — a link to a row names its line this way (US5). */
  readonly initialSearch?: string;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { language: adminLanguage } = useTranslationContext();
  const language: PriceCellLanguage = adminLanguage === 'pl' ? 'pl' : 'en';
  const { hasPermission } = useAuth();
  const { book, editable } = props;
  const id = useId();
  const gridRef = useRef<EditableGridHandle | null>(null);

  const [state, setState] = useState<BookEditState>(() => createEditState({ version: book.version, isBase: book.isSystem }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50);
  const [searchText, setSearchText] = useState(props.initialSearch ?? '');
  const [search, setSearch] = useState(props.initialSearch?.trim() ?? '');
  const [kind, setKind] = useState<PriceBookSelectionKind | ''>('');
  const [pageLines, setPageLines] = useState<PriceBookLine[] | null>(null);
  const [totalLines, setTotalLines] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const cache = useRef(new Map<string, { data: PriceBookLine[]; totalLines: number }>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [extraStarts, setExtraStarts] = useState<number[]>([]);
  const [active, setActive] = useState<{ rowKey: string; columnKey: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState('');

  const unsaved = unsavedCount(state);
  useUnsavedChangesPrompt(unsaved > 0);

  // The search settles before it is asked.
  useEffect(() => {
    if (searchText.trim() === search) return undefined;
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 300);
    return (): void => clearTimeout(timer);
  }, [searchText, search]);

  // One page of lines, cached per version and query (data-model §1).
  useEffect(() => {
    const key = `${book.version}|${page}|${pageSize}|${kind}|${search}`;
    const cached = cache.current.get(key);
    const take = (answer: { data: PriceBookLine[]; totalLines: number }): void => {
      setPageLines(answer.data);
      setTotalLines(answer.totalLines);
      setState((current) => withLines(current, answer.data));
    };
    if (cached) {
      take(cached);
      return undefined;
    }
    let cancelled = false;
    setLoadError(null);
    setPageLines(null);
    api
      .lines(book.id, { page, pageSize, ...(kind ? { kind: [kind] } : {}), ...(search ? { search } : {}) })
      .then((answer) => {
        if (cancelled) return;
        const value = { data: answer.data, totalLines: answer.meta.totalLines };
        cache.current.set(key, value);
        take(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err, ''));
      });
    return (): void => {
      cancelled = true;
    };
  }, [api, book.id, book.version, page, pageSize, kind, search, reload]);

  // ---- What the grid shows ------------------------------------------------------

  const starts = useMemo(
    () => [...new Set([1, ...book.tierStarts, ...extraStarts, ...editedStarts(state)])].sort((a, b) => a - b),
    [book.tierStarts, extraStarts, state],
  );

  const orderedKeys = useMemo((): string[] => {
    const lines = [...state.lines.values()];
    const order = (l: EditLine): number => LINE_KINDS.indexOf(l.kind);
    const edited = new Set([...state.edits.keys()].map((k) => k.slice(0, k.lastIndexOf('@'))));
    // A product's variant lines: those the book prices, those being edited, and
    // — once the operator asks — every variant the catalogue knows (FR-009).
    const variantsOf = (headKey: string): EditLine[] =>
      lines
        .filter((l) => l.parentKey === headKey && (l.rows.length > 0 || edited.has(l.key) || expanded.has(headKey)))
        .sort((a, b) => (a.labels.variantSku ?? '').localeCompare(b.labels.variantSku ?? ''));
    const added = lines
      .filter((l) => l.added && l.parentKey === null)
      .sort((a, b) => order(a) - order(b) || lineLabel(t, a).label.localeCompare(lineLabel(t, b).label));
    const keys: string[] = [];
    for (const line of added) keys.push(line.key);
    for (const head of pageLines ?? []) {
      const known = state.lines.get(head.selectionKey);
      if (!known || known.added) continue;
      keys.push(head.selectionKey);
      for (const variant of variantsOf(head.selectionKey)) keys.push(variant.key);
    }
    return keys;
  }, [state.lines, state.edits, pageLines, expanded, t]);

  const rows = useMemo(
    (): EditableGridRow[] =>
      orderedKeys.map((key) => {
        const line = state.lines.get(key)!;
        const { label, detail } = lineLabel(t, line);
        return {
          key,
          label,
          header: (
            <span className={line.kind === 'variant' ? 'block pl-4' : 'block'}>
              <span className="font-medium">{label}</span>
              {line.added ? (
                <Badge variant="outline" className="ml-2">
                  {t('grid.line.new')}
                </Badge>
              ) : null}
              <span className="block text-xs text-muted-foreground">{detail}</span>
              {line.inactiveReason ? (
                <span className="block text-xs text-amber-800">{t('grid.line.inactive', { reason: inactiveText(t, line.inactiveReason) })}</span>
              ) : null}
            </span>
          ),
        };
      }),
    [orderedKeys, state.lines, t],
  );

  const columns = useMemo(
    () => starts.map((start) => ({ key: String(start), label: t('grid.column', { start }) })),
    [starts, t],
  );

  const getText = useCallback((rowKey: string, columnKey: string) => cellText(stateRef.current, rowKey, Number(columnKey), language), [language]);

  const getError = useCallback(
    (rowKey: string, columnKey: string): string | undefined => {
      const view = cellView(stateRef.current, rowKey, Number(columnKey));
      if (view.invalid) return refusalText(t, view.invalid.reason);
      if (view.error) return t(`errors.${view.error}`);
      return undefined;
    },
    [t],
  );

  /** The product line's view at a start, for an empty variant cell (FR-009). */
  const productView = (line: EditLine, start: number) =>
    line.parentKey ? cellView(stateRef.current, line.parentKey, start) : null;

  const getCellToken = useCallback(
    (rowKey: string, columnKey: string): string => cellToken(stateRef.current, rowKey, Number(columnKey)),
    [],
  );

  const renderCell = useCallback(
    (ctx: EditableGridRenderContext): ReactNode => {
      const current = stateRef.current;
      const line = current.lines.get(ctx.rowKey);
      if (!line) return null;
      const start = Number(ctx.columnKey);
      const view = cellView(current, ctx.rowKey, start);
      if (view.invalid) return <span>{view.invalid.text}</span>;
      if (view.price) {
        return (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className="inline-flex items-center gap-1">
              <PriceKindIcon price={view.price} />
              <span>{formatPriceCell(view.price, language)}</span>
              {view.edited ? (
                <span title={t('grid.cell.unsaved')}>
                  <Circle className="h-2 w-2 fill-current text-primary" aria-hidden="true" />
                  <span className="sr-only">{t('grid.cell.unsaved')}</span>
                </span>
              ) : null}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {priceKindText(t, view.price, referenceOf(book))}
              {view.custom && view.window ? ` · ${view.window.min}–${view.window.max ?? '∞'}` : ''}
            </span>
          </span>
        );
      }
      if (view.inherited) {
        return (
          <span className="text-xs italic text-muted-foreground">
            {t('grid.cell.inherits', { from: view.inherited.from, price: formatPriceCell(view.inherited.price, language) })}
          </span>
        );
      }
      const parent = productView(line, start);
      const parentPrice = parent?.price ?? parent?.inherited?.price ?? null;
      if (parentPrice) {
        return (
          <span className="text-xs italic text-muted-foreground">
            {t('grid.cell.asProduct', { price: formatPriceCell(parentPrice, language) })}
          </span>
        );
      }
      return (
        <span className="text-xs text-muted-foreground" title={t('grid.cell.notPricedTitle')}>
          {t('grid.cell.notPriced')}
        </span>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, t, book.isSystem, book.type, book.audience.kind],
  );

  const onChange = useCallback((changes: readonly EditableGridCellChange[], _reason: EditableGridChangeReason): void => {
    setNotice((current) => (current?.kind === 'invalid' || current?.kind === 'limit' ? null : current));
    setState((current) => editCells(current, changes.map((change) => ({ lineKey: change.rowKey, start: Number(change.columnKey), text: change.text }))));
  }, []);

  // ---- Actions --------------------------------------------------------------------

  const addNewLines = (lines: readonly NewLine[]): void => {
    const result = addLines(stateRef.current, lines);
    setState(result.state);
    setStatus(t('grid.status.linesAdded', { count: result.added }));
  };

  /**
   * Products picked in the browser. A product whose line sits on a page not
   * loaded is unknown to the browser, and adding it again would overwrite its
   * stored price on save; so the book's membership is asked first — once, for
   * every pick (`GET …/:id/product-lines`) — and a product already in the book
   * is refused and offered to be opened instead.
   */
  const addProducts = async (items: readonly ProductBrowserItem[]): Promise<void> => {
    let present: Set<string>;
    try {
      present = new Set(await api.productLines(book.id, items.map((item) => item.id)));
    } catch (err) {
      setNotice({ kind: 'error', message: errorMessage(err, t('grid.error.membership')) });
      return;
    }
    const fresh = items.filter((item) => !present.has(item.id));
    const existing = items.filter((item) => present.has(item.id));
    addNewLines(
      fresh.map((item) => ({
        kind: 'product' as const,
        selection: { productId: item.id },
        labels: {
          productName: productDisplayName(item),
          productSku: item.sku,
          variantLabel: null,
          variantSku: null,
          categoryPath: null,
          attributeLabel: null,
          attributeValueLabel: null,
        },
      })),
    );
    setNotice(existing.length > 0 ? { kind: 'existing', products: existing.map((item) => ({ name: productDisplayName(item), sku: item.sku })) } : null);
    setDialog(null);
  };

  /** Open a line where it is: search for its identifier, from the first page. */
  const openLine = (identifier: string): void => {
    setSearchText(identifier);
    setSearch(identifier);
    setKind('');
    setPage(1);
    setNotice(null);
  };

  const addAllProductsLine = (): void => addNewLines([{ kind: 'all', selection: {}, labels: { productName: null, productSku: null, variantLabel: null, variantSku: null, categoryPath: null, attributeLabel: null, attributeValueLabel: null } }]);

  const activeLine = active ? state.lines.get(active.rowKey) : undefined;
  const activeProductKey = activeLine ? (activeLine.kind === 'product' ? activeLine.key : activeLine.parentKey) : null;

  const toggleVariants = async (): Promise<void> => {
    if (!activeProductKey) return;
    const head = stateRef.current.lines.get(activeProductKey);
    if (!head?.selection.productId) return;
    if (expanded.has(activeProductKey)) {
      setExpanded((current) => new Set([...current].filter((k) => k !== activeProductKey)));
      return;
    }
    try {
      const variants = await api.productVariants(head.selection.productId);
      const shown = addLines(
        stateRef.current,
        variants.map((v) => ({
          kind: 'variant' as const,
          selection: { variantId: v.id, productId: head.selection.productId },
          labels: { ...head.labels, variantSku: v.sku, variantLabel: null },
          parentKey: activeProductKey,
        })),
        { unsaved: false },
      );
      setState(shown.state);
      setExpanded((current) => new Set([...current, activeProductKey]));
      setStatus(variants.length === 0 ? t('grid.status.noVariants') : t('grid.status.variantsShown', { count: variants.length }));
    } catch (err) {
      setNotice({ kind: 'error', message: errorMessage(err, t('grid.error.variants')) });
    }
  };

  const applyBulk = (action: BulkAction, cells: readonly { rowKey: string; columnKey: string }[]): void => {
    const changes: EditableGridCellChange[] = [];
    for (const cell of cells) {
      const view = cellView(stateRef.current, cell.rowKey, Number(cell.columnKey));
      const text = bulkText(action, view.price, language);
      if (text !== null) changes.push({ ...cell, text });
    }
    gridRef.current?.apply(changes, action.kind === 'clear' ? 'clear' : 'edit');
    setDialog(null);
    setStatus(t('grid.status.bulkApplied', { count: changes.length }));
  };

  const save = async (): Promise<void> => {
    const plan = buildSave(stateRef.current);
    if ('blocked' in plan) {
      setNotice({ kind: 'invalid', count: plan.blocked.invalid });
      return;
    }
    if (!book.isSystem) {
      const after = rowCountAfter(stateRef.current, book.rowCount);
      if (after > MAX_ROWS) {
        setNotice({ kind: 'limit', count: after });
        return;
      }
    }
    const changes = plan.body.upsert.length + plan.body.delete.length;
    setSaving(true);
    setNotice(null);
    setStatus(t('grid.status.saving', { count: changes }));
    try {
      const result = await api.writeRows(book.id, plan.body, stateRef.current.baseVersion);
      const fresh = await api.get(book.id);
      cache.current.clear();
      setState(afterSave(stateRef.current, result.version));
      gridRef.current?.clearHistory();
      setExtraStarts([]);
      setExpanded(new Set());
      setReload((n) => n + 1);
      props.onBookChanged(fresh);
      setStatus(t('grid.status.saved', { count: changes }));
    } catch (err) {
      setStatus('');
      if (errorCode(err) === 'PRICE_BOOK_STALE') {
        setStale(true);
        setNotice({ kind: 'stale', count: unsavedCount(stateRef.current) });
        try {
          const fresh = await api.get(book.id);
          cache.current.clear();
          props.onBookChanged(fresh);
          setReload((n) => n + 1);
        } catch {
          // The alert stands; the operator may reload the page.
        }
      } else {
        const rowErrors = rowErrorsOf(err);
        if (rowErrors.length > 0) {
          setState((current) => applySaveErrors(current, plan, rowErrors));
          setNotice({ kind: 'refused', count: new Set(rowErrors.map((e) => e.index ?? e.rowId)).size });
        } else {
          setNotice({ kind: 'error', message: errorMessage(err, t('grid.error.save')) });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const reapply = (): void => {
    setState((current) => rebase(current, book.version));
    setStale(false);
    setNotice(null);
  };

  const discard = (): void => {
    setState((current) => ({ ...rebase(current, book.version), edits: new Map(), lines: new Map([...current.lines].filter(([, l]) => !l.added)) }));
    gridRef.current?.clearHistory();
    setStale(false);
    setNotice(null);
  };

  const openDetail = (): void => {
    const selection = gridRef.current?.selection();
    if (!selection) return;
    setDialog({ kind: 'detail', lineKey: selection.active.rowKey, start: Number(selection.active.columnKey) });
  };

  const openBulk = (): void => {
    const selection = gridRef.current?.selection();
    if (!selection) return;
    setDialog({ kind: 'bulk', cells: selection.cells });
  };

  /**
   * The book's rows for the current filter as CSV (FR-018, T093): read 1 000
   * at a time, written as files of at most 5 000 rows in the admin language's
   * decimal separator.
   */
  const exportRows = async (): Promise<void> => {
    setStatus(t('grid.csv.status.exporting'));
    try {
      const rows: PriceBookRow[] = [];
      for (let page = 1; ; page += 1) {
        const answer = await api.rows(book.id, {
          ...(kind ? { selectionKind: [kind] } : {}),
          ...(search ? { search } : {}),
          page,
          pageSize: EXPORT_PAGE_SIZE,
        });
        rows.push(...answer.data);
        if (answer.data.length < EXPORT_PAGE_SIZE || rows.length >= answer.meta.totalCount) break;
      }
      const files = exportFiles(rows, { bookName: book.name, date: new Date(), language });
      for (const file of files) downloadText(file.name, file.content);
      setStatus(
        files.length === 1
          ? t('grid.csv.status.exported', { rows: rows.length })
          : t('grid.csv.status.exportedFiles', { rows: rows.length, files: files.length }),
      );
    } catch (err) {
      setStatus('');
      setNotice({ kind: 'error', message: errorMessage(err, t('grid.csv.error.export')) });
    }
  };

  const imported = async (changes: number): Promise<void> => {
    setDialog(null);
    setStatus(t('grid.csv.status.imported', { count: changes }));
    try {
      const fresh = await api.get(book.id);
      cache.current.clear();
      setState(afterSave(stateRef.current, fresh.version));
      gridRef.current?.clearHistory();
      setReload((n) => n + 1);
      props.onBookChanged(fresh);
    } catch (err) {
      setNotice({ kind: 'error', message: errorMessage(err, t('grid.error.load')) });
    }
  };

  const alreadyAddedIds = useMemo(
    () => [...state.lines.values()].filter((l) => l.kind === 'product' && l.selection.productId).map((l) => l.selection.productId!),
    [state.lines],
  );

  const totalPages = Math.max(1, Math.ceil(totalLines / pageSize));
  const offsetOfPage = (page - 1) * pageSize;
  const addedCount = orderedKeys.length - (pageLines ? orderedKeys.filter((k) => !state.lines.get(k)?.added).length : 0);

  const detailLine = dialog?.kind === 'detail' ? state.lines.get(dialog.lineKey) : undefined;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('grid.note')}{' '}
        {/* The precedence section of *Pricing settings* (T086a). */}
        <Link to={`/price-lists/display-modes#${PRECEDENCE_ANCHOR}`} className="underline underline-offset-2">
          {t('grid.noteLink')}
        </Link>
      </p>

      {editable ? null : <p className="text-sm text-muted-foreground">{t('grid.readOnly')}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-search`}>{t('grid.search')}</Label>
          <Input id={`${id}-search`} type="search" className="w-64" value={searchText} onChange={(event): void => setSearchText(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-kind`}>{t('grid.kindFilter')}</Label>
          <Select
            id={`${id}-kind`}
            value={kind}
            onChange={(event): void => {
              setKind(event.target.value as PriceBookSelectionKind | '');
              setPage(1);
            }}
          >
            <option value="">{t('priceBooks.list.filters.any')}</option>
            {LINE_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(t, k)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div role="toolbar" aria-label={t('grid.toolbar')} className="flex flex-wrap gap-2">
        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                <ListPlus aria-hidden="true" />
                {t('grid.addLines')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={!hasPermission('catalog:read')}
                onSelect={(): void => setDialog({ kind: 'products' })}
              >
                {t('grid.addLines.products')}
              </DropdownMenuItem>
              {book.isSystem ? null : (
                <>
                  <DropdownMenuItem onSelect={(): void => setDialog({ kind: 'line', mode: 'category' })}>{t('grid.addLines.category')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={(): void => setDialog({ kind: 'line', mode: 'attribute' })}>{t('grid.addLines.attribute')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={(): void => setDialog({ kind: 'line', mode: 'category_attribute' })}>
                    {t('grid.addLines.categoryAttribute')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={addAllProductsLine}>{t('grid.addLines.all')}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {editable ? (
          <Button type="button" variant="outline" onClick={openBulk}>
            <SlidersHorizontal aria-hidden="true" />
            {t('grid.bulk.open')}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={openDetail}>
          <TextCursorInput aria-hidden="true" />
          {t('grid.detail.open')}
        </Button>
        {editable ? (
          <Button type="button" variant="outline" onClick={(): void => setDialog({ kind: 'tier' })}>
            <PlusCircle aria-hidden="true" />
            {t('grid.tier.open')}
          </Button>
        ) : null}
        {/* The catalogue's variant read needs `catalog:read`; without it the
            book's priced variants still show, and the expansion is absent. */}
        {hasPermission('catalog:read') ? (
        <Button
          type="button"
          variant="outline"
          disabled={!activeProductKey}
          aria-pressed={activeProductKey ? expanded.has(activeProductKey) : false}
          onClick={(): void => void toggleVariants()}
        >
          <Layers aria-hidden="true" />
          {activeProductKey && expanded.has(activeProductKey) ? t('grid.variants.hide') : t('grid.variants.show')}
        </Button>
        ) : null}
        {/* CSV export for every reader; import only on a book the caller may
            change, and never over unsaved edits (FR-042). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <FileSpreadsheet aria-hidden="true" />
              {t('grid.csv.menu')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={(): void => void exportRows()}>{t('grid.csv.export')}</DropdownMenuItem>
            {editable && unsaved === 0 ? (
              <DropdownMenuItem onSelect={(): void => setDialog({ kind: 'import' })}>{t('grid.csv.import')}</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editable && unsaved > 0 ? <p className="text-xs text-muted-foreground">{t('grid.csv.importBlocked')}</p> : null}

      {notice ? <GridNotice notice={notice} onReapply={reapply} onDiscard={discard} onOpen={openLine} /> : null}

      {loadError !== null ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('grid.error.load')}
              {loadError ? <span className="block text-xs">{loadError}</span> : null}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={(): void => setReload((n) => n + 1)}>
              <RotateCcw aria-hidden="true" />
              {t('priceBooks.common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : pageLines === null && orderedKeys.length === 0 ? (
        <div aria-busy="true" className="space-y-2">
          <p className="sr-only">{t('grid.loading')}</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : orderedKeys.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border px-4 py-10 text-center">
          <Tag className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{search || kind ? t('grid.empty.filtered') : t('grid.empty.title')}</p>
          <p className="text-sm text-muted-foreground">{search || kind ? t('grid.empty.filteredBody') : t('grid.empty.body')}</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <EditableGrid
            ref={gridRef}
            label={t('grid.label', { name: book.name })}
            rowHeaderLabel={t('grid.rowHeader')}
            columns={columns}
            rows={rows}
            readOnly={!editable}
            totalRowCount={totalLines + addedCount}
            rowIndexOffset={offsetOfPage}
            getText={getText}
            getError={getError}
            getCellToken={getCellToken}
            renderCell={renderCell}
            onChange={onChange}
            onSelectionChange={(selection): void => setActive(selection.active)}
          />
        </div>
      )}

      {totalLines > 0 ? (
        <PaginationFooter
          page={page - 1}
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          total={totalLines}
          onPageSizeChange={(next): void => {
            setPageSize(next);
            setPage(1);
          }}
          onPrev={(): void => setPage((p) => Math.max(1, p - 1))}
          onNext={(): void => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}

      <p role="status" className="sr-only">
        {status}
      </p>

      {editable ? (
        <StickyFormActions className="flex flex-wrap items-center gap-3">
          <span data-testid="unsaved-count" className="text-sm">
            {t('grid.unsaved', { count: unsaved })}
          </span>
          <Button type="button" onClick={(): void => void save()} disabled={saving || stale || unsaved === 0} aria-busy={saving}>
            <Save aria-hidden="true" />
            {saving ? t('grid.saving') : t('grid.save')}
          </Button>
          <Button type="button" variant="ghost" disabled={saving || unsaved === 0} onClick={discard}>
            {t('grid.discard')}
          </Button>
        </StickyFormActions>
      ) : null}

      {dialog?.kind === 'import' ? (
        <ImportDialog book={book} onClose={(): void => setDialog(null)} onImported={(changes): void => void imported(changes)} />
      ) : null}
      {dialog?.kind === 'products' ? (
        <ProductBrowserDialog
          open
          title={t('grid.addLines.productsTitle')}
          rules={{ initialStatus: 'all' }}
          alreadyAddedIds={alreadyAddedIds}
          onConfirm={(items): void => void addProducts(items)}
          onCancel={(): void => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'line' ? (
        <AddLineDialog
          mode={dialog.mode}
          onClose={(): void => setDialog(null)}
          onAdd={(line): void => {
            addNewLines([line]);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'bulk' ? (
        <BulkChangeDialog cells={dialog.cells.length} onClose={(): void => setDialog(null)} onApply={(action): void => applyBulk(action, dialog.cells)} />
      ) : null}
      {dialog?.kind === 'detail' && detailLine ? (
        <CellDetailDialog
          title={t('grid.detail.title', { line: lineLabel(t, detailLine).label, start: dialog.start })}
          line={detailLine}
          start={dialog.start}
          view={cellView(state, dialog.lineKey, dialog.start)}
          bookId={book.id}
          language={language}
          onClose={(): void => setDialog(null)}
          onClear={(): void => {
            gridRef.current?.apply([{ rowKey: dialog.lineKey, columnKey: String(dialog.start) }].map((c) => ({ ...c, text: '' })), 'clear');
            setDialog(null);
          }}
          onApply={(detail): void => {
            const view = cellView(stateRef.current, dialog.lineKey, dialog.start);
            const sameWindow =
              detail.min === dialog.start && (view.window ? view.window.max === detail.max : detail.max === null);
            if (sameWindow) {
              // A price change only: one undoable step, as typed.
              gridRef.current?.apply([{ rowKey: dialog.lineKey, columnKey: String(dialog.start), text: formatPriceCell(detail.price, language) }], 'edit');
            } else {
              setState((current) => editCellDetail(current, dialog.lineKey, dialog.start, detail));
            }
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'tier' ? (
        <TierDialog
          existing={starts}
          onClose={(): void => setDialog(null)}
          onAdd={(start): void => {
            setExtraStarts((current) => [...current, start]);
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function rowErrorsOf(error: unknown): PriceBookRowError[] {
  const details = (error as { envelope?: { error?: { details?: unknown } } } | null)?.envelope?.error?.details;
  if (details && typeof details === 'object' && !Array.isArray(details) && Array.isArray((details as { errors?: unknown }).errors)) {
    return (details as { errors: PriceBookRowError[] }).errors;
  }
  return [];
}

function PriceKindIcon(props: { readonly price: PriceBookRowPrice }): ReactNode {
  if (props.price.type === 'percent') return <Percent className="h-3 w-3 text-muted-foreground" aria-hidden="true" />;
  if (props.price.type === 'amount') return <SlidersHorizontal className="h-3 w-3 text-muted-foreground" aria-hidden="true" />;
  return <Tag className="h-3 w-3 text-muted-foreground" aria-hidden="true" />;
}

function GridNotice(props: {
  readonly notice: Notice;
  readonly onReapply: () => void;
  readonly onDiscard: () => void;
  readonly onOpen: (identifier: string) => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const { notice } = props;
  if (notice.kind === 'existing') {
    const shown = notice.products.slice(0, 5);
    return (
      <Alert variant="warning">
        <AlertDescription className="space-y-2">
          <p>{t('grid.notice.existing', { names: notice.products.map((p) => p.name).join(', ') })}</p>
          <span className="flex flex-wrap gap-2">
            {shown.map((product) => (
              <Button key={product.sku} type="button" size="sm" variant="outline" onClick={(): void => props.onOpen(product.sku)}>
                {t('grid.notice.open', { name: product.name })}
              </Button>
            ))}
          </span>
        </AlertDescription>
      </Alert>
    );
  }
  if (notice.kind === 'stale') {
    return (
      <Alert variant="warning">
        <AlertDescription className="space-y-2">
          <p>{t('grid.notice.stale', { count: notice.count })}</p>
          <span className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={props.onReapply}>
              {t('grid.notice.reapply')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={props.onDiscard}>
              {t('grid.notice.discard')}
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    );
  }
  const text =
    notice.kind === 'invalid'
      ? t('grid.notice.invalid', { count: notice.count })
      : notice.kind === 'refused'
        ? t('grid.notice.refused', { count: notice.count })
        : notice.kind === 'limit'
          ? t('grid.notice.limit', { count: notice.count, max: MAX_ROWS })
          : notice.message;
  return (
    <Alert variant="destructive">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

/** Adding a quantity tier column (FR-006): a start not used yet. */
function TierDialog(props: { readonly existing: readonly number[]; readonly onAdd: (start: number) => void; readonly onClose: () => void }): ReactNode {
  const t = useTranslation('price_lists');
  const id = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = (): void => {
    const start = Number(value.trim());
    if (!Number.isInteger(start) || start < 2) {
      setError(t('grid.tier.invalid'));
      return;
    }
    if (props.existing.includes(start)) {
      setError(t('grid.tier.exists', { start }));
      return;
    }
    props.onAdd(start);
  };
  return (
    <ModalDialogLite title={t('grid.tier.title')} onClose={props.onClose} onConfirm={add} confirm={t('grid.tier.add')}>
      <Label htmlFor={id}>{t('grid.tier.label')}</Label>
      <Input
        id={id}
        inputMode="numeric"
        className="max-w-32"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event): void => setValue(event.target.value)}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </ModalDialogLite>
  );
}

function ModalDialogLite(props: {
  readonly title: string;
  readonly confirm: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const t = useTranslation('price_lists');
  return (
    <ModalDialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t('priceBooks.common.cancel')}
          </Button>
          <Button type="button" onClick={props.onConfirm}>
            {props.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-1">{props.children}</div>
    </ModalDialog>
  );
}
