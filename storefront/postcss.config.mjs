// Storefront PostCSS configuration.
// Tailwind v4 is wired through its PostCSS plugin (the Next.js + webpack equivalent
// of admin's @tailwindcss/vite). Until app/globals.css adds `@import "tailwindcss"`,
// this plugin is a no-op pass-through: no utilities and no preflight reset are emitted,
// so rendering is unchanged. Tailwind activates only once that import lands (task T013).
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
