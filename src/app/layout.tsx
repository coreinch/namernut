import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Sora } from "next/font/google";
import "./globals.css";

// Display face — headline, wordmark, and every domain name shown in a
// result card, so the app's one distinctive typographic voice is also the
// thing it's actually selling.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Body face for everything else — labels, meanings, buttons.
const sora = Sora({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const TITLE = "Namernut – Domain Name Generator + AI Brandability Score";
const DESCRIPTION =
  "Generate brandable startup names, check live domain & Instagram availability, then get an AI brandability score for how much competition it already faces.";

// Structured data (schema.org WebApplication) — read directly by search
// crawlers and AI answer engines (GEO) without executing any JS, unlike the
// rest of this page. Kept in sync with TITLE/DESCRIPTION above by hand
// since JSON-LD has no shared-variable mechanism of its own.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Namernut",
  url: "https://namernut.com",
  description: DESCRIPTION,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any (web-based)",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL("https://namernut.com"),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "domain name generator",
    "brand name generator",
    "startup name generator",
    "AI domain name generator",
    "available domain names",
    "brandability score",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://namernut.com",
    siteName: "Namernut",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    // Short brand name only — this is what shows under the home-screen
    // icon, where there's no room for the full SEO title above.
    title: "Namernut",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F5FF" },
    { media: "(prefers-color-scheme: dark)", color: "#181233" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${sora.variable} h-full antialiased overscroll-none`}
    >
      <body className="h-full flex flex-col overscroll-none">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
      </body>
    </html>
  );
}
