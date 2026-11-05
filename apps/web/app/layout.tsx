import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "A live party game for 3 to 12 players. Guess what friends really think, argue sides you were handed, and catch the bluffers. Everyone plays on their own phone.";

export const metadata: Metadata = {
  title: { default: "Hybrid Party Show", template: "%s · Hybrid Party Show" },
  description,
  openGraph: { title: "Hybrid Party Show", description, type: "website", siteName: "Hybrid Party Show" },
  twitter: { card: "summary_large_image", title: "Hybrid Party Show", description },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* The two faces seen above the fold. Missing files fail quietly and the fallbacks render. */}
        <link rel="preload" href="/fonts/docket-gothic-press.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/soehne-buch.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-ink-dark"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
