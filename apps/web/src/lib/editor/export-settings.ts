import type { ExportCompression, ExportSettings } from "./types"

export const EXPORT_COMPRESSION_OPTIONS: Array<{
  label: string
  value: ExportCompression
}> = [
  { label: "High quality", value: "high" },
  { label: "Balanced", value: "balanced" },
  { label: "Small file", value: "small" },
]

const EXPORT_AUDIO_BITRATES: Record<ExportCompression, number> = {
  balanced: 160_000,
  high: 192_000,
  small: 128_000,
}

const EXPORT_VIDEO_BITRATES_1080P30: Record<ExportCompression, number> = {
  balanced: 5_000_000,
  high: 8_000_000,
  small: 2_500_000,
}

export function getExportCompression(
  settings: Partial<ExportSettings>
): ExportCompression {
  return settings.compression ?? "balanced"
}

export function getExportBitrates(settings: ExportSettings) {
  const compression = getExportCompression(settings)
  const pixelScale = Math.pow(
    Math.max(1, settings.width * settings.height) / (1920 * 1080),
    0.95
  )
  const frameRateScale = Math.max(0.5, settings.fps / 30)
  const formatScale = settings.format === "webm" ? 0.75 : 1

  return {
    audioBitsPerSecond: EXPORT_AUDIO_BITRATES[compression],
    videoBitsPerSecond: roundBitrate(
      EXPORT_VIDEO_BITRATES_1080P30[compression] *
        pixelScale *
        frameRateScale *
        formatScale
    ),
  }
}

export function getEstimatedExportSizeBytes(
  settings: ExportSettings,
  durationSeconds: number
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0
  }

  const { audioBitsPerSecond, videoBitsPerSecond } = getExportBitrates(settings)

  return ((audioBitsPerSecond + videoBitsPerSecond) * durationSeconds) / 8
}

function roundBitrate(bitsPerSecond: number) {
  return Math.max(1_000, Math.round(bitsPerSecond / 1_000) * 1_000)
}
