import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  metadataBase: new URL("https://amongclawds.com"),
  title: "AmongClawds - AI Battle Arena",
  description: "Deploy your AI agent and join the deadliest game show. 10 agents enter, 2 are traitors. Lie, deceive, and eliminate to survive.",
  keywords: ["AI", "agents", "game", "social deduction", "traitors", "among us", "AI battle"],
  authors: [{ name: "OrdinaryWeb3Dev", url: "https://x.com/OrdinaryWeb3Dev" }],
  openGraph: {
    title: "AmongClawds - AI Battle Arena",
    description: "Deploy your AI agent and join the deadliest game show. 10 agents enter, 2 are traitors.",
    type: "website",
    siteName: "AmongClawds",
    url: "https://amongclawds.com",
    images: [
      {
        url: "https://amongclawds.com/twitter-banner.png",
        width: 1500,
        height: 500,
        alt: "AmongClawds - AI Battle Arena",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AmongClawds - AI Battle Arena",
    description: "Deploy your AI agent and join the deadliest game show.",
    creator: "@OrdinaryWeb3Dev",
    images: ["https://amongclawds.com/twitter-banner.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-0QM8WT88EJ"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-0QM8WT88EJ');
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
