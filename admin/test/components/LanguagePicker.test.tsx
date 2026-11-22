import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AppLanguageContext,
  TranslationProvider,
  type SupportedAdminLanguage,
} from '@endora-commerce/admin-kit/i18n';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import enBundle from '../../../packages/modules/_i18n/i18n/en.json';
import plBundle from '../../../packages/modules/_i18n/i18n/pl.json';

const { saveSpy, refreshSpy } = vi.hoisted(() => ({
  saveSpy: vi.fn<(language: SupportedAdminLanguage) => Promise<void>>(),
  refreshSpy: vi.fn<() => Promise<void>>(),
}));

vi.mock('@endora-commerce/admin-kit/i18n', async () => {
  const actual = await vi.importActual('@endora-commerce/admin-kit/i18n');
  return {
    ...(actual as Record<string, unknown>),
    setPreferredLanguage: (language: SupportedAdminLanguage) => saveSpy(language),
  };
});

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual('@endora-commerce/admin-kit/lib');
  return {
    ...(actual as Record<string, unknown>),
    useAuth: () => ({ refresh: refreshSpy }),
  };
});

const { LanguagePicker } = await import('../../../packages/admin-shell/src/components/LanguagePicker');

const bundles = {
  en: enBundle as Record<string, string>,
  pl: plBundle as Record<string, string>,
};
const errorKey = 'appShell.languageIndicator.saveFailed';

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Harness({ initialLanguage }: { initialLanguage: SupportedAdminLanguage }): ReactNode {
  const [language, setLanguage] = useState(initialLanguage);
  return (
    <TranslationProvider
      language={language}
      initialBundle={{ core: bundles[initialLanguage] }}
      initialFallbackBundle={{ core: bundles.en }}
    >
      <AppLanguageContext.Provider value={{ language, setLanguage }}>
        <LanguagePicker />
      </AppLanguageContext.Provider>
    </TranslationProvider>
  );
}

function renderPicker(language: SupportedAdminLanguage = 'en'): void {
  render(<Harness initialLanguage={language} />);
}

function trigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
}

async function select(language: SupportedAdminLanguage): Promise<void> {
  await userEvent.click(trigger());
  const menu = screen.getByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitemradio', { name: new RegExp(language.toUpperCase()) }));
}

