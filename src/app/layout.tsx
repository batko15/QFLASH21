import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';

import './globals.css';

export const metadata: Metadata = {
  title: 'QFLASH21 – DDE4 Diagnose & Flash',
  description:
    'Lokales Diagnose- und Flash-Tool für BMW DDE4 (EDC15C4): ECU-Identifikation, Fehlerspeicher, Live-Daten und BIN-Verwaltung per Web Serial / K-Line. Für E38, E39, E46 und E53.',
  applicationName: 'QFLASH21',
  keywords: ['BMW', 'DDE4', 'EDC15', 'KWP2000', 'K-Line', 'Web Serial', 'Chiptuning', 'Diagnose'],
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'QFLASH21',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#18181b' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors position="top-center" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
