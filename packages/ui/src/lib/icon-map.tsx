"use client"

import type { ComponentType } from "react"

import {
  IconChevronRight,
  IconChevronDown,
  IconColorPicker,
  IconX,
  IconCopy,
  IconMenu2,
  IconPoint,
  IconDeviceDesktop,
  IconSun,
  IconMoon,
  IconSquare,
  IconCircle,
  IconLibrary,
  IconClock,
  IconStar,
  IconSettings,
  IconPlus,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconSearch,
  IconLoader2,
  IconUsers,
  IconLock,
  IconMail,
  IconBell,
  IconShield,
  IconPalette,
  IconBulb,
  IconRocket,
  IconHeart,
  IconBrush,
  IconBrain,
  IconGlobe,
  IconUser,
  IconPhoto,
  IconLink,
  IconCheck,
  IconRotate2,
  IconPlayerPlay,
  IconPlayerPause,
  IconHome,
  IconMessageCircle,
  IconInbox,
  IconPencil,
  IconPlayerSkipForward,
  IconCornerDownRight,
} from "@tabler/icons-react"

export interface IconComponentProps {
  size?: number
  strokeWidth?: number
  className?: string
}

export type IconComponent = ComponentType<IconComponentProps>

export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "x"
  | "copy"
  | "menu"
  | "dot"
  | "monitor"
  | "sun"
  | "moon"
  | "rectangle-horizontal"
  | "circle"
  | "square-library"
  | "clock"
  | "star"
  | "settings"
  | "plus"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "search"
  | "loader"
  | "users"
  | "lock"
  | "mail"
  | "bell"
  | "shield"
  | "palette"
  | "lightbulb"
  | "rocket"
  | "heart"
  | "paintbrush"
  | "brain"
  | "globe"
  | "user"
  | "image"
  | "link"
  | "check"
  | "rotate-ccw"
  | "play"
  | "pause"
  | "pipette"
  | "home"
  | "message-circle"
  | "inbox"
  | "pencil"
  | "skip-forward"
  | "corner-down-right"

// Tabler: `strokeWidth` → `stroke` prop
function tabler(
  Icon: ComponentType<{ size?: number; stroke?: number; className?: string }>
): IconComponent {
  return function TablerAdapter({
    size,
    strokeWidth,
    className,
  }: IconComponentProps) {
    return <Icon size={size} stroke={strokeWidth} className={className} />
  }
}

export const iconMap: Record<IconName, IconComponent> = {
  "chevron-right": tabler(IconChevronRight),
  "chevron-down": tabler(IconChevronDown),
  pipette: tabler(IconColorPicker),
  x: tabler(IconX),
  copy: tabler(IconCopy),
  menu: tabler(IconMenu2),
  dot: tabler(IconPoint),
  monitor: tabler(IconDeviceDesktop),
  sun: tabler(IconSun),
  moon: tabler(IconMoon),
  "rectangle-horizontal": tabler(IconSquare),
  circle: tabler(IconCircle),
  "square-library": tabler(IconLibrary),
  clock: tabler(IconClock),
  star: tabler(IconStar),
  settings: tabler(IconSettings),
  plus: tabler(IconPlus),
  "arrow-left": tabler(IconArrowLeft),
  "arrow-right": tabler(IconArrowRight),
  "arrow-up": tabler(IconArrowUp),
  search: tabler(IconSearch),
  loader: tabler(IconLoader2),
  users: tabler(IconUsers),
  lock: tabler(IconLock),
  mail: tabler(IconMail),
  bell: tabler(IconBell),
  shield: tabler(IconShield),
  palette: tabler(IconPalette),
  lightbulb: tabler(IconBulb),
  rocket: tabler(IconRocket),
  heart: tabler(IconHeart),
  paintbrush: tabler(IconBrush),
  brain: tabler(IconBrain),
  globe: tabler(IconGlobe),
  user: tabler(IconUser),
  image: tabler(IconPhoto),
  link: tabler(IconLink),
  check: tabler(IconCheck),
  "rotate-ccw": tabler(IconRotate2),
  play: tabler(IconPlayerPlay),
  pause: tabler(IconPlayerPause),
  home: tabler(IconHome),
  "message-circle": tabler(IconMessageCircle),
  inbox: tabler(IconInbox),
  pencil: tabler(IconPencil),
  "skip-forward": tabler(IconPlayerSkipForward),
  "corner-down-right": tabler(IconCornerDownRight),
}
