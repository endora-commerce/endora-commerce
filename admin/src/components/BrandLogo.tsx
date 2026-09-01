/**
 * The Endora Commerce mark, inlined rather than fetched.
 *
 * Inline because the sidebar renders it on the first paint of every admin
 * screen: an `<img src>` would cost a request and a flash of nothing, and a
 * CSS `mask` would throw away the second tone. The artwork is the brand's own
 * two-colour version, so the tones are literals here and not design tokens —
 * a brand mark that re-tints with the accent hue is no longer the brand mark.
 *
 * It needs a light ground. Measured against the sidebar's `--bg-sidebar`
 * (`#1a1c1e`), `#8A1C5C` is 1.95:1 — invisible; on white it is 8.75:1. That is
 * why `.b2b-sidebar__brand-logo` is a light tile rather than the accent
 * gradient it used to be, and why the gradient could not simply stay: the
 * accent hue is indigo (248) and the mark is wine (325).
 */
export function BrandLogo({ className, label }: { className?: string; label: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1225 1417"
      role="img"
      aria-label={label}
      focusable="false"
    >
      <g transform="translate(-70 -123)">
        <path fill="#8A1C5C" d="M172 123A65 65 0 0 0 107 188A65 65 0 0 0 172 253L769.99609 253L770 253C972.77803 253.01228 1141.3628 405.91574 1161.1094 607.73047L1161.1094 607.73242L1161.1094 607.73438C1170.8199 706.90026 1094.6421 790.90206 995.00195 790.90039L995 790.90039L904 790.90039L904 920.90039L994.99805 920.90039C1169.3725 920.90339 1307.4806 768.61427 1290.4902 595.07031L1290.4902 595.06445C1264.3364 327.79641 1038.5492 123.01364 770.00391 123A65 65 0 0 0 770 123L172 123z" />
        <path fill="#8A1C5C" d="m388.92578,509.11523c-119.397,-2.62101-230.13527,63.43203-284.5625,169.73438-54.427232,106.30235-43.277539,234.76053 28.64844,330.09769l0.0312,0.043 313.5332,414.1446c52.09015,68.8542 132.14453,111.1165 218.38281,115.289h0.006 0.006c284.3908,13.7094 542.6296,-167.5765 626.3555,-439.709l-124.252,-38.2285c-66.4518,215.9869-270.11667,358.9654-495.83201,348.0899-47.85038,-2.3152-92.10262,-25.6788-121.00196,-63.8867l-0.008,-0.012-313.44336,-414.02536-0.008,-0.01C194.69288,874.84699 188.22613,800.30613 220.07812,738.0957c31.8539,-62.21415 96.11821,-100.54568 165.9961,-99.01172z" />
        <path fill="#8A1C5C" d="m356,725.5a65,65 0 0 0-65,65 65,65 0 0 0 65,65h302a65,65 0 0 0 65,-65 65,65 0 0 0-65,-65z" />
        <circle cx="127.5" cy="1313.5" r="92" fill="#AD758D" />
      </g>
    </svg>
  );
}
