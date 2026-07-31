import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import Header from "@/components/Header";
import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Koder",
  description: "An Online Judge",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(" h-full antialiased", "font-sans")}>
      <body className="min-h-full flex flex-col">
        <Header />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
