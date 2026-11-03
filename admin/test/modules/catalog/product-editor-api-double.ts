import { vi, type Mock } from 'vitest';

/**
 * Feature 170 — the `apiClient` double of the product editor tests. Kept in a module that
 * imports nothing but `vitest`, so a `vi.mock('@endora-commerce/admin-kit/lib')` factory can
 * import it without importing the module it is mocking (which deadlocks the mock).
 */
export const api: Record<'get' | 'put' | 'post' | 'patch' | 'delete', Mock> = {
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};
