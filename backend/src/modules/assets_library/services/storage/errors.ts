// Adapter-side error classes — the upload pipeline / resolveUrl path map these
// onto the platform's standard HTTP error envelope codes (see contracts/
// assets-library-admin-http.contract.md).

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
  constructor(message: string) {
    super(message);
  }
}

export class BackendUnavailableError extends Error {
  override readonly name = 'BackendUnavailableError';
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class LocatorMissingError extends Error {
  override readonly name = 'LocatorMissingError';
  constructor(message: string) {
    super(message);
  }
}

export class LegacyAssetCannotHardenError extends Error {
  override readonly name = 'LegacyAssetCannotHardenError';
  constructor() {
    super(
      'Cannot mark a `legacy` (pre-013 absolute-URL) asset as private — re-upload it through the active adapter first.',
    );
  }
}
