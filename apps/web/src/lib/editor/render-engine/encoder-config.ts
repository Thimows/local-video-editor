import {
  Mp4OutputFormat,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny"

import type { ExportFormat } from "../types"

export type ExportFormatConfig = {
  audioCodec: AudioCodec
  extension: ExportFormat
  mimeType: string
  outputFormat: Mp4OutputFormat | WebMOutputFormat
  videoCodec: VideoCodec
}

export function getExportFormatConfig(format: ExportFormat): ExportFormatConfig {
  if (format === "mp4") {
    return {
      audioCodec: "aac",
      extension: "mp4",
      mimeType: "video/mp4",
      outputFormat: new Mp4OutputFormat({
        fastStart: "fragmented",
        minimumFragmentDuration: 1,
      }),
      videoCodec: "avc",
    }
  }

  return {
    audioCodec: "opus",
    extension: "webm",
    mimeType: "video/webm",
    outputFormat: new WebMOutputFormat({
      minimumClusterDuration: 1,
    }),
    videoCodec: "vp9",
  }
}
