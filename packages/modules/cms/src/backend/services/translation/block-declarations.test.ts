import { describe, expect, it } from 'vitest';
import type { BlockDefinition, BlockTranslatableText } from '@endora-commerce/contracts';
import { manifest } from '../../../manifest.js';
import { extract } from './extract.js';

/**
 * Feature 151, T021/T022 — per `cms.*` block, a node carrying every prop of its
 * `@endora-commerce/cms-components` type with a recognisable value yields
 * exactly the planned prose (`data-model.md` §2) and never a link, a code, an
 * asset reference or an editor-only name.
 */

const blocks = new Map(
  ((manifest.blocks ?? []) as BlockDefinition[]).map((block) => [block.name, block.translatable]),
);
const declarations = (name: string): readonly BlockTranslatableText[] | undefined => blocks.get(name);

const P = (label: string) => `Prose ${label}`;
const X = (label: string) => `NOPE ${label}`;
const tiptap = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
// Feature 163, T156: every block's order in a column (the shared wrapper's `stackOrder`) is layout, never prose.
const box = { margin: X('margin'), padding: X('padding'), editorName: X('editorName'), stackOrder: { base: X('order') }, id: 'n' };

const FIXTURES: Record<string, { props: Record<string, unknown>; expected: string[] }> = {
  // Feature 163, T039: the text is inline rich text (`format: 'tiptap'`); the
  // size, font and colour tokens are not prose.
  'cms.Heading': {
    props: { ...box, text: tiptap(P('heading')), level: 'h2', size: X('size'), font: X('font'), customFontFamily: X('family'), color: X('color') },
    expected: [P('heading')],
  },
  'cms.Text': {
    props: { ...box, text: P('text'), tiptapContent: tiptap(P('tiptap')), html: X('html') },
    expected: [P('text'), P('tiptap')],
  },
  'cms.RichContent': { props: { ...box, content: tiptap(P('rich')), html: X('html') }, expected: [P('rich')] },
  // Feature 163, T039: one `ButtonSpec`; its link is an address, never prose.
  'cms.Button': {
    props: {
      ...box,
      // Feature 163, T168: the full width per breakpoint is layout, never prose.
      fullWidth: { base: X('width'), desktop: X('width') },
      button: { label: P('label'), link: { kind: 'page', slug: X('slug') }, style: X('style'), icon: X('icon'), backgroundColor: X('bg') },
      align: X('align'),
      // R19B (T245, T246): the outline fill, the icon button's size and the border colour are options.
      transparentOutline: true,
      iconSizePx: { base: 72, desktop: 116 },
      borderColor: X('border'),
    },
    expected: [P('label')],
  },
  // Feature 163, T127: the caption is prose; the mobile image, ratio, overlay and placement are not.
  'cms.Image': {
    props: {
      ...box,
      src: X('src'),
      assetId: X('asset'),
      mobileSrc: X('mobileSrc'),
      mobileAssetId: X('mobileAsset'),
      alt: P('alt'),
      href: X('href'),
      ratio: X('ratio'),
      overlay: { kind: X('kind'), direction: X('direction') },
      caption: P('caption'),
      captionPlacement: X('placement'),
      // R19B (T251): the caption's look per breakpoint is an option.
      captionSizePx: { base: 10, tablet: 12 },
      captionAlign: { base: X('align'), tablet: X('align') },
      captionWeight: X('weight'),
      captionColor: X('color'),
    },
    expected: [P('alt'), P('caption')],
  },
  'cms.Icons': { props: { ...box, name: X('icon'), href: X('href') }, expected: [] },
  'cms.Social': {
    props: { ...box, items: [{ network: X('net'), label: P('social'), url: X('url') }] },
    expected: [P('social')],
  },
  // Feature 163, T049: a heading, inline rich titles, rich bodies and the image
  // below the grid; icons, uploaded icon ids, sizes and colours are not prose.
  'cms.FeatureList': {
    props: {
      ...box,
      heading: tiptap(P('heading')),
      // Feature 163, T151/T152: the heading's weight and measure are not prose.
      headingWeight: X('weight'), headingMaxWidth: { base: X('measure'), desktop: X('measure') }, headingMaxWidthPx: { base: 1, desktop: 2 },
      headingSize: X('size'),
      items: [{ icon: X('icon'), iconAssetId: X('asset'), title: tiptap(P('title')), body: tiptap(P('body')) }],
      columns: { base: 1, desktop: 3 },
      gap: X('gap'),
      iconColor: X('color'),
      titleSize: X('title size'),
      titleWeight: X('weight'),
      image: { imageSource: X('source'), assetId: X('asset'), alt: P('image alt') },
    },
    expected: [P('heading'), P('title'), P('body'), P('image alt')],
  },
  // Feature 163, T043: inline rich texts, a rich body, a list of `ButtonSpec`s,
  // a social-proof caption and the media image's alternative text. Links,
  // asset ids, colours, levels and sizes are not prose.
  'cms.Hero': {
    props: {
      ...box,
      // Feature 163, T168: the buttons' full width per breakpoint is layout, never prose.
      buttonsFullWidth: { base: X('width'), desktop: X('width') },
      media: {
        kind: 'image',
        image: { imageSource: X('source'), assetId: X('asset'), mobileAssetId: X('m'), alt: P('media alt'), ratio: X('ratio') },
        // T162: a video's mobile poster (asset or URL) is not prose.
        mobilePosterAssetId: X('mobile poster'),
        mobilePosterUrl: X('mobile poster url'),
        // T191: the poster's source and URL are not prose.
        posterSource: X('poster source'),
        posterUrl: X('poster url'),
      },
      overlay: { kind: X('overlay'), strength: 40 },
      textColor: X('color'),
      eyebrow: P('eyebrow'),
      title: tiptap(P('title')),
      titleLevel: X('level'),
      titleSize: X('size'),
      titleWeight: X('weight'), titleMaxWidth: { base: X('measure') }, titleMaxWidthPx: { base: 1 },
      subheading: tiptap(P('subheading')),
      statement: tiptap(P('statement')),
      body: tiptap(P('body')),
      buttons: [
        { label: P('first button'), link: { kind: 'page', slug: X('slug') }, style: X('style'), icon: X('icon') },
        { label: P('second button'), link: { kind: 'anchor', anchor: X('anchor') }, backgroundColor: X('bg') },
      ],
      socialProof: { image: { imageSource: X('source'), src: X('src'), alt: P('proof alt') }, caption: P('caption') },
      align: X('align'),
      minHeight: X('min'),
      gaps: X('gaps'),
      // T145: the space after an element is layout, never prose.
      spaceAfter: [{ element: X('element'), space: X('space'), spacePx: 12 }],
      // T193: nor is an element list item's own space.
      order: [{ element: X('order element'), space: X('order space'), spacePx: 8 }],
    },
    expected: [
      P('eyebrow'),
      P('title'),
      P('subheading'),
      P('statement'),
      P('body'),
      P('first button'),
      P('second button'),
      P('caption'),
      P('media alt'),
      P('proof alt'),
    ],
  },
  'cms.LogoStrip': {
    props: { ...box, items: [{ src: X('src'), assetId: X('asset'), alt: P('alt'), href: X('href') }] },
    expected: [P('alt')],
  },
  // Feature 163, T049: a rich quote, the image and the avatar's alternative texts.
  'cms.Testimonial': {
    props: {
      ...box,
      layout: X('layout'),
      quote: tiptap(P('quote')),
      author: P('author'),
      role: P('role'),
      image: { imageSource: X('source'), src: X('src'), alt: P('image alt') },
      avatar: { imageSource: X('source'), assetId: X('asset'), alt: P('avatar alt') },
      background: { kind: X('kind'), color: X('color') },
    },
    expected: [P('quote'), P('author'), P('role'), P('image alt'), P('avatar alt')],
  },
  // Feature 163, T049: a heading and the image's alternative text beside the figures.
  'cms.Stats': {
    props: {
      ...box,
      heading: tiptap(P('heading')),
      // Feature 163, T151/T152: the heading's weight and measure are not prose.
      headingWeight: X('weight'), headingMaxWidth: { base: X('measure'), desktop: X('measure') }, headingMaxWidthPx: { base: 1, desktop: 2 },
      image: { imageSource: X('source'), src: X('src'), alt: P('image alt') },
      imageSide: X('side'),
      items: [{ value: P('value'), label: P('label') }],
      valueColor: X('color'),
      valueSize: X('size'),
    },
    expected: [P('heading'), P('value'), P('label'), P('image alt')],
  },
  // Feature 163, T047: the composition blocks of US3 (contracts/blocks.md).
  'cms.MediaText': {
    props: {
      ...box,
      // Feature 163, T168: the buttons' full width per breakpoint is layout, never prose.
      buttonsFullWidth: { base: X('width'), desktop: X('width') },
      heading: tiptap(P('heading')),
      // Feature 163, T151/T152: the heading's weight and measure are not prose.
      headingWeight: X('weight'), headingMaxWidth: { base: X('measure'), desktop: X('measure') }, headingMaxWidthPx: { base: 1, desktop: 2 },
      headingSize: X('size'),
      media: { kind: X('kind'), image: { imageSource: X('source'), assetId: X('asset'), alt: P('media alt') } },
      mediaSide: X('side'),
      split: X('split'),
      body: tiptap(P('body')),
      features: [{ icon: X('icon'), iconAssetId: X('asset'), title: tiptap(P('feature title')), body: P('feature body') }],
      // T160: the item titles' size and weight are not prose.
      featureTitleSize: { base: X('title size'), desktop: X('title size') }, featureTitleSizePx: { base: 1, desktop: 2 }, featureTitleWeight: X('title weight'),
      buttons: [{ label: P('button'), link: { kind: 'page', slug: X('slug') }, style: X('style') }],
      footnote: tiptap(P('footnote')),
      rows: [
        {
          // T142: the video sources (library or URL, with a mobile video) are not prose.
          media: {
            kind: X('kind'),
            videoSource: X('videoSource'),
            videoAssetId: X('video'),
            videoUrl: X('videoUrl'),
            mobileVideoAssetId: X('mobileVideo'),
            mobileVideoUrl: X('mobileVideoUrl'),
            posterAssetId: X('poster'),
            // T162: the mobile poster is not prose.
            mobilePosterAssetId: X('mobile poster'),
            mobilePosterUrl: X('mobile poster url'),
            image: { alt: P('row media alt') },
          },
          heading: tiptap(P('row heading')),
          body: tiptap(P('row body')),
          features: [{ icon: X('icon'), title: tiptap(P('row feature title')), body: P('row feature body') }],
          buttons: [{ label: P('row button'), link: { kind: 'anchor', anchor: X('anchor') } }],
        },
      ],
    },
    expected: [
      P('heading'),
      P('body'),
      P('feature title'),
      P('feature body'),
      P('button'),
      P('footnote'),
      P('media alt'),
      P('row heading'),
      P('row body'),
      P('row feature title'),
      P('row feature body'),
      P('row button'),
      P('row media alt'),
    ],
  },
  'cms.BackgroundPanel': {
    props: {
      ...box,
      // Feature 163, T168: the buttons' full width per breakpoint is layout, never prose.
      buttonsFullWidth: { base: X('width'), desktop: X('width') },
      image: { imageSource: X('source'), assetId: X('asset'), mobileAssetId: X('m'), alt: P('image alt') },
      textSide: X('side'),
      icon: X('icon'),
      iconAssetId: X('asset'),
      heading: tiptap(P('heading')),
      // Feature 163, T151/T152: the heading's weight and measure are not prose.
      headingWeight: X('weight'), headingMaxWidth: { base: X('measure'), desktop: X('measure') }, headingMaxWidthPx: { base: 1, desktop: 2 },
      body: tiptap(P('body')),
      buttons: [{ label: P('button'), link: { kind: 'url', href: X('href') } }],
      minHeight: X('min'),
    },
    expected: [P('heading'), P('body'), P('button'), P('image alt')],
  },
  'cms.CtaCard': {
    props: {
      ...box,
      // Feature 163, T168: the buttons' full width per breakpoint is layout, never prose.
      buttonsFullWidth: { base: X('width'), desktop: X('width') },
      cardScheme: X('scheme'),
      heading: tiptap(P('heading')),
      // Feature 163, T151/T152: the heading's weight and measure are not prose.
      headingWeight: X('weight'), headingMaxWidth: { base: X('measure'), desktop: X('measure') }, headingMaxWidthPx: { base: 1, desktop: 2 },
      body: tiptap(P('body')),
      list: [{ icon: X('icon'), text: P('list item') }],
      buttons: [{ label: P('button'), link: { kind: 'asset', fileAssetId: X('file') } }],
      image: { imageSource: X('source'), src: X('src'), alt: P('image alt') },
      imageSide: X('side'),
    },
    expected: [P('heading'), P('body'), P('list item'), P('button'), P('image alt')],
  },
  'cms.Statement': {
    props: {
      ...box,
      heading: tiptap(P('heading')),
      headingWeight: X('weight'),
      headingSize: X('size'),
      body: tiptap(P('body')),
      align: X('align'),
      background: { image: { imageSource: X('source'), src: X('src'), alt: P('image alt') }, textPosition: X('position') },
    },
    expected: [P('heading'), P('body'), P('image alt')],
  },
  'cms.AnnouncementBar': { props: { text: P('text'), href: X('href'), editorName: X('n') }, expected: [P('text')] },
  'cms.SimpleTable': {
    props: {
      ...box,
      columns: [{ label: P('column') }],
      tableRows: [{ cells: [{ value: P('cell') }] }],
      headers: [{ label: P('header') }],
      rows: [{ cells: [{ value: P('row') }] }],
    },
    expected: [P('column'), P('cell'), P('header'), P('row')],
  },
  // Feature 163, T126: a self-hosted file's asset ids and its ratio are not prose.
  'cms.Video': {
    props: {
      ...box,
      source: X('source'),
      url: X('url'),
      videoAssetId: X('video'),
      mobileVideoAssetId: X('mobileVideo'),
      // T142: the mobile video by URL is not prose.
      mobileUrl: X('mobileUrl'),
      posterAssetId: X('poster'),
      // T162: the mobile poster is not prose.
      mobilePosterAssetId: X('mobile poster'),
      mobilePosterUrl: X('mobile poster url'),
      // T194: the file and poster sources and the poster URL are not prose.
      fileSource: X('file source'),
      posterSource: X('poster source'),
      posterUrl: X('poster url'),
      aspectRatio: X('ratio'),
      title: P('title'),
    },
    expected: [P('title')],
  },
  'cms.Map': {
    props: { ...box, googleApiKey: X('key'), markers: [{ lat: 1, lng: 2, label: P('marker'), link: X('link') }] },
    expected: [P('marker')],
  },
  // Feature 163, T059: a panel holds blocks in its `panel` slot, translated
  // through their own declarations; the style and effect are not prose.
  'cms.Tabs': {
    props: {
      ...box,
      items: [{ label: P('tab'), panel: [{ type: 'cms.RichContent', props: { id: 'r', content: tiptap(P('tab panel')), html: X('html') } }] }],
      variant: X('variant'),
      effect: X('effect'),
      // T132: the tab bar's look is colours and a size, never prose.
      // T174: so are the hover colours.
      tabStyle: { size: X('size'), barBackground: X('bar'), activeColor: X('active'), hoverBackground: X('hover bg'), hoverColor: X('hover fg') },
      // T146: the space below the bar is layout, never prose.
      panelGap: X('gap'),
      panelGapPx: 24,
      // T155: how a bar that does not fit behaves is layout, never prose.
      barOverflow: X('overflow'),
      // T163: the tab size per breakpoint is layout, never prose.
      tabSize: { base: X('tab size'), desktop: X('tab size desktop') },
    },
    expected: [P('tab'), P('tab panel')],
  },
  // Feature 169 (T056): the nav's name and the link labels are prose; the anchors are ids, the look is options.
  'cms.PageNavigation': {
    props: {
      ...box,
      label: P('nav name'),
      items: [{ label: P('link'), anchor: X('anchor') }],
      look: X('look'),
      sticky: true,
      align: { base: X('align') },
    },
    expected: [P('nav name'), P('link')],
  },
  'cms.Accordion': {
    props: {
      ...box,
      items: [{ title: P('accordion'), panel: [{ type: 'cms.Heading', props: { id: 'h', text: tiptap(P('accordion panel')) } }] }],
      variant: X('variant'),
      // T175: the look — icon, dividers, item style, title padding per breakpoint — is never prose.
      icon: X('icon'),
      dividers: X('dividers'),
      itemStyle: X('item style'),
      titlePadding: { base: X('title padding'), desktop: X('title padding desktop') },
      titlePaddingPx: 6,
      // T179: the title colour, the divider position and the icon size are never prose.
      titleColor: X('title color'),
      dividerPosition: X('divider position'),
      iconSize: X('icon size'),
      iconSizePx: 20,
      // T182: the panel and item gaps per breakpoint, T183: the title weight are never prose.
      panelGap: { base: X('panel gap'), desktop: X('panel gap') },
      panelGapPx: { base: 0, desktop: 24 },
      itemGap: X('item gap'),
      itemGapPx: 24,
      // T185: the title weight per breakpoint, T186: the panel's bottom space and the open-item gap are never prose.
      titleWeight: { base: X('weight'), desktop: X('weight desktop') },
      panelPaddingBottom: { base: X('panel bottom'), desktop: X('panel bottom desktop') },
      panelPaddingBottomPx: { base: 4, desktop: 8 },
      openItemGap: X('open item gap'),
      openItemGapPx: 8,
    },
    expected: [P('accordion'), P('accordion panel')],
  },
  'cms.NewsletterSignup': {
    props: {
      ...box,
      heading: P('heading'),
      description: P('description'),
      placeholder: P('placeholder'),
      buttonLabel: P('button'),
      actionUrl: X('url'),
      // Feature 163, T076: the optional consent checkbox.
      showConsent: true,
      consentLabel: tiptap(P('consent')),
    },
    expected: [P('heading'), P('description'), P('placeholder'), P('button'), P('consent')],
  },
  'cms.ContactFormEmbed': {
    props: { ...box, heading: P('heading'), description: P('description'), embedUrl: X('url'), mailto: X('mail') },
    expected: [P('heading'), P('description')],
  },
  // Feature 169 (T096): field labels, placeholders and the select's options, both consents
  // (tiptap), the button's label, the messages and the form's name are prose; the switches,
  // spans, looks and the button's style are not.
  'cms.ContactForm': {
    props: {
      ...box,
      fields: {
        name: { show: true, label: P('name.label'), placeholder: P('name.placeholder'), required: true, span: X('span') },
        email: { show: true, label: P('email.label'), placeholder: P('email.placeholder'), required: true, span: X('span') },
        phone: { show: true, label: P('phone.label'), placeholder: P('phone.placeholder'), required: true, span: X('span') },
        company: { show: true, label: P('company.label'), placeholder: P('company.placeholder'), required: true, span: X('span') },
        subject: { show: true, label: P('subject.label'), placeholder: P('subject.placeholder'), required: true, span: X('span') },
        choice: { show: true, label: P('choice.label'), placeholder: P('choice.placeholder'), required: true, span: X('span'), options: [{ label: P("option") }] },
        message: { show: true, label: P('message.label'), placeholder: P('message.placeholder'), required: true, span: X('span') },
      },
      privacyConsent: { label: tiptap(P('privacy')) },
      marketingConsent: { show: true, label: tiptap(P('marketing')) },
      columns: 2,
      fieldLook: X('look'),
      labelPosition: X('labels'),
      button: { label: P('button'), style: X('style'), icon: X('icon') },
      buttonAlign: X('align'),
      messages: { success: P('success'), error: P('error'), unavailable: P('unavailable') },
      formLabel: P('form'),
    },
    expected: [
      P('name.label'), P('name.placeholder'), P('email.label'), P('email.placeholder'), P('phone.label'), P('phone.placeholder'), P('company.label'), P('company.placeholder'), P('subject.label'), P('subject.placeholder'), P('choice.label'), P('choice.placeholder'), P('message.label'), P('message.placeholder'),
      P('option'),
      P('privacy'),
      P('marketing'),
      P('button'),
      P('success'),
      P('error'),
      P('unavailable'),
      P('form'),
    ],
  },
  'cms.RawHtml': { props: { ...box, html: X('html') }, expected: [] },
  'cms.RawJs': { props: { ...box, script: X('script') }, expected: [] },
  'cms.InsertBlock': { props: { code: X('code'), editorName: X('n') }, expected: [] },
  'cms.InsertTemplate': { props: { code: X('code'), editorName: X('n') }, expected: [] },
  // Feature 163, T110: the section settings carry no prose — an anchor is an
  // address and is never translated; the slot's blocks are their own nodes.
  'cms.Section': {
    props: {
      ...box,
      content: [],
      // T117: the settings are the block's own top-level props.
      anchor: X('anchor'),
      scheme: X('scheme'),
      width: X('width'),
      background: { kind: 'video', videoUrl: X('video'), videoPosterAssetId: X('poster'), mobileImageUrl: X('mobile') },
      spaceTop: { px: 16 },
      contentPosition: { base: 'start', desktop: 'center' },
      reveal: { effect: 'fade-up', desktopOnly: false },
    },
    expected: [],
  },
  // T158: the group's settings carry no prose either; its Sections are their own nodes.
  'cms.SectionGroup': {
    props: {
      ...box,
      content: [],
      anchor: X('anchor'),
      scheme: X('scheme'),
      background: { kind: 'image', imageUrl: X('image'), mobileImageUrl: X('mobile'), decorative: true, overlay: { kind: 'solid', strength: 40 } },
      spaceTop: { base: 'none', desktop: { px: 48 } },
      spaceBottom: 'none',
    },
    expected: [],
  },
  'cms.Row': { props: { ...box, content: [] }, expected: [] },
  // T156: the vertical distribution is layout, never prose.
  // T165: a Column's placement in its Row's grid is layout, never prose.
  'cms.Column': {
    props: { ...box, distribute: X('distribute'), rowSpan: { base: 1, desktop: 2 }, columnStart: { base: X('columnStart') }, rowStart: { base: X('rowStart') }, content: [] },
    expected: [],
  },
  'cms.Spacer': { props: { editorName: X('n'), dividerColor: X('c') }, expected: [] },
  // Feature 163, T054: the Carousel's header is prose; its options, controls and
  // the slides' own declarations are not this block's (a slide is its own node).
  'cms.ContentSlider': {
    props: {
      ...box,
      header: {
        heading: tiptap(P('carousel heading')),
        lead: P('carousel lead'),
        button: { label: P('carousel button'), link: { kind: 'page', slug: X('slug') }, style: X('style') },
      },
      headingSize: X('size'),
      // Feature 163, T151–T153: the heading's weight and measure, the controls' anchor.
      headingWeight: X('weight'), headingMaxWidth: { base: X('measure'), desktop: X('measure') }, headingMaxWidthPx: { base: 1, desktop: 2 },
      controlsAlignTo: X('to'),
      slides: [],
      slidesPerView: { base: 1.15, desktop: 3 },
      gap: X('gap'),
      effect: X('effect'),
      controls: {
        arrows: true,
        dots: false,
        placement: X('placement'),
        arrowVariant: X('variant'),
        arrowColor: X('arrow color'),
        // T147: the next arrow's own style is an option.
        nextArrowVariant: X('next variant'),
        // T163: so is the arrows' icon.
        arrowIcon: X('arrow icon'),
        // T171: the disabled arrows' look and colour are options.
        disabledArrowLook: X('disabled look'),
        disabledArrowColor: X('disabled color'),
        // R19B (T240–T242): the glyph and dot colours and the breakpoints hiding them are options.
        arrowGlyphColor: X('glyph'),
        dotColor: X('dot'),
        activeDotColor: X('active dot'),
        hideArrowsOn: { mobile: true },
        hideDotsOn: { tablet: true },
      },
      // T171: so is the loop.
      loop: false,
      // T129–T131: the placement per breakpoint, the layout and columns are options; the
      // filter's "All" label and each tag's label are prose, the tags themselves keys.
      controlsPlacement: { base: X('placement'), desktop: X('placement') },
      // T147, T143: the controls' alignment and the filter bar's style and alignment are options.
      controlsAlign: { base: X('align'), desktop: X('align') },
      bleed: X('bleed'),
      layout: X('layout'),
      columns: { base: 1, desktop: 3 },
      filter: {
        show: true,
        allLabel: P('filter all'),
        tags: [{ tag: X('tag'), label: P('tag label') }],
        style: X('filter style'),
        align: X('filter align'),
        // T161: the bar's overflow is an option.
        overflow: X('filter overflow'),
      },
    },
    expected: [P('carousel heading'), P('carousel lead'), P('carousel button'), P('filter all'), P('tag label')],
  },
  'cms.Slide': { props: { ...box, content: [], tags: X('tags') }, expected: [] },
  // Feature 163, T072: the heading and each row's title, description and
  // button label; the button's link is an address, never prose.
  'cms.LinkList': {
    props: {
      ...box,
      heading: tiptap(P('list heading')),
      // Feature 163, T151/T152: the heading's weight and measure are not prose.
      headingWeight: X('weight'), headingMaxWidth: { base: X('measure'), desktop: X('measure') }, headingMaxWidthPx: { base: 1, desktop: 2 },
      headingSize: X('size'),
      items: [
        {
          title: P('row title'),
          description: P('row description'),
          button: { label: P('row button'), link: { kind: 'url', href: X('href') }, style: X('style'), fill: X('fill') },
        },
      ],
      divider: true,
    },
    expected: [P('list heading'), P('row title'), P('row description'), P('row button')],
  },
  // Feature 163, T054: the Carousel's item blocks. Links, file and asset ids,
  // placements, ratios and caption styles are not prose.
  'cms.CarouselImage': {
    props: {
      ...box,
      image: { imageSource: X('source'), assetId: X('asset'), alt: P('image alt'), ratio: X('ratio') },
      caption: tiptap(P('caption')),
      captionPlacement: X('placement'),
      captionStyle: { background: X('bg'), color: X('color'), borderRadius: X('radius') },
      captionScrim: { kind: X('scrim'), strength: 60 },
      // T144: the caption's size and font are options.
      captionSize: { base: X('size'), desktop: X('size') },
      captionSizePx: 18,
      captionFont: X('font'),
      // T188: a caption weight per breakpoint is still an option.
      captionWeight: { base: X('weight'), desktop: X('weight desktop') },
      // T172: the caption's hover colour is an option.
      captionHoverColor: X('hover color'),
      // R19B (T249, T250): the read-more label is prose; its corner, size, icon and the caption's padding are not.
      captionPaddingPx: { base: 24, desktop: 40 },
      moreLabel: P('more label'),
      moreLabelPlacement: X('corner'),
      moreLabelSizePx: { base: 14 },
      moreLabelIcon: X('icon'),
      link: { kind: 'url', href: X('href') },
      tags: X('tags'),
    },
    expected: [P('image alt'), P('caption'), P('more label')],
  },
  'cms.CarouselSplit': {
    props: {
      ...box,
      // Feature 163, T168: the buttons' full width per breakpoint is layout, never prose.
      buttonsFullWidth: { base: X('width'), desktop: X('width') },
      media: { kind: 'image', image: { imageSource: X('source'), assetId: X('asset'), alt: P('media alt') } },
      mediaSide: X('side'),
      icon: X('icon'),
      iconAssetId: X('icon asset'),
      title: tiptap(P('split title')),
      body: tiptap(P('split body')),
      buttons: [{ label: P('split button'), link: { kind: 'url', href: X('href') }, style: X('style') }],
      tags: X('tags'),
    },
    expected: [P('split title'), P('split body'), P('split button'), P('media alt')],
  },
  'cms.LinkTile': {
    props: {
      ...box,
      image: { imageSource: X('source'), src: X('src'), alt: P('tile alt') },
      title: tiptap(P('tile title')),
      linkLabel: P('tile label'),
      link: { kind: 'product', slug: X('slug') },
      ratio: { base: X('ratio'), desktop: X('ratio') },
      tags: X('tags'),
      // T144: the title's and the label's size and font, and the label's style, are options.
      titleSize: { base: X('size'), desktop: X('size') },
      titleFont: X('font'),
      // T188: the title's and the label's weight per breakpoint are still options.
      titleWeight: { base: X('weight'), desktop: X('weight desktop') },
      labelSize: X('size'),
      labelSizePx: 20,
      labelFont: X('font'),
      labelWeight: { base: X('weight'), tablet: X('weight tablet') },
      // T172: the title's and the label's hover colours are options.
      titleHoverColor: X('hover color'),
      labelHoverColor: X('hover color'),
      // T178: the title's and the label's resting colours are options.
      titleColor: X('color'),
      // T181: a resting colour per breakpoint is still an option.
      labelColor: { base: X('color'), desktop: X('color') },
      labelStyle: X('label style'),
    },
    expected: [P('tile title'), P('tile label'), P('tile alt')],
  },
  'cms.DownloadTile': {
    props: {
      ...box,
      title: P('download title'),
      subtitle: P('download subtitle'),
      fileAssetId: X('file'),
      linkLabel: P('download label'),
      hoverImage: { imageSource: X('source'), assetId: X('asset'), alt: P('hover alt') },
      tags: X('tags'),
      // R19B (T247, T248): the card's look is options, never prose.
      scheme: X('scheme'),
      cardBackground: X('bg'),
      cardBorder: false,
      cornerRadius: X('radius'),
      paddingPx: { base: 24 },
      titleSizePx: { base: 32 },
      showType: false,
      hoverImageLook: X('hover look'),
      linkLook: X('link look'),
      iconButtonSizePx: { base: 72 },
      iconButtonBorderColor: X('ring'),
    },
    expected: [P('download title'), P('download subtitle'), P('download label'), P('hover alt')],
  },
};

