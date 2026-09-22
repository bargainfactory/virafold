import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProvider } from "@/lib/context";
import { I18nProvider } from "@/lib/i18n";
import ToastContainer from "@/components/toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "Virafold — AI Content Repurposing for Faceless Creators";
const DESCRIPTION =
  "Turn one long-form video into 30+ short-form assets, carousels, and newsletters. The faceless-first AI content engine — you approve everything before it ships.";

export const metadata: Metadata = {
  metadataBase: new URL("https://virafold.ai"),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "AI content repurposing",
    "faceless YouTube",
    "content automation",
    "TikTok content",
    "podcast repurposing",
  ],
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": "https://virafold.ai/feed" },
    languages: {
      en: "https://virafold.ai/",
      es: "https://virafold.ai/es",
      fr: "https://virafold.ai/fr",
      de: "https://virafold.ai/de",
      pt: "https://virafold.ai/pt",
      ja: "https://virafold.ai/ja",
      zh: "https://virafold.ai/zh",
      ko: "https://virafold.ai/ko",
      ar: "https://virafold.ai/ar",
      hi: "https://virafold.ai/hi",
      ru: "https://virafold.ai/ru",
      it: "https://virafold.ai/it",
      id: "https://virafold.ai/id",
      tr: "https://virafold.ai/tr",
      vi: "https://virafold.ai/vi",
      nl: "https://virafold.ai/nl",
      pl: "https://virafold.ai/pl",
      th: "https://virafold.ai/th",
      "zh-TW": "https://virafold.ai/zh-TW",
      "x-default": "https://virafold.ai/",
    },
  },
  openGraph: {
    type: "website",
    url: "https://virafold.ai",
    siteName: "Virafold",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider>
          <AppProvider>
            {children}
            <ToastContainer />
          </AppProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
