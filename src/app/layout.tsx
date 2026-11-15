import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MobileTabBar, Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Moments",
  description: "Find the moments worth posting in your gameplay recordings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="flex h-dvh">
          <Sidebar />
          <div className="flex h-dvh min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 overflow-y-auto pb-[58px] sm:pb-0">{children}</main>
          </div>
        </div>
        <MobileTabBar />
      </body>
    </html>
  );
}
