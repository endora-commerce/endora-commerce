'use client';

import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from 'react';

/**
 * The copy of the page builder's own field controls — the Section's custom
 * fields, the colour field and the per-breakpoint switch
 * (`specs/163-page-builder-marketing-pages/` FR-039, T116).
 *
 * This package has no translation runtime, so its controls read their copy
 * through {@link useFieldText}: the English below unless a host mounts a
 * {@link PageBuilderFieldTextProvider}. The admin mounts one that reads
 * `pageBuilder.fieldText.<key>` from the `core` bundle (`_i18n`), in English
 * and Polish. `{name}` placeholders are filled here, after the host answered.
 */
export const PAGE_BUILDER_FIELD_TEXT = {
  // Per-breakpoint switch.
  'tier.base': 'Mobile',
  'tier.tablet': 'Tablet',
  'tier.desktop': 'Desktop',
  'tier.switch': '{label}: breakpoint',
  'tier.control': '{label} — {tier}',
  'tier.overridden': 'own value',
  'tier.inheritValue': 'Inherit ({value})',
  // R17 (T201): the per-breakpoint hints of a responsive field.
  'scope.applies': 'Applies: {value} (from {from})',
  'scope.appliesFrom': 'Applies the value from {from}',
  'scope.from.tablet': 'Mobile',
  'scope.from.desktop': 'Mobile / Tablet',
  'scope.reset': 'Reset to inherited',
  'scope.inherited': 'Inherited value shown — change to override for this scope.',
  // R17 (T201): the spacing and border controls; T202: a border side's three controls.
  'spacing.uniform': 'All sides',
  'spacing.sides': 'Each side',
  'spacing.uniformValue': 'All sides (px)',
  'side.top': 'Top',
  'side.right': 'Right',
  'side.bottom': 'Bottom',
  'side.left': 'Left',
  'side.valuePx': '{side} (px)',
  'side.control': '{side} – {control}',
  'border.show': 'Show border',
  'border.width': 'Width (px)',
  'border.style': 'Style',
  'border.color': 'Color',
  'border.style.solid': 'Solid',
  'border.style.dashed': 'Dashed',
  'border.style.dotted': 'Dotted',
  // R17: the editor's name of a block.
  'editorName.placeholder': 'Optional',
  'editorName.hint': 'Optional label shown in the page outline only. Does not appear on the storefront.',
  // Colour field.
  'color.palette': 'Palette',
  'color.paletteFor': 'Palette — {label}',
  'color.picker': '{label} — color picker',
  // R18 (T222): an inherited colour, and the empty box's placeholder.
  'color.inherited': 'Inherited (text color)',
  'color.inherit': 'Inherit',
  'color.inheritFor': '{label} — inherit the text color',
  'color.transparent': 'transparent',
  // `cms.Section`'s custom fields (T117: each setting is a field of its own,
  // labelled by the field; these are the words inside them).
  'section.anchorPlaceholder': 'contact',
  'section.anchorHint': 'Link to it with #{anchor}',
  'section.space.none': 'None',
  'section.space.custom': 'Custom (px)',
  'section.spacePx': '{label} (px)',
  'section.background.none': 'None',
  'section.background.solid': 'Solid color',
  'section.background.gradient': 'Gradient',
  'section.background.image': 'Image',
  'section.background.video': 'Video',
  'section.backgroundColor': 'Background color',
  'section.gradientFrom': 'Gradient from',
  'section.gradientTo': 'Gradient to',
  'section.gradientAngle': 'Gradient angle (deg)',
  'section.imageSource': 'Image source',
  'section.videoSource': 'Video source',
  'section.source.url': 'URL',
  'section.source.library': 'Asset library',
  'section.image': 'Image',
  'section.mobileImage': 'Mobile image',
  'section.imageUrl': 'Image URL',
  'section.mobileImageUrl': 'Mobile image URL',
  'section.imagePosition': 'Image position',
  'section.position.center': 'Center',
  'section.position.top': 'Top',
  'section.position.bottom': 'Bottom',
  'section.position.left': 'Left',
  'section.position.right': 'Right',
  'section.video': 'Video',
  'section.videoUrl': 'Video URL',
  'section.mobileVideo': 'Mobile video',
  'section.posterImage': 'Poster image',
  // R19C (T263): where a background's mobile image or video gives way to the desktop one.
  'section.desktopFrom': 'Mobile image or video shown on',
  'section.desktopFrom.tablet': 'Phones (below 768 px)',
  'section.desktopFrom.desktop': 'Phones and tablets (below 1024 px)',
  'section.overlay': 'Overlay',
  'section.overlay.none': 'None',
  'section.overlay.solid': 'Solid',
  'section.overlay.gradient': 'Gradient',
  'section.overlayDirection': 'Overlay direction',
  'section.overlayDirection.to-top': 'Darker at the bottom',
  'section.overlayDirection.to-bottom': 'Darker at the top',
  'section.overlayDirection.to-left': 'Darker on the right',
  'section.overlayDirection.to-right': 'Darker on the left',
  'section.overlayStrength': 'Overlay strength (%)',
  'section.decorative': 'Decorative backdrop (dark scheme)',
  // T167: the size, repeat and position of an image background and of the decorative layer.
  'section.imageSize': 'Image size',
  'section.imageRepeat': 'Image repeat',
  'section.decorativeSize': 'Backdrop size',
  'section.decorativeRepeat': 'Backdrop repeat',
  'section.decorativePosition': 'Backdrop position',
  'section.size.cover': 'Cover (fill, crop)',
  'section.size.contain': 'Contain (whole image)',
  'section.size.auto': 'Natural size',
  'section.size.px': 'Width (px)',
  'section.size.percent': 'Width (%)',
  'section.sizePx': '{label} (px)',
  'section.sizePercent': '{label} (%)',
  'section.repeat.no-repeat': 'No repeat',
  'section.repeat.repeat': 'Tile',
  'section.repeat.repeat-x': 'Repeat across',
  'section.repeat.repeat-y': 'Repeat down',
  'section.reveal.none': 'None',
  'section.reveal.fade-up': 'Fade and rise',
  'section.revealDesktopOnly': 'Reveal on desktop only',
  // The inline rich text's icon dialog (T163, T166).
  'inlineIcon.insert': 'Insert icon',
  'inlineIcon.edit': 'Edit icon',
  'inlineIcon.search': 'Search icons',
  'inlineIcon.searchPlaceholder': 'Search icons…',
  'inlineIcon.icons': 'Icons',
  'inlineIcon.noMatch': 'No icons match “{query}”.',
  'inlineIcon.size': 'Icon size',
  'inlineIcon.size.text': 'Text size (1 em)',
  'inlineIcon.size.em': 'Relative to the text (em)',
  'inlineIcon.size.px': 'Fixed (px)',
  'inlineIcon.sizeValue': 'Icon size value',
  'inlineIcon.offset': 'Vertical offset (em)',
  'inlineIcon.offsetHint': 'Positive raises the icon, negative lowers it; empty keeps it on the line.',
  'inlineIcon.cancel': 'Cancel',
  'inlineIcon.apply': 'Apply',
  // The inline rich text's highlight colour dialog (T175).
  'emphasisColor.button': 'Highlight color',
  'emphasisColor.title': 'Highlight color',
  'emphasisColor.brand': 'Brand colors',
  'emphasisColor.token': 'Brand color: {role}',
  'emphasisColor.custom': 'Custom color (hex)',
  'emphasisColor.picker': 'Color picker',
  'emphasisColor.hint': 'The phrase keeps its highlight style and reads in this color.',
  'emphasisColor.remove': 'Remove color',
  'emphasisColor.cancel': 'Cancel',
  'emphasisColor.apply': 'Apply',
  // The rich text's image dialog: the library or a URL (T195).
  'richImage.source': 'Image source',
  'richImage.source.library': 'Asset library',
  'richImage.source.url': 'URL',
  'richImage.choose': 'Choose from the library',
  'richImage.change': 'Choose another image',
  'richImage.preview': 'Chosen image',
  // The rich-text editor's full-screen mode, a dialog named for assistive technology (#1652).
  'richText.fullscreen': 'Text editor — full screen',
  // The rich-text editors' toolbars (#1680): the rich text's, and the inline text's bold, italic and link.
  'richText.blockType': 'Block type',
  'richText.block.p': 'Paragraph',
  'richText.block.h1': 'Heading 1',
  'richText.block.h2': 'Heading 2',
  'richText.block.h3': 'Heading 3',
  'richText.block.h4': 'Heading 4',
  'richText.bold': 'Bold',
  'richText.italic': 'Italic',
  'richText.underline': 'Underline',
  'richText.strike': 'Strikethrough',
  'richText.code': 'Inline code',
  'richText.link': 'Link',
  'richText.anchor': 'Heading anchor',
  'richText.srOnly': 'Visually hidden heading',
  'richText.textColor': 'Text color',
  'richText.highlightColor': 'Highlight color',
  'richText.bulletList': 'Bullet list',
  'richText.checkList': 'Check list',
  'richText.orderedList': 'Numbered list',
  'richText.readMore': 'Read more passage',
  'richText.readMoreChevron': 'Read more as a chevron',
  'richText.quote': 'Quote',
  'richText.codeBlock': 'Code block',
  'richText.horizontalRule': 'Horizontal rule',
  'richText.alignLeft': 'Align left',
  'richText.alignCenter': 'Align center',
  'richText.alignRight': 'Align right',
  'richText.justify': 'Justify',
  'richText.clearFormatting': 'Clear formatting',
  'richText.undo': 'Undo',
  'richText.redo': 'Redo',
  'richText.expand': 'Expand editor to full screen',
  'richText.collapse': 'Collapse editor',
  'richText.empty': 'No content',
  'richText.loading': 'Loading editor…',
  // The emphasis variants, in the rich and the inline toolbar (#1680).
  'emphasis.gradient': 'Gradient highlight',
  'emphasis.accent': 'Accent highlight',
  'emphasis.muted': 'Muted highlight',
  // The link dialog, and what a link can be shown as (#1680).
  'richLink.title': 'Link',
  'richLink.url': 'URL',
  'richLink.showAs': 'Show as',
  'richLink.display.link': 'Link',
  'richLink.display.primary-solid': 'Primary button',
  'richLink.display.primary-outline': 'Primary outline button',
  'richLink.display.secondary-solid': 'Secondary button',
  'richLink.display.secondary-outline': 'Secondary outline button',
  'richLink.display.dark-solid': 'Dark button',
  'richLink.display.light-solid': 'Light button',
  'richLink.newTab': 'Open in new tab',
  'richLink.cancel': 'Cancel',
  'richLink.apply': 'Apply',
  'richLink.remove': 'Remove link',
  // A heading's anchor dialog (#1680).
  'richAnchor.title': 'Heading anchor',
  'richAnchor.label': 'Anchor',
  'richAnchor.placeholder': 'pricing',
  'richAnchor.none': 'No anchor',
  'richAnchor.hint': 'Link to it with #{anchor}',
  'richAnchor.cancel': 'Cancel',
  'richAnchor.apply': 'Apply',
  'richAnchor.remove': 'Remove anchor',
  // The rich text's image dialog, beside its source above (#1680).
  'richImage.insert': 'Insert image',
  'richImage.edit': 'Edit image',
  'richImage.url': 'Image URL',
  'richImage.alt': 'Alt text',
  'richImage.width': 'Width',
  'richImage.widthAuto': 'Auto',
  'richImage.widthUnit': 'Width unit',
  'richImage.align': 'Alignment',
  'richImage.align.default': 'Default',
  'richImage.align.left': 'Left',
  'richImage.align.center': 'Center',
  'richImage.align.right': 'Right',
  'richImage.inline': 'In the line of text',
  'richImage.cancel': 'Cancel',
  'richImage.apply': 'Apply',
  'richImage.insertAction': 'Insert',
  // A rich-text read-more passage's summary position and reveal above (T173).
  'readMore.position': 'Read more position',
  'readMore.position.start': 'Start',
  'readMore.position.center': 'Center',
  'readMore.position.end': 'End',
  'readMore.revealAbove': 'Show the revealed text above the summary',
  // A rich-text bullet list's marker and a run's text size (R19A, T233).
  'listMarker': 'List marker',
  'listMarker.disc': 'Disc',
  'listMarker.check': 'Check mark',
  'listMarker.chevron': 'Chevron',
  'listMarker.none': 'None',
  'textSize': 'Text size',
  'textSize.default': 'Default size',
  'textSize.small': 'Small',
  'textSize.body': 'Body',
  'textSize.lead': 'Lead',
  'textSize.h6': 'Heading 6',
  'textSize.h5': 'Heading 5',
  'textSize.h4': 'Heading 4',
  'textSize.h3': 'Heading 3',
  'textSize.h2': 'Heading 2',
  'textSize.h1': 'Heading 1',
  'textSize.display': 'Display',
  // The aspect ratio field (T126, T127): `auto` and Custom are words, the ratios are not.
  'ratio.auto': 'Auto (own ratio)',
  'ratio.custom': 'Custom (w:h)',
  'ratio.customValue': '{label} (w:h)',
} as const;

export type PageBuilderFieldTextKey = keyof typeof PAGE_BUILDER_FIELD_TEXT;

/** The host's answer for one key, or `undefined` to keep the English. */
export type PageBuilderFieldTextResolver = (key: PageBuilderFieldTextKey) => string | undefined;

/** Looks one key up, filling its `{name}` placeholders. */
export type FieldText = (key: PageBuilderFieldTextKey, params?: Record<string, string | number>) => string;

const FieldTextContext = createContext<PageBuilderFieldTextResolver | null>(null);

export function PageBuilderFieldTextProvider({
  resolve,
  children,
}: {
  resolve: PageBuilderFieldTextResolver;
  children: ReactNode;
}): ReactElement {
  return <FieldTextContext.Provider value={resolve}>{children}</FieldTextContext.Provider>;
}

function fill(template: string, params: Record<string, string | number> | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] !== undefined ? String(params[name]) : match));
}

/** The field controls' copy: the host's translation where it has one, else the English. */
export function useFieldText(): FieldText {
  const resolve = useContext(FieldTextContext);
  return useCallback<FieldText>(
    (key, params) => fill(resolve?.(key) ?? PAGE_BUILDER_FIELD_TEXT[key], params),
    [resolve],
  );
}
