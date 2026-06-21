import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "chorchat",
  description: "Realtime chat for Chen and Zuo",
  icons: {
    icon: "/chorchat-icon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
