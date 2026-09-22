import type { Metadata, Viewport } from "next";
import Nav from "@/components/Nav";
import RegisterSW from "@/components/RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "Suraksha Setu",
  description: "Disaster alerts turned into instructions for your home, work and family.",
  manifest: "/manifest.json",
};
export const viewport: Viewport = { themeColor: "#0b0e14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Gujarati:wght@400;700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Bengali:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Nav />
        <RegisterSW />
      </body>
    </html>
  );
}
