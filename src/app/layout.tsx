import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";

import { UI_PREFS_INLINE_SCRIPT } from "@/lib/ui-prefs";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "LinguaBloom",
    template: "%s · LinguaBloom",
  },
  description: "个人英语学习工作站：系统课程、真实输入、主动输出与间隔复习。",
  applicationName: "LinguaBloom",
  // Private, single-user deployment: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#14151f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme / data-sidebar are corrected by the inline script before first paint.
    <html lang="zh-CN" data-theme="light" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: UI_PREFS_INLINE_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
