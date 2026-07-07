"use client"

import type { CSSProperties } from "react"
import { useTheme } from "next-themes"
import {
  IconExclamationCircleFilled,
  IconInfoCircleFilled,
} from "@tabler/icons-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

function Toaster({ ...props }: ToasterProps) {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      gap={8}
      offset={14}
      icons={{
        info: <IconInfoCircleFilled className="size-4 text-primary" />,
        warning: (
          <IconExclamationCircleFilled className="size-4 text-destructive" />
        ),
        error: (
          <IconExclamationCircleFilled className="size-4 text-destructive" />
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast !rounded-2xl !border !border-border/70 !bg-popover/80 !px-4 !py-3 !text-popover-foreground !shadow-none !backdrop-blur-md",
          content: "!gap-0.5",
          icon: "!mr-1.5 !size-4",
          title:
            "!text-[13px] !font-medium !leading-4 !text-popover-foreground",
          description:
            "!text-[12px] !font-normal !leading-4 !text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-background text-foreground",
        },
      }}
      style={
        {
          "--border-radius": "var(--radius-2xl)",
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "transparent",
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
