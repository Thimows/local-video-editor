"use client"

import { useTheme } from "next-themes"
import {
  IconDeviceDesktopFilled as Monitor,
  IconDots as Dots,
  IconMessageCircleFilled as MessageCircle,
  IconMoonFilled as Moon,
  IconSunFilled as Sun,
} from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
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
  const openFeedback = () => {
    window.open(
      "https://github.com/Thimows/local-video-editor/issues",
      "_blank",
      "noopener,noreferrer"
    )
  }
  const themeOptions = [
    { label: "System", value: "system", icon: Monitor },
    { label: "Light", value: "light", icon: Sun },
    { label: "Dark", value: "dark", icon: Moon },
  ]
  const selectedTheme = theme ?? "system"
  const selectedThemeIndex = Math.max(
    0,
    themeOptions.findIndex((option) => option.value === selectedTheme)
  )
  const feedbackIndex = 0
  const firstThemeIndex = 1
  const selectedIndex = firstThemeIndex + selectedThemeIndex

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
        <DropdownLabel>Feedback</DropdownLabel>
        <MenuItem
          index={feedbackIndex}
          icon={MessageCircle}
          label="Feedback on GitHub"
          onSelect={openFeedback}
        />
        <DropdownSeparator />
        <DropdownLabel>Theme</DropdownLabel>
        {themeOptions.map((option, index) => (
          <MenuItem
            key={option.value}
            index={firstThemeIndex + index}
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
