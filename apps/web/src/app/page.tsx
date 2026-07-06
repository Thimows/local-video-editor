import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight, Film, HardDrive, ShieldCheck, WifiOff } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

export default function Page() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Film className="size-4" />
          </span>
          Local Video Editor
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button render={<Link href="/projects" />}>
            Open projects
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100svh-3.5rem)] w-full max-w-6xl content-center gap-10 px-4 py-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div className="flex max-w-xl flex-col gap-6">
          <Badge variant="outline" className="w-fit">
            Offline-first, no upload path
          </Badge>
          <div className="space-y-4">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-normal text-balance sm:text-6xl">
              Edit videos privately in your browser.
            </h1>
            <p className="max-w-lg text-base leading-7 text-muted-foreground">
              Import local clips, arrange a simple timeline, control volume, add
              music, and export a clean WebM file without accounts, servers, or
              watermarks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" render={<Link href="/projects" />}>
              Start editing
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              render={<Link href="/projects" />}
            >
              View projects
            </Button>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border bg-card p-3 shadow-sm">
          <div className="aspect-video overflow-hidden rounded-md border bg-muted">
            <div className="flex h-full flex-col justify-between bg-[linear-gradient(135deg,oklch(0.98_0_0),oklch(0.88_0.03_235))] p-4 dark:bg-[linear-gradient(135deg,oklch(0.22_0_0),oklch(0.22_0.04_235))]">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">Preview</Badge>
                <Badge variant="outline">Local files only</Badge>
              </div>
              <div className="mx-auto flex aspect-video w-2/3 items-center justify-center rounded-md border bg-background/80 text-muted-foreground">
                <Film className="size-12" />
              </div>
              <div className="grid gap-2">
                <div className="h-3 w-4/5 rounded-full bg-primary/70" />
                <div className="h-3 w-3/5 rounded-full bg-primary/35" />
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="grid grid-cols-[1.2fr_0.8fr_1fr] gap-2">
              <div className="h-12 rounded-md bg-primary/70" />
              <div className="h-12 rounded-md bg-primary/45" />
              <div className="h-12 rounded-md bg-primary/60" />
            </div>
            <div className="h-8 rounded-md bg-muted" />
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/35">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 md:grid-cols-3">
          <Feature
            icon={<ShieldCheck className="size-4" />}
            title="Private by default"
            body="Source media stays on the device. Project metadata is saved locally."
          />
          <Feature
            icon={<WifiOff className="size-4" />}
            title="Works offline"
            body="The app shell is cached after the first visit with a service worker."
          />
          <Feature
            icon={<HardDrive className="size-4" />}
            title="Memory aware"
            body="The editor stores edit decisions and references instead of media bytes."
          />
        </div>
      </section>
    </main>
  )
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="grid gap-2 rounded-lg border bg-background p-4">
      <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        {icon}
      </div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  )
}