describe('cms block declarations', () => {
  it('cover every block this module declares', () => {
    expect([...blocks.keys()].sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it.each(Object.entries(FIXTURES))('%s yields exactly its prose', (name, fixture) => {
    const data = { root: { props: {} }, content: [{ type: name, props: fixture.props }] };
    const extraction = extract(data, declarations);
    const texts = extraction.segments.map((segment) => segment.text);
    expect(texts).toEqual(fixture.expected);
    expect(texts.join('\n')).not.toContain('NOPE');
    expect([...extraction.untranslatableBlocks]).toEqual([]);
  });

  it('cms.SectionGroup: the blocks in its Sections are translated through their own declarations (T158)', () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.SectionGroup',
          props: {
            ...box,
            anchor: X('anchor'),
            scheme: X('scheme'),
            content: [
              {
                type: 'cms.Section',
                props: {
                  ...box,
                  anchor: X('anchor'),
                  content: [{ type: 'cms.Heading', props: { ...box, id: 'h', text: tiptap(P('inside a group')), level: 'h2' } }],
                },
              },
            ],
          },
        },
      ],
    };
    const extraction = extract(data, declarations);
    expect(extraction.segments.map((segment) => segment.text)).toEqual([P('inside a group')]);
    expect([...extraction.untranslatableBlocks]).toEqual([]);
  });

  it('cms.Section: the blocks in its slot are translated through their own declarations (T110)', () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Section',
          props: {
            ...box,
            anchor: X('anchor'),
            scheme: X('scheme'),
            content: [{ type: 'cms.Heading', props: { ...box, id: 'h', text: tiptap(P('inside a section')), level: 'h2' } }],
          },
        },
      ],
    };
    const extraction = extract(data, declarations);
    expect(extraction.segments.map((segment) => segment.text)).toEqual([P('inside a section')]);
    expect([...extraction.untranslatableBlocks]).toEqual([]);
  });
});

