import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { Suspense } from "react";
import { MobileTabBar, MobileTabBarView, Sidebar, SidebarView } from "@/components/shell/sidebar";
import { DialogProvider } from "@/components/ui/dialogs";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Moments",
  description: "Turn a long stream into ready-to-post vertical shorts with captions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${bricolage.variable}`}>
      <body>
        <DialogProvider>
        <div className="flex min-h-dvh">
          <Suspense fallback={<SidebarView pathname="" />}>
            <Sidebar />
          </Suspense>
          <main className="min-w-0 flex-1 pb-[60px] md:pb-0">{children}</main>
        </div>
        <Suspense fallback={<MobileTabBarView pathname="" />}>
          <MobileTabBar />
        </Suspense>
        </DialogProvider>
      </body>
    </html>
  );
}
