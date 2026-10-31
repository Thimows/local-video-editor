import Link from "next/link"
import Image from "next/image"
import type { Metadata } from "next"
import {
  IconBrandX as BrandX,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconDatabaseFilled as HardDrive,
  IconDeviceFloppyFilled as Export,
  IconShieldCheckFilled as ShieldCheck,
  IconVideoFilled as Film,
  IconWifiOff as Offline,
} from "@tabler/icons-react"

import { AppSettingsMenu } from "@/components/app-settings-menu"
import { ChromiumBrowserPills } from "@/components/chromium-browser-support"
import { LandingPixelBlast } from "@/components/landing-pixel-blast"
import { Button } from "@workspace/ui/components/button"

export const metadata: Metadata = {
  title: "Free Local Video Editor | Edit Videos Offline Without Uploading",
  description:
    "Edit and export videos in your browser without uploading files. A free, local-first video editor with no watermark and offline-first project storage.",
  keywords: [
    "local video editor",
    "offline video editor",
    "free video editor",
    "browser video editor",
    "no watermark video editor",
    "private video editing",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Free Local Video Editor",
    description:
      "Edit and export videos in your browser without uploading files, accounts, cloud processing, or watermarks.",
    type: "website",
    url: "/",
    images: [
      {
        url: "/landing/og-preview.png",
        width: 1800,
        height: 945,
        alt: "Local Video Editor preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Local Video Editor",
    description:
      "Edit and export videos in your browser without uploading files, accounts, cloud processing, or watermarks.",
    images: ["/landing/og-preview.png"],
  },
}

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Local Video Editor",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web browser",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  description:
    "A free local-first browser video editor for private video editing without uploads or watermarks.",
}

const highlights = [
  {
    icon: ShieldCheck,
    title: "Files stay on your computer",
    body: "Your videos are opened from local storage. The editor does not need an upload step, so source media stays under your control.",
  },
  {
    icon: Export,
    title: "Free exports without a watermark",
    body: "Create projects, trim clips, adjust audio, and export a finished video without adding a watermark.",
  },
  {
    icon: Offline,
    title: "Offline-first editing",
    body: "After the app is loaded, the editor is designed around local browser storage, local files, and offline-capable workflows.",
  },
  {
    icon: HardDrive,
    title: "Local project storage",
    body: "Project metadata, timeline edits, and generated preview data are saved in the browser instead of being tied to a server account.",
  },
]

const frequentlyAskedQuestions = [
  {
    question: "Are my videos uploaded to a server?",
    answer:
      "No. Local Video Editor processes your source videos and audio on your device, directly in the browser. Your media is not uploaded for editing or export, and you do not need a cloud account to work on a project.",
  },
  {
    question: "Is the video editor free, with no watermark?",
    answer:
      "Yes. You can create projects, trim and split clips, arrange video and audio, and export your finished video for free. Exports have no added watermark, and you do not need to sign up or enter payment details.",
  },
  {
    question: "Which video and audio formats can I use?",
    answer:
      "The file picker accepts MP4, MOV, M4V, and WebM video, plus MP3, M4A, WAV, OGG, and WebM audio. Playback also depends on the codecs supported by your browser and device. You can export to MP4 or WebM when the required encoders are available.",
  },
  {
    question: "Can I edit large video files in the browser?",
    answer:
      "There is no upload size limit because your videos stay on your device. Practical limits depend on available memory, browser storage, video resolution, and your hardware. Long or high-resolution projects can take more time to preview and export.",
  },
  {
    question: "Can I edit videos offline?",
    answer:
      "Editing and exporting run locally. Load the app and open your project while online first so the browser can cache the required resources. Offline reopening depends on those resources remaining cached, and your original media files must still be accessible on your device.",
  },
  {
    question: "Are my video projects saved automatically?",
    answer:
      "Your project edits are saved automatically in the same browser profile on this device. Projects do not sync to other devices, and clearing site data removes the saved projects. Keep your original media files: you may need to reconnect them if they move or the browser asks for permission again.",
  },
  {
    question: "Which browsers work best for video editing?",
    answer:
      "For the best experience, use an up-to-date desktop Chromium browser such as Chrome, Edge, Brave, Arc, or Dia. Media decoding, export codecs, and local file access depend on browser support, so other browsers and devices may have limited functionality.",
  },
  {
    question: "How can I improve preview playback and export speed?",
    answer:
      "Lower the preview resolution for smoother editing and close other demanding apps or browser tabs. Export time depends on your device, video duration, resolution, and codec. A lower export resolution can reduce processing time when you do not need the full output size.",
  },
]

export default function Page() {
  return (
    <main className="flex h-svh min-h-[520px] w-full flex-col overflow-hidden bg-background p-3 pt-0 text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      <header className="flex h-11 w-full shrink-0 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Film className="size-4" />
          </span>
          Local Video Editor
        </Link>
        <div className="flex items-center gap-2">
          <AppSettingsMenu tooltip="Settings" />
          <Button
            type="button"
            size="sm"
            nativeButton={false}
            render={<Link href="/projects" />}
          >
            Open projects
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden rounded-xl bg-card">
        <div className="h-full overflow-x-hidden overflow-y-auto px-8 pb-3">
          <div className="grid w-full gap-40">
            <section
              aria-labelledby="landing-hero-title"
              className="relative isolate mx-auto grid w-full max-w-[88rem] gap-8 overflow-visible pt-20 lg:grid-cols-[minmax(0,0.88fr)_minmax(520px,1.12fr)] lg:items-center lg:gap-12"
            >
              <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                <LandingPixelBlast className="absolute inset-0 opacity-50 dark:opacity-40" />
              </div>

              <div className="relative z-10 grid gap-5">
                <div className="pointer-events-none absolute -inset-x-8 -inset-y-7 -z-10 rounded-3xl bg-card/80 blur-2xl" />
                <iframe
                  src="https://ghbtns.com/github-btn.html?user=Thimows&repo=local-video-editor&type=star&count=true"
                  width="150"
                  height="20"
                  title="Star Local Video Editor on GitHub"
                  className="overflow-hidden border-0 bg-transparent [color-scheme:normal]"
                  scrolling="no"
                  referrerPolicy="no-referrer"
                />
                <div
                  className="space-y-2"
                  style={{
                    textShadow:
                      "0 1px 2px var(--card), 0 2px 12px var(--card), 0 0 28px var(--card)",
                  }}
                >
                  <h1
                    id="landing-hero-title"
                    className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
                  >
                    Free online video editor that keeps files on your computer.
                  </h1>
                  <p className="max-w-2xl text-lg leading-7 text-muted-foreground">
                    Local Video Editor lets you{" "}
                    <span className="font-medium text-foreground">cut</span>,{" "}
                    <span className="font-medium text-foreground">arrange</span>
                    ,{" "}
                    <span className="font-medium text-foreground">preview</span>
                    , and{" "}
                    <span className="font-medium text-foreground">export</span>{" "}
                    videos in the browser{" "}
                    <span className="font-medium text-foreground">
                      without uploading
                    </span>{" "}
                    your media. It is built for simple private editing:{" "}
                    <span className="font-medium text-foreground">
                      no account
                    </span>
                    ,{" "}
                    <span className="font-medium text-foreground">
                      no cloud processing
                    </span>
                    , and{" "}
                    <span className="font-medium text-foreground">
                      no watermark
                    </span>{" "}
                    on export.
                  </p>
                </div>
                <div className="grid gap-2.5">
                  <p className="text-sm font-medium text-muted-foreground">
                    Works best on{" "}
                    <span className="text-foreground">Chromium browsers</span>
                  </p>
                  <ChromiumBrowserPills />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    type="button"
                    size="default"
                    nativeButton={false}
                    render={<Link href="/projects?new=1" />}
                  >
                    Start editing
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                  <Button
                    type="button"
                    size="default"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/projects" />}
                  >
                    View projects
                  </Button>
                </div>
              </div>

              <div className="relative z-10 w-full min-w-0 sm:-mr-8 lg:-mr-56 lg:w-[720px] xl:w-[800px]">
                <div className="-mr-24 min-w-[500px] overflow-hidden rounded-lg bg-background sm:mr-0 sm:min-w-0 sm:rounded-xl">
                  <Image
                    src="/landing/editor-light.webp"
                    alt="Local Video Editor timeline and preview in light mode"
                    width={2820}
                    height={2126}
                    priority
                    sizes="(min-width: 1280px) 800px, (min-width: 1024px) 720px, 500px"
                    className="block w-full max-w-none dark:hidden"
                  />
                  <Image
                    src="/landing/editor-dark.webp"
                    alt="Local Video Editor timeline and preview in dark mode"
                    width={2820}
                    height={2126}
                    priority
                    sizes="(min-width: 1280px) 800px, (min-width: 1024px) 720px, 500px"
                    className="hidden w-full max-w-none dark:block"
                  />
                </div>
              </div>
            </section>

            <section
              aria-labelledby="landing-features-title"
              className="mx-auto grid w-full max-w-4xl gap-3 md:grid-cols-2"
            >
              <h2 id="landing-features-title" className="sr-only">
                Local-first video editing features
              </h2>
              {highlights.map((item) => (
                <article
                  key={item.title}
                  className="grid gap-3 rounded-xl bg-background px-4 py-4"
                >
                  <div className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <item.icon className="size-4" />
                  </div>
                  <p className="text-base leading-7 text-muted-foreground">
                    <span className="font-medium tracking-tight text-foreground">
                      {item.title}
                    </span>{" "}
                    {item.body}
                  </p>
                </article>
              ))}
            </section>

            <section
              aria-labelledby="landing-workflows-title"
              className="mx-auto grid w-full max-w-4xl gap-4"
            >
              <div className="grid gap-1.5">
                <h2
                  id="landing-workflows-title"
                  className="text-2xl font-medium tracking-tight"
                >
                  Private editing for everyday video work
                </h2>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                  Use it for quick cuts, social clips, screen recordings,
                  gameplay edits, tutorials, or cleaning up a local video before
                  sharing it. The important part is simple: your source files do
                  not need to leave your device just to make an edit.
                </p>
              </div>
              <div className="grid gap-3 text-base leading-7 md:grid-cols-3">
                <p className="rounded-xl bg-background px-4 py-4 text-muted-foreground">
                  <span className="font-medium tracking-tight text-foreground">
                    Import
                  </span>{" "}
                  video and audio files from your computer.
                </p>
                <p className="rounded-xl bg-background px-4 py-4 text-muted-foreground">
                  <span className="font-medium tracking-tight text-foreground">
                    Arrange
                  </span>{" "}
                  clips on a timeline with local preview playback.
                </p>
                <p className="rounded-xl bg-background px-4 py-4 text-muted-foreground">
                  <span className="font-medium tracking-tight text-foreground">
                    Export
                  </span>{" "}
                  a finished file without a watermark.
                </p>
              </div>
            </section>

            <section
              aria-labelledby="landing-faq-title"
              className="mx-auto grid w-full max-w-4xl gap-4"
            >
              <div className="grid gap-1.5">
                <h2
                  id="landing-faq-title"
                  className="text-2xl font-medium tracking-tight"
                >
                  Questions about editing videos locally
                </h2>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                  What to know about privacy, supported formats, offline editing,
                  and keeping your projects on your device.
                </p>
              </div>
              <div className="grid gap-3">
                {frequentlyAskedQuestions.map((item) => (
                  <details
                    key={item.question}
                    name="landing-faq"
                    className="group rounded-xl bg-background"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <h3 className="text-base leading-7 font-medium tracking-tight text-foreground">
                        {item.question}
                      </h3>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                      />
                    </summary>
                    <p className="px-4 pt-0.5 pb-4 text-base leading-7 text-muted-foreground">
                      {item.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>

            <footer className="mx-auto flex w-full max-w-4xl flex-col-reverse items-center justify-between gap-3 pt-8 pb-2 text-sm text-muted-foreground sm:flex-row">
              <p>&copy; 2026</p>
              <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
                <span>Built by</span>
                <a
                  href="https://x.com/thmawa"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <BrandX className="size-3.5" />
                  <span>@thmawa</span>
                </a>
                <span>in</span>
                <span className="inline-flex items-center gap-1.5">
                  <Image
                    src="/landing/eu-flag-circular.svg"
                    alt="EU flag"
                    width={16}
                    height={16}
                  />
                  <span>Europe</span>
                </span>
              </div>
            </footer>
          </div>
        </div>
      </section>
    </main>
  )
}
