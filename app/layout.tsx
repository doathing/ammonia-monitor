import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "氨塔 · 升温还原监测",
  description: "私有云端升温还原监测，计划与实际趋势、独立浓度记录及完整备份。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
