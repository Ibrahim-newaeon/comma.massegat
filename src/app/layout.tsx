// src/app/layout.tsx
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Comms Platform',
  description: 'Internal communications',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Comms', statusBarStyle: 'default' },
};

export const viewport = {
  /* Tints the browser chrome on Android and the iOS status bar area. Must
     match the app's own surface or the seam between them is visible. */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F1F3' },
    { media: '(prefers-color-scheme: dark)', color: '#2B0429' },
  ],
  width: 'device-width',
  initialScale: 1,
};

/**
 * UI direction comes from the user's locale preference.
 * Content direction is set per-element with dir="auto" — never inherited
 * from this shell. See spec §6.1.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  // Read server-side so the correct theme is in the FIRST paint. Applying it
  // from JS after hydration means every load flashes white before going dark —
  // the single most noticeable failure a dark mode can have.
  const cookieTheme = jar.get('cp_theme')?.value;
  const theme = cookieTheme === 'dark' || cookieTheme === 'light' ? cookieTheme : 'system';
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} data-theme={theme} suppressHydrationWarning>
      <head>
        {/* iOS ignores the web manifest for both the home-screen icon and the
            standalone display mode. Without these three tags, "Add to Home
            Screen" produces a Safari bookmark rather than an app. */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Comms" />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
