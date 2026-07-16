import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { TvScaleFrame } from "@/components/TvScaleFrame";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kantaí — Tela da TV",
  description: "Tela host do Kantaí para TV/projetor.",
};

// Declarado explicitamente (em vez de confiar só no default do Next) porque
// navegadores embutidos de Smart TV às vezes lidam mal com a meta viewport —
// ver TvScaleFrame para a mitigação de fato (escala fixa 1920x1080).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${plusJakartaSans.variable} dark h-full antialiased`}>
      <body className="h-screen w-screen">
        <TvScaleFrame>{children}</TvScaleFrame>
      </body>
    </html>
  );
}
