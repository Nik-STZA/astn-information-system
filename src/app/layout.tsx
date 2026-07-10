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
    <html lang="en" data-theme="auto" suppressHydrationWarning>
      <head>
        {/* Theme init \u2014 runs before first paint to prevent FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("stza-theme");if(t==="light"||t==="dark"||t==="auto"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.setAttribute("data-theme","auto")}}catch(e){document.documentElement.setAttribute("data-theme","auto")}})()`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
