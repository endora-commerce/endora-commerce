import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// `globals: false` in the base vitest config means Testing Library's
// auto-cleanup isn't registered. Do it explicitly so each test gets a
// fresh DOM and findBy* queries don't collide with leftovers.
afterEach(() => {
  cleanup();
  setMobileViewport(false);
});

/** Default: desktop tier (min-width 1024px) for layout tests. */
let mobileViewport = false;

export function setMobileViewport(mobile: boolean): void {
  mobileViewport = mobile;
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 1024px')
        ? !mobileViewport
        : query.includes('max-width')
          ? mobileViewport
          : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
