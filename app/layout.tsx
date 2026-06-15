import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppearanceRoot } from "./components/AppearanceRoot";

export const metadata: Metadata = {
  title: "Shaula Agent",
  description: "Shaula Agent — strike the core, finish the work",
  icons: {
    icon: [
      { url: "/brand/shaula-scorpion-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/shaula-scorpion-256.png", sizes: "256x256", type: "image/png" },
    ],
    apple: "/brand/shaula-scorpion-256.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      data-theme="light"
      suppressHydrationWarning
    >
      <head />
      <body>
        <AppearanceRoot />
        {children}
      </body>
    </html>
  );
}
