import type { Metadata } from "next";
import "./globals.css";
import {allowIndexing} from "@/lib/release";
import {existsSync} from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata { return {
  robots: { index: allowIndexing(), follow: allowIndexing() },
  icons: { icon: existsSync(path.join(process.cwd(),"public","retch-visionai-icon.png")) ? "/retch-visionai-icon.png" : "/icon.svg" },
  title: { default: "BusinessHub VisionAI", template: "%s · BusinessHub VisionAI" },
  description: "Clients, projects, invoices and an AI assistant in one place.",
}; }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Instrument+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
