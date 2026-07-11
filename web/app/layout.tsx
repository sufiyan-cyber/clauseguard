import type { Metadata } from "next";
import { EB_Garamond, Geist_Mono, Lato } from "next/font/google";
import Link from "next/link";
import { IconScale } from "@/components/icons";
import "./globals.css";

const lato = Lato({
  variable: "--font-lato",
  weight: ["300", "400", "700"],
  subsets: ["latin"],
  display: "swap",
});
const garamond = EB_Garamond({
  variable: "--font-garamond",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ClauseGuard — Legal Document Intelligence",
  description:
    "Contract risk analysis with Mastra agents, Qdrant hybrid retrieval, and Enkrypt AI safety gates. Human-verified, fully audited.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${lato.variable} ${garamond.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-brand-ink"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-edge bg-base/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="group flex items-center gap-2.5" aria-label="ClauseGuard home">
              <span className="grid size-8 place-items-center rounded-lg border border-brand/30 bg-brand-soft text-brand transition-colors group-hover:border-brand/60">
                <IconScale size={17} />
              </span>
              <span className="font-serif text-[17px] font-semibold tracking-tight">
                Clause<span className="text-brand">Guard</span>
              </span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Primary">
              <Link
                href="/"
                className="rounded-md px-3 py-2 text-ink-dim transition-colors duration-150 hover:bg-raised hover:text-ink"
              >
                Documents
              </Link>
              <Link
                href="/observability"
                className="rounded-md px-3 py-2 text-ink-dim transition-colors duration-150 hover:bg-raised hover:text-ink"
              >
                Observability
              </Link>
              <span className="ml-2 hidden items-center gap-1.5 rounded-full border border-edge px-3 py-1.5 text-[11px] font-medium text-ink-faint sm:flex">
                <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                Mastra · Qdrant · Enkrypt · Groq
              </span>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>
        <footer className="mx-auto mt-4 max-w-6xl border-t border-edge px-4 py-6 text-[11px] leading-relaxed text-ink-faint">
          ClauseGuard produces informational analysis, not legal advice. Every AI output passes
          Enkrypt AI safety gates and human review before finalization.
        </footer>
      </body>
    </html>
  );
}
