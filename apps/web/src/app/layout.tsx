import { Geist } from "next/font/google"
import localFont from "next/font/local"
import type { Metadata } from "next"

import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
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

export const metadata: Metadata = {
  title: "Local Video Editor",
  description: "Edit and export videos privately in your browser.",
  applicationName: "Local Video Editor",
  appleWebApp: {
    capable: true,
    title: "Local Video Editor",
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
                  {children}
                </TooltipProvider>
              </SurfaceProvider>
            </ShapeProvider>
          </IconProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
