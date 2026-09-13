import type { Metadata, Viewport } from "next";
import "./globals.css";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export const metadata: Metadata = {
  title: "PetThread | Everything your pet needs, connected.",
  applicationName: "PetThread",
  description:
    "PetThread brings your pet’s records, care, appointments, providers, insurance, costs and life history together in one connected place.",
  openGraph: {
    title: "PetThread | Everything your pet needs, connected.",
    description:
      "PetThread brings your pet’s records, care, appointments, providers, insurance, costs and life history together in one connected place.",
    siteName: "PetThread",
  },
  twitter: {
    card: "summary",
    title: "PetThread | Everything your pet needs, connected.",
    description: "PetThread is the connected operating layer for a pet’s life.",
  },
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
