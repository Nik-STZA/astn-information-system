import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "AfricanSTN information system",
  description:
    "Internal operating system for African Sports Technology Network (AfricanSTN), operated by Sports Tech Africa Limited.",
  icons: {
    icon: "/logos/protea-mono-dark.png",
    shortcut: "/logos/protea-mono-dark.png",
    apple: "/logos/protea-mono-dark.png",
  },
  robots: {
    index: false,
    follow: false,
  },
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
