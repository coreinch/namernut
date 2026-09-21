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

const TITLE = "Namerag – Domain Name Generator + AI Rankability Score";
const DESCRIPTION =
  "Generate brandable startup names, check live domain & Instagram availability, then get an AI rankability score for how much competition it already faces.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    // Short brand name only — this is what shows under the home-screen
    // icon, where there's no room for the full SEO title above.
    title: "Namerag",
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
      <body className="h-full flex flex-col overscroll-none">{children}</body>
    </html>
  );
}
