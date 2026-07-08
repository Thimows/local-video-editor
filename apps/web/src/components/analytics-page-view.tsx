"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { trackPageView } from "@/lib/analytics/posthog"

export function AnalyticsPageView() {
  const pathname = usePathname()

  useEffect(() => {
    trackPageView(pathname)
  }, [pathname])

  return null
}
