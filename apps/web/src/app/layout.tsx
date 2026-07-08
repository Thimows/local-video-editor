import { Geist } from "next/font/google"
import localFont from "next/font/local"
import type { Metadata } from "next"

import "@workspace/ui/globals.css"
import { AnalyticsPageView } from "@/components/analytics-page-view"
import { ThemeProvider } from "@/components/theme-provider"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import { Toaster } from "@/components/toaster"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { IconProvider } from "@workspace/ui/lib/icon-context"
import { ShapeProvider } from "@workspace/ui/lib/shape-context"
import { SurfaceProvider } from "@workspace/ui/lib/surface-context"
import { cn } from "@workspace/ui/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontPixel = localFont({
  src: "./fonts/geist-pixel.ttf",
  display: "swap",
  variable: "--font-pixel",
})

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://localvideoeditor.com"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Local Video Editor | Free Offline Browser Video Editing",
  description:
    "Edit and export videos in your browser without uploading files. A free, local-first video editor with no watermark and offline-first project storage.",
  applicationName: "Local Video Editor",
  creator: "@thmawa",
  publisher: "Local Video Editor",
  category: "video editing",
  keywords: [
    "local video editor",
    "offline video editor",
    "free video editor",
    "browser video editor",
    "private video editing",
    "no watermark video editor",
  ],
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    title: "Local Video Editor",
  },
  openGraph: {
    siteName: "Local Video Editor",
    title: "Local Video Editor | Free Offline Browser Video Editing",
    description:
      "Edit and export videos in your browser without uploading files, accounts, cloud processing, or watermarks.",
    type: "website",
    url: "/",
    images: [
      {
        url: "/landing/og-preview.png",
        width: 1800,
        height: 945,
        alt: "Local Video Editor preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Local Video Editor | Free Offline Browser Video Editing",
    description:
      "Edit and export videos in your browser without uploading files, accounts, cloud processing, or watermarks.",
    images: ["/landing/og-preview.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontPixel.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>
          <IconProvider defaultLibrary="tabler">
            <ShapeProvider defaultShape="pill">
              <SurfaceProvider value={1}>
                <TooltipProvider>
                  <ServiceWorkerRegister />
                  <AnalyticsPageView />
                  {children}
                  <Toaster />
                </TooltipProvider>
              </SurfaceProvider>
            </ShapeProvider>
          </IconProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
