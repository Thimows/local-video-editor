import { Geist, Geist_Mono } from "next/font/google"
import type { Metadata } from "next"

import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
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
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            <ServiceWorkerRegister />
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
