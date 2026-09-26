import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "주문 반자동화",
  description: "지역 단톡방 주문 취합·정리 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
