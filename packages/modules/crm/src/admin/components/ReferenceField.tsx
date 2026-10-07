import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AtSign, Package, ShoppingCart } from 'lucide-react';
import {
  extractOpportunityReferenceTokens,
  foldDiacritics,
  formatOpportunityReferenceToken,
  type OpportunityReference,
  type OpportunityReferenceToken,
  type OpportunityReferenceType,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Button, Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { applyMention, findMentionTrigger, type MentionTrigger } from '../lib/mention-trigger.js';
import {
  chipBeside,
  isCanonical,
  readReferenceText,
  rectOfOffset,
  renderReferenceText,
  selectionOffsets,
  selectOffsets,
  type ChipFace,
} from '../lib/reference-editor-dom.js';

const SEARCH_DEBOUNCE_MS = 250;
/** Keystrokes closer together than this are one step of undo. */
const UNDO_COALESCE_MS = 800;
const UNDO_DEPTH = 200;
/** The gap between the line being typed and the list that opens at it. */
const LIST_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/**
 * The codes of the lists a reference is chosen from. Two are their owners' —
 * `catalog`'s product list and `orders`' order list — and a role without one is
 * simply not offered that button or that shortcut (research N-H3). The people
 * who may be mentioned are CRM's own lookup, offered to whoever may write.
 */
const PRODUCT_LIST_PERMISSION = 'catalog:read';
const ORDER_LIST_PERMISSION = 'orders:read';
const PEOPLE_LIST_PERMISSION = 'crm:write';

/** What the three kinds are called in this module's bundle keys. */
const KIND_KEY = { admin_user: 'person', order: 'order', product: 'product' } as const;

interface Suggestion {
  id: string;
  label: string;
  description?: string;
}

interface Snapshot {
  text: string;
  caret: number;
}

/** A Product's name in the language on screen, then any name it has, then its SKU. */
function productLabel(name: Record<string, string>, sku: string, language: string): string {
  const base = language.split('-')[0] ?? language;
  const sameLanguage = Object.keys(name).find((locale) => locale === base || locale.startsWith(`${base}-`));
  return name[language] || (sameLanguage ? name[sameLanguage] : undefined) || Object.values(name).find(Boolean) || sku;
}

const keyOf = (token: OpportunityReferenceToken): string => `${token.type}:${token.id}`;

export interface ReferenceFieldProps {
  /** The id a `<Label htmlFor>` names: the label is tied to the field and focuses it, as with a textarea. */
  id: string;
  /** The stored text — tokens and all. */
  value: string;
  onValueChange: (next: string) => void;
  /**
   * The Organization whose Orders may be referred to — the Opportunity's.
   * `null` while none is chosen (the create form): Orders are not offered yet.
   */
  organizationId: string | null;
  /**
   * What the tokens already in `value` name, as the server resolved them for
   * this reader — the `references` returned beside the text being edited.
   */
  references?: readonly OpportunityReference[];
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  /** The height the field starts at, in lines; it grows with its text. */
  rows?: number;
  autoFocus?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * The field a description, a note or a message is written in (User Stories 12
 * and 18; FR-045, FR-081, FR-082) — **and in which a reference is always read
 * as what it names, never as its token** (owner ruling, 2026-10-07; research
 * N-M10).
 *
 * What is stored and sent is the text with its tokens — `[[admin_user:<id>]]`,
 * `[[order:<id>]]`, `[[product:<id>]]`, the one grammar of the contracts
 * package. What is on screen is that text with each token drawn as a chip:
 * `@Tomasz Nowak`, an Order's number, a Product's name. That holds for a
 * mention just chosen and for one already in a text opened for editing, whose
 * names arrive in `references`. A target this reader may not see is a chip that
 * says *unavailable*, and its token goes back unchanged; a token the field has
 * no name for — typed or pasted by hand — stays the characters it is.
 *
 * **The field is plain text.** It is a `contenteditable` element, and nothing
 * the browser can put into one survives: a paste arrives as its text, a line
 * break is a line break, formatting commands do nothing. Its content is drawn
 * from the text and read back by `lib/reference-editor-dom.ts`; every edit
 * that is more than typing a character — choosing a mention, a paste, Enter,
 * removing a chip, undo — is made on the text and drawn again. A chip is one
 * character to the keyboard: the arrows step over it, Backspace and Delete take
 * it whole. Undo and redo are the field's own, a step per pause in the typing.
 *
 * **While typing**: `@` opens a list of people, `@@` of the Organization's
 * Orders, `@@@` of Products, **at the place it was typed** — under that line,
 * above it when there is no room below, never outside the window — narrowed by
 * whatever is typed next (`lib/mention-trigger.ts` says exactly when). Arrow
 * keys move through it, Enter or Tab puts the chip where the `@`s and the
 * letters were, Escape closes it and leaves them as typed. While the list is
 * open the field is a combobox to assistive technology; closed, it is a
 * multi-line text box under its label.
 *
 * **By button**: *Mention a person*, *Insert order* and *Insert product* each
 * open a search under the field; choosing a result puts its chip **where the
 * caret was**.
 *
 * Only what the reader may search is offered, by either way: the product search
 * needs `catalog:read`, the order search `orders:read` and an Organization, the
 * people `crm:write`.
 */
export function ReferenceField(props: ReferenceFieldProps): ReactNode {
  const {
    id,
    value,
    onValueChange,
    organizationId,
    references,
    maxLength,
    disabled = false,
    required,
    placeholder,
    rows = 4,
    autoFocus,
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
  } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const baseId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** The text the field shows now: what was last drawn into it or read out of it. */
  const model = useRef<string | null>(null);
  /** What the field can name: the server's references, and everything chosen here. */
  const known = useRef(new Map<string, { label: string | null; available: boolean }>());
  /** The last selection the field had — where a button's choice goes. */
  const lastSelection = useRef<{ start: number; end: number } | null>(null);
  const history = useRef<{ entries: Snapshot[]; index: number; typedAt: number }>({
    entries: [],
    index: -1,
    typedAt: 0,
  });
  const composing = useRef(false);
  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  const [picker, setPicker] = useState<OpportunityReferenceType | null>(null);
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  // --- Typing: the `@` shortcuts ------------------------------------------------
  /** The caret, as a place in the text, while the field has focus and nothing is selected. */
  const [typingAt, setTypingAt] = useState<number | null>(null);
  /** The run Escape closed: it stays closed until its `@` is gone. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  /** The last answer, and the search it answers — which may no longer be the one in the field. */
  const [answer, setAnswer] = useState<{
    kind: OpportunityReferenceType;
    query: string;
    found: Suggestion[];
    failed: boolean;
  } | null>(null);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSequence = useRef(0);

  const canProducts = hasPermission(PRODUCT_LIST_PERMISSION);
  const canOrders = hasPermission(ORDER_LIST_PERMISSION) && organizationId !== null;
  const canPeople = hasPermission(PEOPLE_LIST_PERMISSION);
  const offered = useCallback(
    (kind: OpportunityReferenceType): boolean =>
      kind === 'admin_user' ? canPeople : kind === 'order' ? canOrders : canProducts,
    [canPeople, canOrders, canProducts],
  );

  // --- Drawing the text ----------------------------------------------------------
  const describe = useCallback(
    (token: OpportunityReferenceToken): ChipFace | null => {
      const entry = known.current.get(keyOf(token));
      if (!entry) return null;
      if (!entry.available || entry.label === null) {
        return { type: token.type, available: false, text: t(`references.unavailable.${token.type}`) };
      }
      return {
        type: token.type,
        available: true,
        text: token.type === 'admin_user' ? `@${entry.label}` : entry.label,
      };
    },
    [t],
  );

  /** Draw `text`; with `caret`, take the focus and put the caret there. */
  const draw = useCallback(
    (text: string, caret?: number): void => {
      const element = field.current;
      if (!element) return;
      renderReferenceText(element, text, describe);
      element.dataset['empty'] = text === '' ? 'true' : 'false';
      model.current = text;
      if (caret === undefined) return;
      if (element.ownerDocument.activeElement !== element) element.focus();
      selectOffsets(element, caret);
      lastSelection.current = { start: caret, end: caret };
      setTypingAt(caret);
    },
    [describe],
  );

  const remember = (text: string, caret: number, typed: boolean): void => {
    const log = history.current;
    const now = Date.now();
    const top = log.entries[log.index];
    if (top && top.text === text) {
      top.caret = caret;
      return;
    }
    // A run of keystrokes is one step: the step is replaced while it grows.
    const growing = typed && log.typedAt !== 0 && now - log.typedAt < UNDO_COALESCE_MS && log.index > 0;
    log.entries = log.entries.slice(0, growing ? log.index : log.index + 1);
    log.entries.push({ text, caret });
    if (log.entries.length > UNDO_DEPTH) log.entries.shift();
    log.index = log.entries.length - 1;
    log.typedAt = typed ? now : 0;
  };

  const fits = (next: string): boolean => {
    if (typeof maxLength === 'number' && next.length > maxLength) {
      setProblem(t('references.error.tooLong'));
      return false;
    }
    setProblem(null);
    return true;
  };

  /** An edit made on the text: checked, drawn, remembered and handed up. */
  const commit = (next: string, caret: number): boolean => {
    if (!fits(next)) return false;
    draw(next, caret);
    remember(next, caret, false);
    onValueChange(next);
    return true;
  };

  /** The selection in the text — the field's own, else the last one it had, else the end. */
  const selectionNow = (): { start: number; end: number } => {
    const element = field.current;
    const text = model.current ?? '';
    return (
      (element ? selectionOffsets(element) : null) ??
      lastSelection.current ?? { start: text.length, end: text.length }
    );
  };

  const replaceSelection = (insert: string): boolean => {
    const text = model.current ?? '';
    const at = selectionNow();
    let piece = insert;
    let cut = false;
    if (typeof maxLength === 'number') {
      // A paste that does not fit is cut to what does, as a textarea cuts it.
      const room = maxLength - (text.length - (at.end - at.start));
      if (piece.length > room) {
        piece = piece.slice(0, Math.max(room, 0));
        cut = true;
      }
    }
    const done =
      piece === '' && at.start === at.end
        ? false
        : commit(`${text.slice(0, at.start)}${piece}${text.slice(at.end)}`, at.start + piece.length);
    if (cut) setProblem(t('references.error.tooLong'));
    return done;
  };

  const removeStretch = (start: number, end: number): void => {
    const text = model.current ?? '';
    commit(`${text.slice(0, start)}${text.slice(end)}`, start);
  };

  const travel = (step: -1 | 1): void => {
    const log = history.current;
    const target = log.entries[log.index + step];
    if (!target) return;
    log.index += step;
    log.typedAt = 0;
    setProblem(null);
    draw(target.text, target.caret);
    onValueChange(target.text);
  };

  // What the server resolved is what the field can name from the start.
  useLayoutEffect(() => {
    let learned = false;
    for (const reference of references ?? []) {
      const key = keyOf(reference);
      const entry = { label: reference.label, available: reference.available };
      const previous = known.current.get(key);
      if (!previous || previous.label !== entry.label || previous.available !== entry.available) {
        // A name chosen here is not taken back by an answer that has none.
        if (previous?.available && !entry.available) continue;
        known.current.set(key, entry);
        learned = true;
      }
    }
    const element = field.current;
    if (!element) return;
    if (model.current !== value) {
      // A value from outside: the first one, a form reset, a reload.
      const focused = element.ownerDocument.activeElement === element;
      draw(value, focused ? Math.min(lastSelection.current?.start ?? value.length, value.length) : undefined);
      const log = history.current;
      if (log.entries[log.index]?.text !== value) {
        history.current = { entries: [{ text: value, caret: value.length }], index: 0, typedAt: 0 };
      }
    } else if (learned && extractOpportunityReferenceTokens(value).length > 0) {
      const focused = element.ownerDocument.activeElement === element;
      draw(value, focused ? selectionNow().start : undefined);
    }
    // `draw` and `selectionNow` read refs; the text and its names are what this follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, references, draw]);

  // The label of the form: tied to the field by id, and a click on it focuses the field.
  useEffect(() => {
    const element = field.current;
    if (!element) return undefined;
    const label = Array.from(element.ownerDocument.querySelectorAll('label')).find(
      (candidate) => candidate.htmlFor === id,
    );
    if (!label) {
      setLabelId(undefined);
      return undefined;
    }
    if (!label.id) label.id = `${id}-label`;
    setLabelId(label.id);
    const focus = (): void => {
      if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') element.focus();
    };
    label.addEventListener('click', focus);
    return (): void => label.removeEventListener('click', focus);
  }, [id]);

  useEffect(() => {
    if (!autoFocus) return;
    const text = model.current ?? '';
    draw(text, text.length);
    // Once, when the field appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The caret, followed wherever it goes — a key, a click, a drag.
  useEffect(() => {
    const element = field.current;
    if (!element) return undefined;
    const document = element.ownerDocument;
    const follow = (): void => {
      if (document.activeElement !== element) return;
      const selection = selectionOffsets(element);
      if (!selection) return;
      lastSelection.current = selection;
      setTypingAt(selection.start === selection.end ? selection.start : null);
    };
    document.addEventListener('selectionchange', follow);
    return (): void => document.removeEventListener('selectionchange', follow);
  }, []);

  // --- What the browser is about to do, and what is done instead -----------------
  const actions = useRef({ replaceSelection, removeStretch, travel });
  actions.current = { replaceSelection, removeStretch, travel };
  useEffect(() => {
    const element = field.current;
    if (!element) return undefined;
    const before = (event: InputEvent): void => {
      const type = event.inputType;
      if (type === 'insertParagraph' || type === 'insertLineBreak') {
        event.preventDefault();
        actions.current.replaceSelection('\n');
        return;
      }
      if (type === 'historyUndo' || type === 'historyRedo') {
        event.preventDefault();
        actions.current.travel(type === 'historyUndo' ? -1 : 1);
        return;
      }
      // Plain text: no bold, no lists, nothing dropped in from elsewhere.
      if (type.startsWith('format') || type === 'insertFromDrop') {
        event.preventDefault();
        return;
      }
      if (type === 'deleteContentBackward' || type === 'deleteContentForward') {
        const selection = selectionOffsets(element);
        if (!selection || selection.start !== selection.end) return;
        const chip = chipBeside(
          element,
          selection.start,
          type === 'deleteContentBackward' ? 'before' : 'after',
        );
        if (!chip) return;
        event.preventDefault();
        actions.current.removeStretch(chip.start, chip.end);
      }
    };
    element.addEventListener('beforeinput', before as EventListener);
    return (): void => element.removeEventListener('beforeinput', before as EventListener);
  }, []);

  /** After the browser typed or deleted: read the text back, and keep the field in its three kinds of node. */
  const input = (): void => {
    const element = field.current;
    if (!element || composing.current) return;
    const text = readReferenceText(element);
    const selection = selectionOffsets(element);
    const caret = selection?.start ?? text.length;
    if (typeof maxLength === 'number' && text.length > maxLength) {
      // Past the limit: the field goes back to what it held.
      const previous = model.current ?? '';
      setProblem(t('references.error.tooLong'));
      draw(previous, Math.min(lastSelection.current?.start ?? previous.length, previous.length));
      return;
    }
    setProblem(null);
    element.normalize();
    // A token standing in the text as characters, that the field has a name for.
    const nameable = Array.from(element.childNodes).some(
      (node) =>
        node.nodeType === 3 &&
        extractOpportunityReferenceTokens(node.nodeValue ?? '').some((token) => known.current.has(keyOf(token))),
    );
    if (!isCanonical(element) || nameable) {
      // Something the browser put there, or a token typed or pasted by hand that has a name.
      draw(text, caret);
    } else {
      model.current = text;
      element.dataset['empty'] = text === '' ? 'true' : 'false';
      lastSelection.current = { start: caret, end: selection?.end ?? caret };
      setTypingAt(selection && selection.start !== selection.end ? null : caret);
    }
    remember(text, caret, true);
    onValueChange(text);
  };

  /** Where the caret is now, for a platform that does not announce every move of it. */
  const follow = (): void => {
    const element = field.current;
    const selection = element ? selectionOffsets(element) : null;
    if (!selection) return;
    lastSelection.current = selection;
    setTypingAt(selection.start === selection.end ? selection.start : null);
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (text !== '') replaceSelection(text);
  };

  /** What leaves the field is the text itself, so a chip copied here is a chip where it is pasted. */
  const copy = (event: ClipboardEvent<HTMLDivElement>, cut: boolean): void => {
    const element = field.current;
    const selection = element ? selectionOffsets(element) : null;
    if (!selection || selection.start === selection.end) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', (model.current ?? '').slice(selection.start, selection.end));
    if (cut) removeStretch(selection.start, selection.end);
  };

  const insert = (type: OpportunityReferenceType, chosen: string, label: string): void => {
    known.current.set(keyOf({ type, id: chosen }), { label, available: true });
    const text = model.current ?? '';
    const at = lastSelection.current ?? { start: text.length, end: text.length };
    const token = formatOpportunityReferenceToken(type, chosen);
    if (!commit(`${text.slice(0, at.start)}${token}${text.slice(at.end)}`, at.start + token.length)) return;
    setPicker(null);
    setNotice(t(`references.inserted.${type}`));
  };

  // --- By button: a search under the field -------------------------------------
  const search = useCallback(
    async (type: OpportunityReferenceType, query: string): Promise<void> => {
      const current = ++sequence.current;
      setSearching(true);
      setSearchFailed(false);
      try {
        const found: ComboboxOption<string>[] =
          type === 'order'
            ? organizationId === null
              ? []
              : (await crmApi.searchOrders(organizationId, query)).map((order) => ({
                  value: order.id,
                  label: order.businessId,
                }))
            : type === 'product'
              ? (await crmApi.searchProducts(query)).map((product) => ({
                  value: product.id,
                  label: productLabel(product.name, product.sku, language),
                  description: product.sku,
                }))
              : (await crmApi.lookupMentionable(organizationId, query)).map((person) => ({
                  value: person.id,
                  label: person.name,
                }));
        if (current === sequence.current) setOptions(found);
      } catch {
        if (current === sequence.current) {
          setOptions([]);
          setSearchFailed(true);
        }
      } finally {
        if (current === sequence.current) setSearching(false);
      }
    },
    [organizationId, language],
  );

  useEffect(() => {
    if (picker !== null) {
      setOptions([]);
      void search(picker, '');
    }
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [picker, search]);

  const toggle = (type: OpportunityReferenceType): void => {
    setProblem(null);
    setNotice('');
    setPicker((current) => (current === type ? null : type));
  };

  // --- While typing: the list at the caret ---------------------------------------
  const trigger = useMemo<MentionTrigger | null>(() => {
    if (disabled || typingAt === null) return null;
    const found = findMentionTrigger(value, typingAt);
    return found && offered(found.kind) ? found : null;
  }, [disabled, typingAt, value, offered]);
  const triggerKind = trigger?.kind ?? null;
  const triggerStart = trigger?.start ?? null;
  const triggerQuery = trigger?.query ?? null;
  const live = trigger !== null && triggerStart !== dismissed;

  // A run that is gone takes its dismissal with it: the next `@` opens again.
  useEffect(() => {
    if (triggerStart === null) setDismissed(null);
  }, [triggerStart]);

  useEffect(() => {
    if (!live || triggerKind === null || triggerQuery === null) {
      suggestSequence.current += 1;
      setAnswer(null);
      return undefined;
    }
    const current = ++suggestSequence.current;
    const run = async (): Promise<void> => {
      try {
        const found: Suggestion[] =
          triggerKind === 'admin_user'
            ? (await crmApi.lookupMentionable(organizationId, triggerQuery)).map((person) => ({
                id: person.id,
                label: person.name,
              }))
            : triggerKind === 'order'
              ? organizationId === null
                ? []
                : (await crmApi.searchOrders(organizationId, triggerQuery)).map((order) => ({
                    id: order.id,
                    label: order.businessId,
                  }))
              : (await crmApi.searchProducts(triggerQuery)).map((product) => ({
                  id: product.id,
                  label: productLabel(product.name, product.sku, language),
                  description: product.sku,
                }));
        if (current !== suggestSequence.current) return;
        setAnswer({ kind: triggerKind, query: triggerQuery, found, failed: false });
      } catch {
        if (current !== suggestSequence.current) return;
        setAnswer({ kind: triggerKind, query: triggerQuery, found: [], failed: true });
      }
    };
    // The bare `@` answers at once; a search waits for a pause in the typing.
    suggestTimer.current = setTimeout(() => void run(), triggerQuery === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return (): void => {
      if (suggestTimer.current !== null) clearTimeout(suggestTimer.current);
    };
  }, [live, triggerKind, triggerQuery, organizationId, language]);

  // Every new search starts at its first result.
  useEffect(() => {
    setActive(0);
  }, [triggerKind, triggerQuery]);

  // Between a keystroke and its answer the list is the previous answer, narrowed
  // by what is in the field now: Enter never chooses somebody the typed letters
  // have already ruled out, and the list does not blink on every key.
  const answered = answer !== null && answer.kind === triggerKind && answer.query === triggerQuery;
  const suggestions = useMemo<Suggestion[]>(() => {
    if (answer === null || answer.kind !== triggerKind || triggerQuery === null) return [];
    if (answer.query === triggerQuery) return answer.found;
    const needle = foldDiacritics(triggerQuery).toLowerCase();
    return answer.found.filter((suggestion) =>
      [suggestion.label, suggestion.description ?? ''].some((text) =>
        foldDiacritics(text).toLowerCase().includes(needle),
      ),
    );
  }, [answer, triggerKind, triggerQuery]);
  const failed = answered && answer?.failed === true;
  // Typed on past the last match — "@home tomorrow" — is a sentence, not a search.
  const exhausted =
    answered && !failed && suggestions.length === 0 && triggerQuery !== null && /\s/.test(triggerQuery);
  const open = live && !exhausted;
  const listed = open && suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0));
  const listId = `${baseId}-suggestions`;
  const hintId = `${baseId}-shortcuts`;
  const optionId = (index: number): string => `${listId}-${index}`;

  /**
   * Where the list goes: under the line the `@` is on, at the `@`; above that
   * line when the window has no room below; and never past the window's edge.
   * Measured against the field's own box, so it moves with the field.
   */
  const settle = useCallback((): void => {
    const element = field.current;
    const box = wrapper.current;
    const popup = list.current;
    if (!element || !box || !popup || triggerStart === null) return;
    const frame = box.getBoundingClientRect();
    const anchor = rectOfOffset(element, triggerStart) ?? element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth ?? frame.right;
    const viewHeight = view?.innerHeight ?? anchor.bottom + popup.offsetHeight + LIST_GAP_PX;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const below = anchor.bottom + LIST_GAP_PX + height <= viewHeight - VIEWPORT_MARGIN_PX;
    const above = anchor.top - LIST_GAP_PX - height >= VIEWPORT_MARGIN_PX;
    const top = below || !above ? anchor.bottom + LIST_GAP_PX : anchor.top - LIST_GAP_PX - height;
    // Never past the window's edge, nor past the field's own: what surrounds
    // the field may clip what sticks out of it.
    const left = Math.max(
      Math.max(VIEWPORT_MARGIN_PX, Math.min(frame.left, viewWidth - VIEWPORT_MARGIN_PX - width)),
      Math.min(anchor.left, viewWidth - VIEWPORT_MARGIN_PX - width, frame.right - width),
    );
    setPlace((previous) => {
      const next = { top: Math.round(top - frame.top), left: Math.round(left - frame.left) };
      return previous && previous.top === next.top && previous.left === next.left ? previous : next;
    });
  }, [triggerStart]);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return undefined;
    }
    settle();
    const element = field.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) return undefined;
    view.addEventListener('resize', settle);
    // Any scroll moves the line: the page's, a panel's, the field's own.
    view.addEventListener('scroll', settle, true);
    return (): void => {
      view.removeEventListener('resize', settle);
      view.removeEventListener('scroll', settle, true);
    };
  }, [open, settle, suggestions.length, triggerQuery, failed, answered]);

  const choose = (suggestion: Suggestion): void => {
    if (!trigger) return;
    known.current.set(keyOf({ type: trigger.kind, id: suggestion.id }), {
      label: suggestion.label,
      available: true,
    });
    const next = applyMention(model.current ?? value, trigger, suggestion.id);
    if (!commit(next.text, next.caret)) return;
    setAnswer(null);
    setNotice(t(`references.inserted.${trigger.kind}`));
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === 'Escape') {
        // Closes the list and nothing else: a dialog around the field stays open.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(triggerStart);
        return;
      }
      if (listed && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + step + suggestions.length) % suggestions.length);
        return;
      }
      if (listed && (event.key === 'Enter' || event.key === 'Tab')) {
        const chosen = suggestions[activeIndex];
        if (chosen) {
          event.preventDefault();
          choose(chosen);
          return;
        }
      }
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      travel(event.shiftKey ? 1 : -1);
      return;
    }
    if (command && !event.altKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      travel(1);
      return;
    }
    if (event.key === 'Enter') {
      // A line break is a character of the text, never a paragraph element.
      event.preventDefault();
      replaceSelection('\n');
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const element = field.current;
      const selection = element ? selectionOffsets(element) : null;
      if (!element || !selection || selection.start !== selection.end) return;
      const chip = chipBeside(element, selection.start, event.key === 'Backspace' ? 'before' : 'after');
      if (!chip) return;
      event.preventDefault();
      removeStretch(chip.start, chip.end);
    }
  };

  const shortcuts = [
    canPeople ? t('references.shortcut.person') : null,
    canOrders ? t('references.shortcut.order') : null,
    canProducts ? t('references.shortcut.product') : null,
  ].filter((item): item is string => item !== null);
  const anything = shortcuts.length > 0;
  const description = [describedBy, anything ? hintId : null].filter(Boolean).join(' ');
  const kindKey = triggerKind ? KIND_KEY[triggerKind] : 'person';

  return (
    <div className="space-y-2">
      <div ref={wrapper} className="relative">
        <div
          ref={field}
          id={id}
          role={listed ? 'combobox' : 'textbox'}
          // A combobox has no `aria-multiline` and no `aria-placeholder`; the
          // text box it is the rest of the time has both.
          {...(listed ? {} : { 'aria-multiline': true })}
          {...(labelId ? { 'aria-labelledby': labelId } : {})}
          {...(placeholder ? { 'data-placeholder': placeholder } : {})}
          {...(placeholder && !listed ? { 'aria-placeholder': placeholder } : {})}
          {...(description ? { 'aria-describedby': description } : {})}
          {...(invalid ? { 'aria-invalid': true } : {})}
          {...(required ? { 'aria-required': true } : {})}
          {...(disabled ? { 'aria-disabled': true } : {})}
          {...(listed
            ? {
                'aria-expanded': true,
                'aria-haspopup': 'listbox' as const,
                'aria-autocomplete': 'list' as const,
                'aria-controls': listId,
                'aria-activedescendant': optionId(activeIndex),
              }
            : {})}
          contentEditable={!disabled}
          suppressContentEditableWarning
          tabIndex={disabled ? -1 : 0}
          spellCheck
          style={{ minHeight: `${rows * 1.25 + 1}rem` }}
          className={[
            'max-h-96 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-5 shadow-sm',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
            'aria-invalid:border-destructive',
            'data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]',
          ].join(' ')}
          onInput={input}
          onKeyDown={keyDown}
          onPaste={paste}
          onCopy={(event): void => copy(event, false)}
          onCut={(event): void => copy(event, true)}
          onDrop={(event): void => event.preventDefault()}
          onCompositionStart={(): void => {
            composing.current = true;
          }}
          onCompositionEnd={(): void => {
            composing.current = false;
            input();
          }}
          onFocus={follow}
          onKeyUp={follow}
          onMouseUp={follow}
          onBlur={(): void => setTypingAt(null)}
        />

        {open ? (
          <div
            ref={list}
            style={place ?? { top: 0, left: 0, visibility: 'hidden' }}
            className="absolute z-50 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-input bg-background p-1 text-sm shadow-md"
          >
            <p className="px-2 py-1 text-xs text-muted-foreground">{t(`references.suggest.title.${kindKey}`)}</p>
            {listed ? (
              <ul
                id={listId}
                role="listbox"
                aria-label={t(`references.suggest.title.${kindKey}`)}
                className="max-h-60 overflow-y-auto"
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    // The field keeps the focus: the list is its popup, not a stop of its own.
                    onMouseDown={(event): void => event.preventDefault()}
                    onMouseEnter={(): void => setActive(index)}
                    onClick={(): void => choose(suggestion)}
                    className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 sm:min-h-9 ${
                      index === activeIndex ? 'bg-accent text-accent-foreground' : ''
                    }`}
                  >
                    <span className="truncate">{suggestion.label}</span>
                    {suggestion.description ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{suggestion.description}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-1.5 text-muted-foreground">
                {failed
                  ? t('references.suggest.error')
                  : answered
                    ? t(`references.suggest.empty.${kindKey}`)
                    : tCore('common.state.loading')}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {anything ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {canPeople ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'admin_user'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('admin_user')}
              >
                <AtSign aria-hidden="true" className="size-4" />
                {t('references.insert.person')}
              </Button>
            ) : null}
            {canOrders ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'order'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('order')}
              >
                <ShoppingCart aria-hidden="true" className="size-4" />
                {t('references.insert.order')}
              </Button>
            ) : null}
            {canProducts ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'product'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('product')}
              >
                <Package aria-hidden="true" className="size-4" />
                {t('references.insert.product')}
              </Button>
            ) : null}
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            <span>{t('references.shortcuts', { list: shortcuts.join(', ') })}</span>{' '}
            <span>{t('references.hint')}</span>
          </p>

          <div id={`${baseId}-picker`}>
            {picker !== null ? (
              <Combobox<string>
                key={picker}
                ariaLabel={t(`references.search.${KIND_KEY[picker]}`)}
                options={options}
                value={null}
                onChange={(chosen): void => {
                  const option = options.find((candidate) => candidate.value === chosen);
                  if (chosen && option) insert(picker, chosen, option.label);
                }}
                onSearchChange={(query): void => {
                  if (timer.current !== null) clearTimeout(timer.current);
                  timer.current = setTimeout(() => void search(picker, query), SEARCH_DEBOUNCE_MS);
                }}
                manualFilter
                loading={searching}
                placeholder={t(`references.search.${KIND_KEY[picker]}Placeholder`)}
                emptyMessage={
                  searchFailed
                    ? t('references.error.search')
                    : t(`references.search.${KIND_KEY[picker]}Empty`)
                }
              />
            ) : null}
          </div>

          {/*
            A polite live region, mounted before it has text. Not `role="status"`:
            the thread around this field owns the one status of its tab.
          */}
          <p aria-live="polite" className="sr-only">
            {notice}
          </p>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
