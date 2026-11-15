import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ReviewProvider } from "@/components/clips/review-store";
import { Suspense } from "react";
import { MobileTabBar, MobileTabBarView, Sidebar, SidebarView } from "@/components/shell/sidebar";
import { Topbar, TopbarView } from "@/components/shell/topbar";
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
        <ReviewProvider>
          <div className="flex h-dvh">
            <Suspense fallback={<SidebarView pathname="" />}>
              <Sidebar />
            </Suspense>
            <div className="flex h-dvh min-w-0 flex-1 flex-col">
              <Suspense fallback={<TopbarView pathname="" />}>
                <Topbar />
              </Suspense>
              <main className="flex-1 overflow-y-auto pb-[58px] sm:pb-0">{children}</main>
            </div>
          </div>
          <Suspense fallback={<MobileTabBarView pathname="" />}>
            <MobileTabBar />
          </Suspense>
        </ReviewProvider>
      </body>
    </html>
  );
}