/**
 * Feature 163, T039, T043, T049 and T059 — a Heading, a Button, a Hero, a
 * FeatureList, a Stats block, a Testimonial, Tabs or an Accordion stored on `origin/master` and not
 * yet opened in the editor keeps its old shape, and its prose is still
 * translated: a heading's plain-string `text` under the `tiptap` declaration, a
 * button's top-level `label`, a hero's `heading`, `subtitle` and `buttonLabel`,
 * a feature list's plain titles and `description`s, a testimonial's plain quote,
 * a tab or accordion panel's HTML.
 */
describe('cms block declarations — blocks stored before the reshape', () => {
  it.each([
    ['cms.Heading', { ...box, text: P('stored heading'), level: 2, color: X('color'), fontFamily: X('family') }, [P('stored heading')]],
    ['cms.Button', { ...box, label: P('stored label'), href: X('href'), linkSlug: X('slug'), variant: X('variant') }, [P('stored label')]],
    [
      'cms.Hero',
      {
        ...box,
        heading: P('stored heading'),
        subtitle: P('stored subtitle'),
        buttonLabel: P('stored button'),
        buttonHref: X('href'),
        buttonLinkSlug: X('slug'),
        background: { kind: 'image', imageUrl: X('image') },
        textColor: X('color'),
      },
      [P('stored heading'), P('stored subtitle'), P('stored button')],
    ],
    [
      'cms.FeatureList',
      { ...box, items: [{ icon: X('icon'), title: P('stored title'), description: P('stored description') }], gap: 24, iconSize: 28 },
      [P('stored title'), P('stored description')],
    ],
    [
      'cms.Stats',
      { ...box, items: [{ value: P('stored value'), label: P('stored label') }], gap: 24, valueColor: X('color') },
      [P('stored value'), P('stored label')],
    ],
    [
      'cms.Testimonial',
      { ...box, quote: P('stored quote'), author: P('stored author'), role: P('stored role'), avatarUrl: X('avatar'), avatarAssetId: X('a') },
      [P('stored quote'), P('stored author'), P('stored role')],
    ],
    // Feature 163, T059: a panel stored as HTML, not yet moved into its slot.
    ['cms.Tabs', { ...box, items: [{ label: P('tab'), content: `<p>${P('tab content')}</p>` }] }, [P('tab'), `<0/>${P('tab content')}<1/>`]],
    [
      'cms.Accordion',
      { ...box, items: [{ title: P('accordion'), content: `<p>${P('accordion content')}</p>` }] },
      [P('accordion'), `<0/>${P('accordion content')}<1/>`],
    ],
  ] as const)('%s yields exactly its prose', (name, props, expected) => {
    const data = { root: { props: {} }, content: [{ type: name, props }] };
    const texts = extract(data, declarations).segments.map((segment) => segment.text);
    expect(texts).toEqual(expected);
  });
});
