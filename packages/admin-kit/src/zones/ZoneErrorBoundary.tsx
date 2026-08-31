/**
 * One contributed component's blast radius (feature 091, P4a; Z8).
 *
 * A zone contribution is an **addition**. A third-party module's exception must
 * not white-screen the product editor, so each contribution is wrapped
 * separately: one contributor throwing leaves the others, and the host, alone.
 *
 * **This is not the defensive `catch` `check:port-catches` refuses.** That rule
 * is about swallowing a `ModuleDisabledError` at a seam, where the swallow
 * turns fail-closed into fail-open. Here there is no presence question inside
 * the boundary at all: presence was decided at enumeration, before the factory
 * was called (`use-admin-zone.ts` step 3), so there is nothing about presence
 * for this boundary to hide.
 *
 * It logs once — naming the module and the zone, because a stack trace from a
 * lazily loaded chunk names neither — renders nothing in production, and
 * renders an inline marker under `import.meta.env.DEV` so a contributor
 * developing against a host screen sees the failure rather than a gap.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ZoneErrorBoundaryProps {
  readonly module: string;
  readonly zone: string;
  readonly children: ReactNode;
}

interface ZoneErrorBoundaryState {
  readonly failed: boolean;
}

export class ZoneErrorBoundary extends Component<ZoneErrorBoundaryProps, ZoneErrorBoundaryState> {
  override state: ZoneErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ZoneErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Once, and naming both ends of the contribution: `error.stack` points into
    // a split chunk, which tells a reader neither which module shipped it nor
    // which of that module's contributions was rendering.
    console.error(
      `[admin-zone] '${this.props.module}' threw while rendering the ` +
        `'${this.props.zone}' zone. The host screen is unaffected; this contribution ` +
        'renders nothing.',
      error,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (import.meta.env.DEV) {
      return (
        <span
          role="status"
          className="text-xs text-destructive"
          data-admin-zone-error={this.props.zone}
        >
          {`${this.props.module} failed to render here — see the console.`}
        </span>
      );
    }
    return null;
  }
}
