import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "./globals.css";
import { THEME_SCRIPT } from "@/components/theme-toggle";

export const metadata = { title: "EventOS", description: "AI-native event platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
