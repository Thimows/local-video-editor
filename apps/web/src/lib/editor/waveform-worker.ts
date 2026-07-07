import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  type AudioSample,
} from "mediabunny"

type WaveformWorkerRequest = {
  id: number
  file: File
  peaksPerMinute: number
}

type WaveformWorkerResponse =
  | {
      id: number
      type: "progress" | "done"
      peaks: Float32Array
      durationSeconds: number
      peaksPerMinute: number
    }
  | { id: number; type: "done"; peaks: null; durationSeconds: null }
  | { id: number; type: "error"; message: string }

globalThis.onmessage = (event: MessageEvent<WaveformWorkerRequest>) => {
  processWaveformRequest(event.data).catch((error: unknown) => {
    postWaveformMessage({
      id: event.data.id,
      type: "error",
      message:
        error instanceof Error ? error.message : "Could not extract waveform",
    })
  })
}

async function processWaveformRequest({
  id,
  file,
  peaksPerMinute,
}: WaveformWorkerRequest) {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })

  try {
    const audioTrack = await input.getPrimaryAudioTrack()

    if (!audioTrack || !(await audioTrack.canDecode())) {
      postWaveformMessage({
        id,
        type: "done",
        peaks: null,
        durationSeconds: null,
      })
      return
    }

    const durationSeconds =
      (await audioTrack.getDurationFromMetadata({ skipLiveWait: true })) ??
      (await audioTrack.computeDuration())

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      postWaveformMessage({
        id,
        type: "done",
        peaks: null,
        durationSeconds: null,
      })
      return
    }

    const peakCount = Math.max(
      1,
      Math.ceil((durationSeconds / 60) * peaksPerMinute)
    )
    const peaks = new Float32Array(peakCount)
    const sink = new AudioSampleSink(audioTrack)
    let lastProgressAt = 0

    for await (const sample of sink.samples(0, durationSeconds)) {
      try {
        addSampleToPeaks(sample, peaks, durationSeconds)
      } finally {
        sample.close()
      }

      const now = performance.now()

      if (now - lastProgressAt > 500) {
        lastProgressAt = now
        postWaveformMessage({
          id,
          type: "progress",
          peaks: normalizePeaks(peaks),
          durationSeconds,
          peaksPerMinute,
        })
      }
    }

    postWaveformMessage({
      id,
      type: "done",
      peaks: normalizePeaks(peaks),
      durationSeconds,
      peaksPerMinute,
    })
  } finally {
    input.dispose()
  }
}

function addSampleToPeaks(
  sample: AudioSample,
  peaks: Float32Array,
  durationSeconds: number
) {
  const frameCount = sample.numberOfFrames

  if (frameCount <= 0) {
    return
  }

  const frameStride = Math.max(1, Math.floor(sample.sampleRate / 8_000))
  const channelData = new Float32Array(frameCount)

  for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
    sample.copyTo(channelData, {
      planeIndex: channel,
      format: "f32-planar",
    })

    for (let frame = 0; frame < frameCount; frame += frameStride) {
      const time = sample.timestamp + frame / sample.sampleRate

      if (time < 0 || time >= durationSeconds) {
        continue
      }

      const peakIndex = Math.min(
        peaks.length - 1,
        Math.floor((time / durationSeconds) * peaks.length)
      )

      peaks[peakIndex] = Math.max(
        peaks[peakIndex] ?? 0,
        Math.abs(channelData[frame] ?? 0)
      )
    }
  }
}

function normalizePeaks(peaks: Float32Array) {
  let maxPeak = 0

  for (const peak of peaks) {
    maxPeak = Math.max(maxPeak, peak)
  }

  if (maxPeak <= 0) {
    return new Float32Array(peaks)
  }

  return Float32Array.from(peaks, (peak) => Math.min(1, peak / maxPeak))
}

function postWaveformMessage(message: WaveformWorkerResponse) {
  globalThis.postMessage(message)
}
