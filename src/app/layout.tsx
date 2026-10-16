import type { Metadata, Viewport } from "next";
import "@fontsource/anton/latin-400.css";
import "./styles/time.css";
import "./styles/auth.css";

export const metadata: Metadata = {
  title: "Unlabelled Time",
  description: "Record the time you spend on each project.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f7" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1520" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
