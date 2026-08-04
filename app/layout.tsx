import type { Metadata } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
});

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-jost",
});

export const metadata: Metadata = {
  title: "Ehrin & Jay — Engagement",
  description:
    "Engagement photo gallery — Ehrin Osmond-Roche & Jay McKinlay, 28 June 2026, Queens Gardens — North Ward",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${jost.variable}`}>
      <body className="min-h-dvh antialiased font-utility">
        {children}
        <Script
          defer
          src="https://analytics.adentranter.com/script.js"
          data-website-id="ae9fc57d-07ec-4600-aee5-f15943f5fa27"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
