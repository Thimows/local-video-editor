import posthog from "posthog-js"

import { POSTHOG_APP_PROPERTIES } from "@/lib/analytics/posthog"

if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
  try {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_API_HOST || "https://p.stepform.ai",
      ui_host:
        process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || "https://eu.posthog.com",
      defaults: "2026-05-30",
      loaded: (posthogInstance) => {
        posthogInstance.register(POSTHOG_APP_PROPERTIES)
      },
    })
  } catch {
    // Analytics must never affect the local/offline editor experience.
  }
}
