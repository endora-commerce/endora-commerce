// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FocusOnMount } from '../../components/account/FocusOnMount';

/**
 * `specs/179-rfq-and-customer-notifications/` FR-050b — after *Mark all as
 * read* the button unmounts, so focus would fall to the document; the page
 * moves it to its heading instead. The island does that once, when it mounts.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

describe('FocusOnMount', () => {
  it('focuses the element it names when it mounts', () => {
    host = document.createElement('div');
    host.innerHTML = '<h2 id="notifications-heading" tabindex="-1">Notifications</h2><span id="slot"></span>';
    document.body.appendChild(host);
    const root = createRoot(host.querySelector('#slot')!);
    act(() => root.render(<FocusOnMount targetId="notifications-heading" />));
    expect(document.activeElement?.id).toBe('notifications-heading');
  });
});
