import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockPulse — 台股智慧看盤",
  description: "專業級台股分析平台：即時報價、K線圖表、籌碼分析、AI 選股",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" data-theme="dark" className="h-full antialiased">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
