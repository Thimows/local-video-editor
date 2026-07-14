import posthog from "posthog-js"

const POSTHOG_PROJECT_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const APP_NAME = "local-video-editor"

export const POSTHOG_APP_PROPERTIES = {
  app_name: APP_NAME,
  app_environment: getAppEnvironment(),
} as const

type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>

export function trackAnalyticsEvent(
  event: string,
  properties: AnalyticsProperties = {}
) {
  if (
    !POSTHOG_PROJECT_TOKEN ||
    typeof window === "undefined" ||
    navigator.onLine === false
  ) {
    return
  }

  try {
    posthog.capture(event, {
      ...compactProperties(properties),
      ...POSTHOG_APP_PROPERTIES,
    })
  } catch {
    // Analytics must never affect the local/offline editor experience.
  }
}

function compactProperties(properties: AnalyticsProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  )
}

function getAppEnvironment() {
  if (process.env.NODE_ENV === "production") return "production"
  return process.env.NODE_ENV || "development"
}
