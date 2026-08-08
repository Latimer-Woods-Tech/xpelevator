import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://xpelevator.com";
const TITLE = "XPElevator — virtual customer simulator for employee training";
const DESCRIPTION =
  "Practice real-world customer calls and chats against customizable scoring criteria. Built for operators training sales floors and coaching practices.";

export const metadata: Metadata = {
  // metadataBase makes every relative URL below absolute. Without it Next emits
  // a relative og:image, which no social crawler resolves — the preview renders
  // blank while the tag looks correct in source.
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Latimer Woods",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    // Raster, deliberately: every major social crawler silently ignores an SVG
    // og:image, so an SVG here would preview blank.
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
