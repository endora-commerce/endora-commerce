import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, type ReactNode } from 'react';
import { fireEvent } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { useUnsavedChangesPrompt } from '../../src/lib/use-unsaved-changes-prompt';

const BUNDLE = passthroughBundle('core', ['form.unsavedChanges.confirm']);

function Harness({ when }: { when: boolean }): ReactNode {
  // A representative in-app link plus a same-route link.
  const ref = useRef<HTMLAnchorElement>(null);
  useUnsavedChangesPrompt(when);
  return (
    <div>
      <a ref={ref} href="/elsewhere" data-testid="leave">
        leave
      </a>
    </div>
  );
}

describe('useUnsavedChangesPrompt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks an in-app link click when the user cancels the confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { getByTestId } = renderWithI18n(<Harness when />, BUNDLE);

    const anchor = getByTestId('leave');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const prevented = !anchor.dispatchEvent(event);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true); // preventDefault() was called
  });

  it('allows an in-app link click when the user confirms', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { getByTestId } = renderWithI18n(<Harness when />, BUNDLE);

    const anchor = getByTestId('leave');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const prevented = !anchor.dispatchEvent(event);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(false);
  });

  it('does not intercept clicks when there are no unsaved changes', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { getByTestId } = renderWithI18n(<Harness when={false} />, BUNDLE);

    fireEvent.click(getByTestId('leave'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('arms a beforeunload handler only while dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { rerender } = renderWithI18n(<Harness when />, BUNDLE);
    expect(
      addSpy.mock.calls.some(([type]) => type === 'beforeunload'),
    ).toBe(true);

    // A fired beforeunload while dirty must be cancelled (prompts the user).
    const evt = new Event('beforeunload', { cancelable: true });
    const notCancelled = window.dispatchEvent(evt);
    expect(notCancelled).toBe(false);

    rerender(<Harness when={false} />);
    const evt2 = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(evt2)).toBe(true); // no longer cancelled
  });
});
