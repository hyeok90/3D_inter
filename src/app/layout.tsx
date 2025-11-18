import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Reconstruction",
  description:
    "recording short videos and previewing mock 3D conversions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
