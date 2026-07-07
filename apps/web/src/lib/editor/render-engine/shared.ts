export const EXPORT_EDGE_SAMPLE_SECONDS = 1 / 60

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getTrackIndex(item: { trackIndex?: number }) {
  return item.trackIndex ?? 0
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Export cancelled", "AbortError")
  }
}

export function yieldToBrowser(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, 0)

    function onAbort() {
      window.clearTimeout(timeout)
      reject(
        signal.reason ?? new DOMException("Export cancelled", "AbortError")
      )
    }

    signal.addEventListener("abort", onAbort, { once: true })
  })
}
