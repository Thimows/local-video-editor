import Link from "next/link"
import Image from "next/image"
import type { Metadata } from "next"
import {
  IconBrandX as BrandX,
  IconChevronRight as ChevronRight,
  IconDatabaseFilled as HardDrive,
  IconDeviceFloppyFilled as Export,
  IconShieldCheckFilled as ShieldCheck,
  IconVideoFilled as Film,
  IconWifiOff as Offline,
} from "@tabler/icons-react"

import { AppSettingsMenu } from "@/components/app-settings-menu"
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
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Local Video Editor",
    description:
      "Edit and export videos in your browser without uploading files, accounts, cloud processing, or watermarks.",
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

const supportedBrowsers = [
  {
    name: "Chrome",
    icon: "/landing/browsers/chrome.png",
  },
  {
    name: "Edge",
    icon: "/landing/browsers/edge.png",
  },
  {
    name: "Arc",
    icon: "/landing/browsers/arc.png",
  },
  {
    name: "Dia",
    icon: "/landing/browsers/dia.png",
  },
  {
    name: "Brave",
    icon: "/landing/browsers/brave.png",
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
                    Local Video Editor lets you cut, arrange, preview, and
                    export videos in the browser without uploading your media.
                    It is built for simple private editing: no account, no cloud
                    processing, and no watermark on export.
                  </p>
                </div>
                <BrowserSupport />
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
                    width={1800}
                    height={1356}
                    priority
                    sizes="(min-width: 1280px) 800px, (min-width: 1024px) 720px, 500px"
                    className="block w-full max-w-none dark:hidden"
                  />
                  <Image
                    src="/landing/editor-dark.webp"
                    alt="Local Video Editor timeline and preview in dark mode"
                    width={1800}
                    height={1356}
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

            <footer className="mx-auto flex w-full max-w-4xl flex-col-reverse items-center justify-between gap-3 pt-8 pb-2 text-sm text-muted-foreground sm:flex-row">
              <p>&copy; 2026</p>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                <a
                  href="https://x.com/thmawa"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <BrandX className="size-3.5" />
                  <span>Built by @thmawa in</span>
                  <Image
                    src="/landing/eu-flag-circular.svg"
                    alt="EU flag"
                    width={16}
                    height={16}
                  />
                  <span>Europe</span>
                </a>
              </div>
            </footer>
          </div>
        </div>
      </section>
    </main>
  )
}

function BrowserSupport() {
  return (
    <div className="grid gap-2.5">
      <p className="text-sm font-medium text-muted-foreground">
        Works best on{" "}
        <span className="text-foreground">Chromium browsers</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {supportedBrowsers.map((browser) => (
          <div
            key={browser.name}
            title={browser.name}
            aria-label={browser.name}
            className="flex items-center gap-1.5 rounded-xl bg-background/75 py-1.5 pr-3 pl-2 text-sm font-medium text-foreground backdrop-blur-md"
          >
            <Image
              src={browser.icon}
              alt={`${browser.name} app icon`}
              width={36}
              height={36}
              className="size-9 object-contain"
            />
            <span>{browser.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
