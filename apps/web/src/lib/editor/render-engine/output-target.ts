import {
  BufferTarget,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny"

import type { ExportFormat } from "../types"

const EXPORT_OPFS_CHUNK_SIZE = 8 * 1024 * 1024

export type ExportOutputTarget = {
  target: StreamTarget | BufferTarget
  getBlob: (mimeType: string) => Promise<Blob>
  cleanup: () => Promise<void>
}

export async function createExportOutputTarget(
  format: ExportFormat
): Promise<ExportOutputTarget> {
  const opfsTarget = await createOpfsExportOutputTarget(format).catch(
    () => null
  )

  if (opfsTarget) {
    return opfsTarget
  }

  const target = new BufferTarget()

  return {
    target,
    cleanup: async () => undefined,
    getBlob: async (mimeType) => {
      if (!target.buffer) {
        throw new Error("Export did not produce a video file.")
      }

      return new Blob([target.buffer], { type: mimeType })
    },
  }
}

async function createOpfsExportOutputTarget(
  format: ExportFormat
): Promise<ExportOutputTarget | null> {
  const root = await navigator.storage?.getDirectory?.()

  if (!root) {
    return null
  }

  const directory = await root.getDirectoryHandle("exports", { create: true })
  const fileName = `${crypto.randomUUID()}.${format}`
  const fileHandle = await directory.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable?.()

  if (!writable) {
    return null
  }

  return {
    target: new StreamTarget(writable as WritableStream<StreamTargetChunk>, {
      chunkSize: EXPORT_OPFS_CHUNK_SIZE,
      chunked: true,
    }),
    cleanup: async () => {
      await directory.removeEntry(fileName).catch(() => undefined)
    },
    getBlob: async (mimeType) => {
      const file = await fileHandle.getFile()

      return file.type === mimeType
        ? file
        : new File([file], file.name, { type: mimeType })
    },
  }
}
