const POSTHOG_PROJECT_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com"
const APP_NAME = "local-video-editor"
const DISTINCT_ID_STORAGE_KEY = "local-video-editor:analytics-distinct-id"

type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>

export function trackPageView(pathname: string) {
  trackAnalyticsEvent("$pageview", {
    pathname,
  })
}

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
    const payload = JSON.stringify({
      api_key: POSTHOG_PROJECT_TOKEN,
      event,
      distinct_id: getDistinctId(),
      properties: {
        ...compactProperties(properties),
        app_name: APP_NAME,
        app_environment: getAppEnvironment(),
        $current_url: window.location.href,
        $host: window.location.host,
        $pathname: window.location.pathname,
      },
    })

    const endpoint = `${POSTHOG_HOST.replace(/\/$/, "")}/capture/`

    if (navigator.sendBeacon) {
      const queued = navigator.sendBeacon(
        endpoint,
        new Blob([payload], { type: "application/json" })
      )
      if (queued) return
    }

    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined)
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

function getDistinctId() {
  try {
    const existing = window.localStorage.getItem(DISTINCT_ID_STORAGE_KEY)
    if (existing) return existing

    const nextId = createDistinctId()
    window.localStorage.setItem(DISTINCT_ID_STORAGE_KEY, nextId)
    return nextId
  } catch {
    return createDistinctId()
  }
}

function createDistinctId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
