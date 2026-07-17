import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unify Admin",
  description: "Central de operações e inteligência da Unify.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