beforeEach(() => {
  saveSpy.mockReset();
  refreshSpy.mockReset();
  refreshSpy.mockResolvedValue();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // The provider fetches bundles on a language flip. Return shipped copy for
  // each language; the mocked preference save never sends a PATCH.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname !== '/api/v1/admin/i18n/bundles') {
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
    const language = url.searchParams.get('language');
    if (language !== 'en' && language !== 'pl') throw new Error(`Unexpected language: ${language}`);
    return new Response(JSON.stringify({
      data: { language, version: 0, bundles: { core: bundles[language] } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LanguagePicker — preferred-language save feedback (#1769)', () => {
  it('mounts an empty, polite live region before any save', () => {
    renderPicker();
    const status = screen.getByRole('status');
    const wrapper = status.parentElement!;
    expect(wrapper).toHaveClass(
      'absolute',
      'right-0',
      'top-[calc(100%+4px)]',
      'z-[60]',
      'flex',
      'w-max',
      'max-w-[min(20rem,calc(100vw-16px))]',
      'flex-col',
      'items-end',
      'gap-1',
    );
    expect(wrapper).not.toHaveAttribute('style');
    expect(trigger().parentElement).toHaveClass('relative', 'mx-1.5');
    expect(trigger().parentElement).not.toHaveAttribute('style');
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(trigger()).not.toHaveAttribute('aria-describedby');
  });

  it('switches optimistically, closes and disables the picker, then refreshes after saving', async () => {
    const save = deferred<void>();
    const refresh = deferred<void>();
    const order: string[] = [];
    saveSpy.mockImplementation(async () => {
      order.push('save');
      await save.promise;
    });
    refreshSpy.mockImplementation(async () => {
      order.push('refresh');
      await refresh.promise;
    });
    renderPicker();
    const status = screen.getByRole('status');

    await select('pl');
    expect(trigger()).toHaveTextContent('PL');
    expect(trigger()).toHaveAttribute('aria-disabled', 'true');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(order).toEqual(['save']);
    expect(status).toBeEmptyDOMElement();

    save.resolve();
    await waitFor(() => expect(order).toEqual(['save', 'refresh']));
    expect(trigger()).toHaveAttribute('aria-disabled', 'true');
    refresh.resolve();
    await waitFor(() => expect(trigger()).not.toHaveAttribute('aria-disabled'));
    expect(trigger()).toHaveTextContent('PL');
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(trigger()).not.toHaveAttribute('aria-describedby');
  });

  it('keeps the saved language without save-error feedback when refresh fails', async () => {
    saveSpy.mockResolvedValue();
    refreshSpy.mockRejectedValue(new Error('Refresh failed'));
    renderPicker();
    const status = screen.getByRole('status');

    await select('pl');
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trigger()).not.toHaveAttribute('aria-disabled'));

    expect(saveSpy).toHaveBeenCalledExactlyOnceWith('pl');
    expect(trigger()).toHaveTextContent('PL');
    expect(status).toBeEmptyDOMElement();
    expect(trigger()).not.toHaveAttribute('aria-describedby');
  });

  it.each(['en', 'pl'] as const)(
    'rolls back and announces a refused save in %s without refreshing',
    async (initialLanguage) => {
      saveSpy.mockRejectedValue(new ApiError(503, {
        error: { code: 'INTERNAL', message: 'API refused the preference' },
      }));
      renderPicker(initialLanguage);
      const status = screen.getByRole('status');
      const next = initialLanguage === 'en' ? 'pl' : 'en';

      await select(next);
      await waitFor(() => expect(status).toHaveTextContent(bundles[initialLanguage][errorKey]!));
      if (initialLanguage === 'en') {
        expect(status).toHaveTextContent("Couldn't save your language preference. Try again.");
      }
      expect(trigger()).toHaveTextContent(initialLanguage.toUpperCase());
      expect(trigger()).not.toHaveAttribute('aria-disabled');
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(status).toHaveAttribute('data-tone', 'error');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByRole('status')).toBe(status);
      expect(trigger()).toHaveAttribute('aria-describedby', status.id);
      expect(status.id).not.toBe('');
    },
  );

  it('rolls back and shows the same user-facing error after a transport failure', async () => {
    saveSpy.mockRejectedValue(new TypeError('Network request failed'));
    renderPicker();
    await select('pl');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(bundles.en[errorKey]!));
    expect(trigger()).toHaveTextContent('EN');
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).not.toHaveTextContent('Network request failed');
  });

  it('clears the old error on reopening and keeps it clear on a successful retry', async () => {
    const retry = deferred<void>();
    saveSpy.mockRejectedValueOnce(new Error('First save failed'));
    saveSpy.mockImplementationOnce(() => retry.promise);
    renderPicker();
    const status = screen.getByRole('status');
    await select('pl');
    await waitFor(() => expect(status).toHaveTextContent(bundles.en[errorKey]!));

    await select('pl');
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(trigger()).toHaveTextContent('PL');
    expect(trigger()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(trigger()).not.toHaveAttribute('aria-describedby');
    retry.resolve();

    await waitFor(() => expect(trigger()).not.toHaveAttribute('aria-disabled'));
    expect(trigger()).toHaveTextContent('PL');
    expect(status).toBeEmptyDOMElement();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('rolls back and re-displays the error after a second failed save', async () => {
    saveSpy.mockRejectedValue(new Error('Still failing'));
    renderPicker();
    const status = screen.getByRole('status');
    await select('pl');
    await waitFor(() => expect(status).toHaveTextContent(bundles.en[errorKey]!));
    const firstMessage = status.firstChild;

    await select('pl');
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(status).toHaveTextContent(bundles.en[errorKey]!));
    expect(trigger()).toHaveTextContent('EN');
    expect(screen.getByRole('status')).toBe(status);
    expect(status.firstChild).not.toBe(firstMessage);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('does not save when selecting the current language after reopening', async () => {
    saveSpy.mockRejectedValue(new Error('Save failed'));
    renderPicker();
    const status = screen.getByRole('status');
    await select('pl');
    await waitFor(() => expect(status).toHaveTextContent(bundles.en[errorKey]!));

    await select('en');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(trigger()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('dismisses a save error with Escape while keeping the live region mounted', async () => {
    saveSpy.mockRejectedValue(new Error('Save failed'));
    renderPicker();
    const status = screen.getByRole('status');
    await select('pl');
    await waitFor(() => expect(status).toHaveTextContent(bundles.en[errorKey]!));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('status')).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(trigger()).not.toHaveAttribute('aria-describedby');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses a save error on an outside click while keeping the live region mounted', async () => {
    saveSpy.mockRejectedValue(new Error('Save failed'));
    renderPicker();
    const status = screen.getByRole('status');
    await select('pl');
    await waitFor(() => expect(status).toHaveTextContent(bundles.en[errorKey]!));

    fireEvent.mouseDown(document.body);

    expect(screen.getByRole('status')).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(trigger()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('dismisses a save error when reopening the menu without starting another save', async () => {
    saveSpy.mockRejectedValue(new Error('Save failed'));
    renderPicker();
    const status = screen.getByRole('status');
    await select('pl');
    await waitFor(() => expect(status).toHaveTextContent(bundles.en[errorKey]!));

    await userEvent.click(trigger());

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(trigger()).not.toHaveAttribute('aria-describedby');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('styles the trigger, the error and the open menu without inline styles', async () => {
    saveSpy.mockRejectedValue(new Error('Save failed'));
    renderPicker();
    const root = trigger().parentElement!;
    await select('pl');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(bundles.en[errorKey]!));
    // Opening the menu clears the error, so check the error state first.
    expect(root).not.toHaveAttribute('style');
    expect(root.querySelectorAll('[style]')).toHaveLength(0);

    await userEvent.click(trigger());
    const menu = screen.getByRole('menu');
    expect(root.querySelectorAll('[style]')).toHaveLength(0);
    // The panel itself is portalled and positioned by Radix, whose inline
    // placement is not ours to draw; every entry inside it is Tailwind.
    expect(menu.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('cannot start a duplicate request while a save is pending', async () => {
    const pending = deferred<void>();
    saveSpy.mockImplementation(() => pending.promise);
    renderPicker();
    await select('pl');
    expect(trigger()).toHaveAttribute('aria-disabled', 'true');

    // Busy, the trigger stays focusable (focus returns to it from the menu) but
    // opens for neither a pointer nor a key — the two ways Radix opens a menu.
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    pending.resolve();
    await waitFor(() => expect(trigger()).not.toHaveAttribute('aria-disabled'));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});

describe('LanguagePicker — the kit DropdownMenu keyboard contract (#1783)', () => {
  function focused(): Element | null {
    return document.activeElement;
  }

  function item(name: RegExp): HTMLElement {
    return within(screen.getByRole('menu')).getByRole('menuitemradio', { name });
  }

  it('opens from the keyboard and moves focus into the menu', async () => {
    renderPicker();
    trigger().focus();
    await userEvent.keyboard('{Enter}');

    const menu = screen.getByRole('menu', { name: bundles.en['appShell.languageIndicator.label']! });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(menu.contains(focused())).toBe(true);
    expect(focused()).toHaveAttribute('role', 'menuitemradio');
  });

  it('walks the entries with the arrow keys, Home and End', async () => {
    renderPicker();
    trigger().focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(focused()).toBe(item(/English/)));

    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe(item(/Polish/));
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe(item(/English/));
    await userEvent.keyboard('{End}');
    expect(focused()).toBe(item(/Polish/));
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe(item(/English/));
  });

  it('jumps to an entry by typing the start of its language name', async () => {
    renderPicker();
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('p');
    expect(focused()).toBe(item(/Polish/));
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    renderPicker();
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(focused()).toBe(trigger());
  });

  it('marks the current language as the checked entry', async () => {
    renderPicker('pl');
    await userEvent.click(trigger());
    const [first, second] = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    expect(first).toHaveAttribute('aria-checked', 'false');
    expect(second).toHaveAttribute('aria-checked', 'true');
  });

  it('saves the entry chosen with Enter and keeps focus on the trigger while saving', async () => {
    const pending = deferred<void>();
    saveSpy.mockImplementation(() => pending.promise);
    renderPicker();
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{End}{Enter}');

    expect(saveSpy).toHaveBeenCalledExactlyOnceWith('pl');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-disabled', 'true');
    // A disabled button cannot hold focus, so a keyboard user would be dropped
    // on <body> mid-save; the busy trigger is `aria-disabled` instead.
    await waitFor(() => expect(focused()).toBe(trigger()));
    pending.resolve();
    await waitFor(() => expect(trigger()).not.toHaveAttribute('aria-disabled'));
    expect(focused()).toBe(trigger());
  });
});
