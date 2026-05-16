import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import { HandsFreeProvider } from "@/lib/HandsFreeContext";
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
  title: "Salescribe",
  description: "Voice memos to structured sales notes, with proactive follow-up.",
};

// Pre-hydration script: synchronously read the saved theme preference and apply
// the `dark` class to <html> before paint. Without this, there's a flash of the
// wrong theme on page load. The script is intentionally tiny and defensive — if
// localStorage isn't available it falls through to OS preference.
const themeInitScript = `
try {
  var t = localStorage.getItem('salescribe:theme');
  var dark = t === 'dark' || ((t === 'system' || t === null) && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`.trim();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider>
          <HandsFreeProvider>
            <AuthProvider>{children}</AuthProvider>
          </HandsFreeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
