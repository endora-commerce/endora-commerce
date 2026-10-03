'use client';

// Failure isolation for one block
// (`specs/141-module-block-renderers/contracts/block-renderers.md` R8.1).
//
// Two boundaries, and T01 measured why both: on the server a class error
// boundary is never consulted — a throw below it fails the whole render —
// while `<Suspense>` makes React emit the fallback and carry on with the
// siblings. On the client React retries the suspended boundary, the block
// throws again, and it is the error boundary **outside** the `<Suspense>` that
// renders the placeholder. So: error boundary around `<Suspense>` around the
// block, the same placeholder as the fallback of both.

import type { ComponentConfig } from '@puckeditor/core';
import { Component, Suspense, type ReactNode } from 'react';

interface BoundaryProps {
  readonly fallback: ReactNode;
  readonly onError: ((error: unknown) => void) | undefined;
  readonly children: ReactNode;
}

class BlockErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    // In the editor an operator fixes the prop that made the block throw; the
    // block is re-rendered with new props and must get another chance. A
    // re-render caused by this boundary's own state change carries the same
    // props object, so this cannot loop.
    if (this.state.failed && previous.children !== this.props.children) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Defaults under stored props; a stored `undefined` does not shadow a default. */
function mergeDefaults(
  defaults: Record<string, unknown> | undefined,
  props: Record<string, unknown>,
): Record<string, unknown> {
  if (defaults === undefined) return props;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined || !(key in defaults)) merged[key] = value;
  }
  return merged;
}

/**
 * Wrap a contributed block so that its failure costs the page that block and
 * nothing else, and so that it receives its `defaultProps` under the stored
 * props (FR-012, FR-013).
 *
 * The module's `render` is **mounted as a component** below the boundaries
 * rather than called: a throw at its top level is then a throw below the
 * boundary like any other, and its hooks belong to its own component instead of
 * to this wrapper's.
 *
 * `placeholder` is the surface's — `makeMissingComponentConfig(name, owner)`
 * from `cms-components` on both surfaces today. It is a parameter because this
 * package sits below the one that owns the placeholder.
 */
export function withBlockBoundary(
  config: ComponentConfig,
  placeholder: ComponentConfig,
  options: { readonly onError?: (error: unknown) => void } = {},
): ComponentConfig {
  const defaults = config.defaultProps as Record<string, unknown> | undefined;
  const Block = config.render as unknown as (props: Record<string, unknown>) => ReactNode;
  const Placeholder = placeholder.render as unknown as (props: Record<string, unknown>) => ReactNode;

  const placeholderProps = (placeholder.defaultProps ?? {}) as Record<string, unknown>;

  const render = (props: Record<string, unknown>): ReactNode => {
    const fallback = <Placeholder {...placeholderProps} />;
    return (
      <BlockErrorBoundary fallback={fallback} onError={options.onError}>
        <Suspense fallback={fallback}>
          <Block {...mergeDefaults(defaults, props)} />
        </Suspense>
      </BlockErrorBoundary>
    );
  };

  return { ...config, render } as unknown as ComponentConfig;
}
