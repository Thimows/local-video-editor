const CACHE_PROJECT_ROUTES_MESSAGE = "CACHE_PROJECT_ROUTES"
const SERVICE_WORKER_RESPONSE_TIMEOUT_MS = 2500

export async function cacheProjectEditorRoutes(projectIds: string[]) {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    process.env.NODE_ENV !== "production" ||
    navigator.onLine === false
  ) {
    return
  }

  const paths = [
    ...new Set(
      projectIds
        .filter((id) => id.length > 0)
        .map((id) => `/projects/${encodeURIComponent(id)}`)
    ),
  ]

  if (paths.length === 0) {
    return
  }

  const registration = await getReadyServiceWorkerRegistration()
  const worker = registration?.active ?? navigator.serviceWorker.controller

  if (!worker) {
    return
  }

  await postCacheProjectRoutesMessage(worker, paths)
}

function getReadyServiceWorkerRegistration() {
  return Promise.race<ServiceWorkerRegistration | null>([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise<null>((resolve) =>
      window.setTimeout(resolve, SERVICE_WORKER_RESPONSE_TIMEOUT_MS)
    ),
  ])
}

function postCacheProjectRoutesMessage(worker: ServiceWorker, paths: string[]) {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    const timeout = window.setTimeout(
      resolve,
      SERVICE_WORKER_RESPONSE_TIMEOUT_MS
    )

    channel.port1.onmessage = () => {
      window.clearTimeout(timeout)
      resolve()
    }

    worker.postMessage(
      {
        type: CACHE_PROJECT_ROUTES_MESSAGE,
        paths,
      },
      [channel.port2]
    )
  })
}
