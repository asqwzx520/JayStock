import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono, Syne, Noto_Sans_TC } from "next/font/google";
import "./globals.css";

// ── Google Fonts（next/font 避免 FOUC + 自動 preload）────────────────────────
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--loaded-space-grotesk",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--loaded-ibm-plex-mono",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--loaded-syne",
  display: "swap",
});

const notoSansTC = Noto_Sans_TC({
  // 中文字型不支援 subset，改用 preload: false 避免阻塞
  preload: false,
  weight: ["400", "500", "700"],
  variable: "--loaded-noto-sans-tc",
  display: "swap",
});

import FeedbackWidget         from "@/components/ui/FeedbackWidget";
import AlertsToast            from "@/components/ui/AlertsToast";
import SessionProviderWrapper from "@/components/auth/SessionProviderWrapper";
import { auth }               from "@/auth";

// ── Site-wide Metadata ────────────────────────────────────────────────────────
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://stockpulse.tw"
  ),

  title: {
    default: "StockPulse — 台股智慧看盤",
    template: "%s | StockPulse",
  },
  description:
    "專業級台股分析平台：即時報價、K線圖表、三大法人籌碼、AI 策略選股。從籌碼到 AI，一個螢幕全看透。",
  keywords: [
    "台股",
    "選股",
    "籌碼分析",
    "K線",
    "法人",
    "外資",
    "股票分析",
    "AI選股",
    "融資融券",
    "加權指數",
  ],
  authors:  [{ name: "StockPulse Team" }],
  creator:  "StockPulse",
  publisher: "StockPulse",

  // Open Graph
  openGraph: {
    type:      "website",
    locale:    "zh_TW",
    url:       "https://stockpulse.tw",
    siteName:  "StockPulse",
    title:     "StockPulse — 台股最聰明的工作空間",
    description: "從籌碼到 AI，一個螢幕全看透 — 即時報價 · K線 · 法人籌碼 · AI選股",
    images: [
      {
        url:    "/og-image.png",
        width:  1200,
        height: 630,
        alt:    "StockPulse 台股分析平台",
      },
    ],
  },

  // Twitter / X card
  twitter: {
    card:        "summary_large_image",
    title:       "StockPulse — 台股最聰明的工作空間",
    description: "從籌碼到 AI，一個螢幕全看透",
    images:      ["/og-image.png"],
  },

  // Indexing policy
  robots: {
    index:  true,
    follow: true,
    googleBot: {
      index:             true,
      follow:            true,
      "max-image-preview": "large",
      "max-snippet":     -1,
    },
  },

  // Icons
  icons: {
    icon:    "/favicon.ico",
    apple:   "/apple-touch-icon.png",
    shortcut: "/favicon-32x32.png",
  },

  // PWA manifest
  manifest: "/manifest.json",
};

// ── Viewport (separate from Metadata in Next.js 14+) ─────────────────────────
export const viewport: Viewport = {
  width:         "device-width",
  initialScale:  1,
  maximumScale:  1,
  themeColor:    "#0a0a0f",
};

// ── Root Layout ───────────────────────────────────────────────────────────────
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server-side session — 未設定 Google OAuth 時 auth() 回傳 null（graceful fallback）
  let session = null;
  try { session = await auth(); } catch {}

  return (
    <html
      lang="zh-TW"
      suppressHydrationWarning
      className={`h-full antialiased ${spaceGrotesk.variable} ${ibmPlexMono.variable} ${syne.variable} ${notoSansTC.variable}`}
    >
      {/* overflow-hidden / h-full is controlled per-route via data-layout */}
      <body className="h-full">
        {/* 防 FOUC：在 React hydration 前讀 localStorage 並設 data-theme */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('stockpulse_theme')||'dark';document.documentElement.dataset.theme=t;}catch(e){}})();` }}
        />
        <SessionProviderWrapper session={session}>
          {children}
          <FeedbackWidget />
          <AlertsToast />
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
