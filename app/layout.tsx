import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAPE — the tape never lies",
  description:
    "Paste a contract address (Solana, Base, Robinhood Chain, EVM). TAPE rebuilds the last hours of a token — every buy, sell and wallet-to-wallet transfer — and plays the footage back.",
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="3" fill="#0B0D0B"/><circle cx="11.5" cy="16" r="5.5" fill="none" stroke="#E8F0E4" stroke-width="1.6"/><circle cx="20.5" cy="16" r="5.5" fill="none" stroke="#E8F0E4" stroke-width="1.6"/><circle cx="11.5" cy="16" r="1.6" fill="#4CE07E"/><circle cx="20.5" cy="16" r="1.6" fill="#56C8E8"/><rect x="6" y="23.5" width="20" height="2" fill="#FF5A3C"/></svg>`
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0D0B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
