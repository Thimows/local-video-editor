import Image from "next/image"

import { cn } from "@workspace/ui/lib/utils"

export const supportedChromiumBrowsers = [
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
] as const

export function ChromiumBrowserPills({
  className,
  chipClassName,
}: {
  className?: string
  chipClassName?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {supportedChromiumBrowsers.map((browser) => (
        <div
          key={browser.name}
          title={browser.name}
          aria-label={browser.name}
          className={cn(
            "flex items-center gap-1.5 rounded-xl bg-background/75 py-1.5 pr-3 pl-2 text-sm font-medium text-foreground backdrop-blur-md",
            chipClassName
          )}
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
  )
}
