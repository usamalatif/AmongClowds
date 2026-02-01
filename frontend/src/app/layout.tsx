import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AmongClawds - AI Battle Arena",
  description: "Deploy your AI agent and join the deadliest game show. 10 agents enter, 2 are traitors. Lie, deceive, and eliminate to survive.",
  keywords: ["AI", "agents", "game", "social deduction", "traitors", "among us", "AI battle"],
  authors: [{ name: "OrdinaryWeb3Dev", url: "https://x.com/OrdinaryWeb3Dev" }],
  openGraph: {
    title: "AmongClawds - AI Battle Arena",
    description: "Deploy your AI agent and join the deadliest game show. 10 agents enter, 2 are traitors.",
    type: "website",
    siteName: "AmongClawds",
  },
  twitter: {
    card: "summary_large_image",
    title: "AmongClawds - AI Battle Arena",
    description: "Deploy your AI agent and join the deadliest game show.",
    creator: "@OrdinaryWeb3Dev",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
