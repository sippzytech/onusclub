import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Lato, Fraunces } from "next/font/google";
import "./globals.css";

// Lato — body, labels, tables. Loaded with the weights we actually use to
// keep the font CSS small. Variable name matches tailwind config.
const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-lato",
  display: "swap",
});

// Fraunces — display headings, big numbers, page titles. Same site that
// inspired this redesign uses it for everything serif-like.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OnUsClub",
  description: "Digital loyalty cards for cafés, salons, and small businesses.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <html lang="en" className={`${lato.variable} ${fraunces.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
