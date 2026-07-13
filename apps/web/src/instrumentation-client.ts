import posthog from "posthog-js"

if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
  try {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_API_HOST || "https://p.stepform.ai",
      ui_host:
        process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || "https://eu.posthog.com",
      defaults: "2026-05-30",
    })
  } catch {
    // Analytics must never affect the local/offline editor experience.
  }
}
