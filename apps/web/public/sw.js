const CACHE_NAME = "local-video-editor-v2"
const APP_SHELL = ["/", "/projects", "/manifest.webmanifest"]
const CACHE_PROJECT_ROUTES_MESSAGE = "CACHE_PROJECT_ROUTES"
const PROJECT_EDITOR_PATH_PATTERN = /^\/projects\/[^/]+$/

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type !== CACHE_PROJECT_ROUTES_MESSAGE) {
    return
  }

  const paths = Array.isArray(event.data.paths) ? event.data.paths : []
  const responsePort = event.ports?.[0]

  event.waitUntil(
    cacheProjectRoutes(paths)
      .then(() => responsePort?.postMessage({ ok: true }))
      .catch(() => responsePort?.postMessage({ ok: false }))
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request

  if (request.method !== "GET") {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) {
            return cached
          }

          if (request.mode === "navigate") {
            return getNavigationFallback(url)
          }

          return Response.error()
        })
      )
  )
})

async function cacheProjectRoutes(paths) {
  const cache = await caches.open(CACHE_NAME)
  const uniquePaths = [...new Set(paths)]

  await Promise.all(
    uniquePaths.map(async (path) => {
      const url = getSameOriginUrl(path)

      if (!url || !isProjectEditorPath(url)) {
        return
      }

      const request = new Request(new URL(url.pathname, self.location.origin), {
        credentials: "same-origin",
      })
      const response = await fetch(request).catch(() => null)

      if (response?.ok) {
        await cache.put(request, response)
      }
    })
  )
}

async function getNavigationFallback(url) {
  const normalizedRequest = new Request(
    new URL(url.pathname, self.location.origin),
    {
      credentials: "same-origin",
    }
  )
  const cachedNavigation = await caches.match(normalizedRequest)

  if (cachedNavigation) {
    return cachedNavigation
  }

  if (isProjectEditorPath(url)) {
    return (
      (await caches.match("/projects")) ??
      (await caches.match("/")) ??
      Response.error()
    )
  }

  return (await caches.match("/")) ?? Response.error()
}

function getSameOriginUrl(path) {
  if (typeof path !== "string") {
    return null
  }

  try {
    const url = new URL(path, self.location.origin)

    return url.origin === self.location.origin ? url : null
  } catch {
    return null
  }
}

function isProjectEditorPath(url) {
  return PROJECT_EDITOR_PATH_PATTERN.test(url.pathname)
}
