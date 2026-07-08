"use client"

import { useTheme } from "next-themes"
import {
  IconDeviceDesktopFilled as Monitor,
  IconDots as Dots,
  IconMoonFilled as Moon,
  IconSunFilled as Sun,
} from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownTrigger,
} from "@workspace/ui/components/ui/dropdown"
import { MenuItem } from "@workspace/ui/components/ui/menu-item"
import { Tooltip } from "@workspace/ui/components/ui/tooltip"

export function AppSettingsMenu({
  tooltip = "Editor settings",
}: {
  tooltip?: string
}) {
  const { theme, setTheme } = useTheme()
  const themeOptions = [
    { label: "System", value: "system", icon: Monitor },
    { label: "Light", value: "light", icon: Sun },
    { label: "Dark", value: "dark", icon: Moon },
  ]
  const selectedTheme = theme ?? "system"
  const selectedIndex = Math.max(
    0,
    themeOptions.findIndex((option) => option.value === selectedTheme)
  )

  return (
    <DropdownMenu>
      <Tooltip content={tooltip}>
        <span className="inline-flex">
          <DropdownTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={tooltip}
              >
                <Dots />
              </Button>
            }
          />
        </span>
      </Tooltip>
      <DropdownContent
        align="end"
        checkedIndex={selectedIndex}
        className="z-[5010] w-48"
      >
        <DropdownLabel>Theme</DropdownLabel>
        {themeOptions.map((option, index) => (
          <MenuItem
            key={option.value}
            index={index}
            icon={option.icon}
            label={option.label}
            checked={selectedTheme === option.value}
            onSelect={() => setTheme(option.value)}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  )
}
