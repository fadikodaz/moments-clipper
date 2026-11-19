import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { MobileTabBar, MobileTabBarView, Sidebar, SidebarView } from "@/components/shell/sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Moments",
  description: "Turn a long stream into ready-to-post vertical shorts with captions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="flex min-h-dvh">
          <Suspense fallback={<SidebarView pathname="" />}>
            <Sidebar />
          </Suspense>
          <main className="min-w-0 flex-1 pb-[60px] md:pb-0">{children}</main>
        </div>
        <Suspense fallback={<MobileTabBarView pathname="" />}>
          <MobileTabBar />
        </Suspense>
      </body>
    </html>
  );
}
