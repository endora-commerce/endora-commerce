'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  normalizeResponsive,
  type ButtonFill,
  type ButtonSpec,
  type ButtonStyle,
} from '@endora-commerce/page-builder-core';
import { colorValueToCss } from '../utils/color-value.js';
import { resolveLinkHref } from '../utils/link-href.js';
import { resolveCmsIcon } from './icon-catalog.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, useCmsRenderLocalizePath } from './render-context.js';

/**
 * The style-and-fill classes of a button: the base tier's always, and a
 * `--md-` / `--lg-` class only where a responsive value changes at that tier,
 * as today's button does with its variant.
 */
function appearanceClasses(button: Pick<ButtonSpec, 'style' | 'fill'>): string[] {
  const style = normalizeResponsive<ButtonStyle>(button.style, 'primary');
  const fill = normalizeResponsive<ButtonFill>(button.fill, 'solid');
  const tablet = { style: style.tablet ?? style.base, fill: fill.tablet ?? fill.base };
  const desktop = { style: style.desktop ?? tablet.style, fill: fill.desktop ?? tablet.fill };

  const classes = [`cmsc-btn--${style.base}-${fill.base}`];
  if (tablet.style !== style.base || tablet.fill !== fill.base) {
    classes.push(`cmsc-btn--md-${tablet.style}-${tablet.fill}`);
  }
  if (desktop.style !== tablet.style || desktop.fill !== tablet.fill) {
    classes.push(`cmsc-btn--lg-${desktop.style}-${desktop.fill}`);
  }
  return classes;
}

/**
 * Today's per-button `backgroundColor` / `textColor` overrides: they replace the
 * style's colour and its label colour (and the hover colour, so an overridden
 * button keeps its colour under the pointer, as today's does).
 */
function overrideStyle(button: Pick<ButtonSpec, 'backgroundColor' | 'textColor'>): CSSProperties {
  const color = colorValueToCss(button.backgroundColor);
  const on = colorValueToCss(button.textColor);
  return {
    ...(color ? { '--cmsc-btn-c': color, '--cmsc-btn-c-hover': color } : {}),
    ...(on ? { '--cmsc-btn-on': on } : {}),
  } as CSSProperties;
}

/**
 * R19B (T245, T246): what a block may add to one button's look — the outline
 * fill made transparent and a border colour (already a CSS colour: a hex or a
 * brand variable). Unset, the button renders as before. R23 (T447): an
 * icon-only button's px size (R19B) and a pill's px width (R20E) were removed;
 * the button follows its size option, a pill is 1.15 times its height.
 */
export interface ButtonViewLook {
  transparentOutline?: boolean;
  borderColor?: string;
  /** R20E (T296): an icon-only button's shape — today's circle, or a pill 1.15 times as wide as it is tall. */
  iconOnlyShape?: 'circle' | 'pill';
}

/**
 * R20E (T296, T297): the look a button carries itself (a block-embedded
 * `ButtonSpec`), merged under the block's own options (`cms.Button`, whose
 * look stays block-level as stored), so both reach the button through one
 * path. A border colour is resolved here (a hex or a brand token); `null`
 * when nothing is set.
 */
function mergedLook(button: ButtonSpec, look: ButtonViewLook | undefined): ButtonViewLook | undefined {
  const border = colorValueToCss(button.borderColor);
  const own: ButtonViewLook = {
    ...(button.transparentOutline === true ? { transparentOutline: true } : {}),
    ...(border ? { borderColor: border } : {}),
    ...(button.iconOnlyShape === 'pill' ? { iconOnlyShape: 'pill' as const } : {}),
  };
  const merged = { ...own, ...(look ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** R19B (T245, T246): the outline fill and the border colour as the button's own custom properties. */
function lookStyle(look: ButtonViewLook | undefined): CSSProperties {
  if (!look) return {};
  const border = look.borderColor?.trim().replace(/[;{}<>]/g, '') ?? '';
  return {
    ...(look.transparentOutline === true ? { '--cmsc-btn-outline-bg': 'transparent' } : {}),
    ...(border ? { '--cmsc-btn-border': border } : {}),
  } as CSSProperties;
}

export interface ButtonViewProps {
  button: ButtonSpec;
  className?: string;
  look?: ButtonViewLook;
  /**
   * Feature 169 — `'submit'` renders a form's `<button type="submit">` with the same classes,
   * and the spec's link is not read. Absent: today's link (or box, with no link).
   */
  type?: 'submit';
  /** With `type: 'submit'`: the form is being sent (`disabled`, `aria-busy`). */
  disabled?: boolean;
}

/**
 * One `ButtonSpec` as a link styled by `cmsc-btn` (`specs/163-page-builder-marketing-pages/`
 * research R-11): `cmsc-btn--<style>-<fill>` and `cmsc-btn--<size>`, an icon from
 * the curated catalog before or after the label, and `iconPosition: 'only'` as a
 * round button whose accessible name is the label. A link that resolves to
 * nothing renders the same box with no link.
 */
export function ButtonView({ button, className, look: blockLook, type, disabled }: ButtonViewProps): ReactNode {
  const look = mergedLook(button, blockLook);
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  // Feature 167 — an internal link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  const link = resolveLinkHref(button.link, { assets, mediaBaseUrl, localizePath });
  const Icon = resolveCmsIcon(button.icon);
  const iconOnly = Icon !== null && button.iconPosition === 'only' && button.label.trim() !== '';
  const iconAtEnd = button.iconPosition === 'end' || button.iconPosition === undefined;

  // R20E (T296): an icon-only button drawn as a pill.
  const pill = iconOnly && look?.iconOnlyShape === 'pill';
  const classes = [
    'cmsc-btn',
    ...appearanceClasses(button),
    `cmsc-btn--${button.size ?? 'medium'}`,
    iconOnly ? 'cmsc-btn--icon-only' : '',
    pill ? 'cmsc-btn--icon-pill' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const style = { ...overrideStyle(button), ...lookStyle(look) } as CSSProperties;
  const icon = Icon ? <Icon aria-hidden="true" className="cmsc-btn__icon" /> : null;

  const content = iconOnly ? (
    icon
  ) : (
    <>
      {icon && !iconAtEnd ? icon : null}
      <span className="cmsc-btn__label">{button.label}</span>
      {icon && iconAtEnd ? icon : null}
    </>
  );

  const common = {
    className: classes,
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(iconOnly ? { 'aria-label': button.label } : {}),
  };

  if (type === 'submit') {
    return (
      <button type="submit" {...common} {...(disabled ? { disabled: true, 'aria-busy': true } : {})}>
        {content}
      </button>
    );
  }
  if (!link) return <span {...common}>{content}</span>;
  return (
    <a
      href={link.href}
      {...(link.target ? { target: link.target } : {})}
      {...(link.rel ? { rel: link.rel } : {})}
      {...common}
    >
      {content}
    </a>
  );
}
