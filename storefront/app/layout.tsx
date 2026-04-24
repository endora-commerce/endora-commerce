// Root layout — rendered server-side so search engines and LLM crawlers see the shell
// without any JavaScript execution (Principle VII).

import type { ReactNode } from 'react';

export const metadata = {
  title: 'B2B Platform',
  description:
    'A B2B commerce platform supporting Quote Requests and direct purchase for business customers.',
};

const defaultLocale = process.env['NEXT_PUBLIC_DEFAULT_LOCALE'] ?? 'en-US';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale}>
      <body>{children}</body>
    </html>
  );
}
