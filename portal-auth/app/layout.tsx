import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Opal Dental Portal",
  description: "Panel para configurar integraciones y revisar métricas del asistente virtual.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
