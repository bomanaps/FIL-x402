import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'FCR-x402 Demo',
  description: 'Instant payments on Filecoin using x402 and Fast Confirmation Rule',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistMono.variable} font-mono antialiased bg-zinc-950 text-zinc-100`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
