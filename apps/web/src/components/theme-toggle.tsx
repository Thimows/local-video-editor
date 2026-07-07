"use client"

import {
  IconDeviceDesktopFilled as Monitor,
  IconMoonFilled as Moon,
  IconSunFilled as Sun,
} from "@tabler/icons-react"
import { useTheme } from "next-themes"

import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

export function ThemeToggle({ size = "icon" }: { size?: "icon" | "icon-sm" }) {
  const { theme, setTheme } = useTheme()

  const nextTheme =
    theme === "light" ? "dark" : theme === "dark" ? "system" : "light"

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={size}
            aria-label="Toggle theme"
            onClick={() => setTheme(nextTheme)}
          />
        }
      >
        {theme === "light" ? (
          <Sun className="size-4" />
        ) : theme === "dark" ? (
          <Moon className="size-4" />
        ) : (
          <Monitor className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipContent>Theme</TooltipContent>
    </Tooltip>
  )
}
