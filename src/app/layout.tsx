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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
