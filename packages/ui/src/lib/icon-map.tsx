"use client"

import type { ComponentType } from "react"
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBell,
  IconBrain,
  IconBrush,
  IconBulb,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconClock,
  IconColorPicker,
  IconCopy,
  IconCornerDownRight,
  IconDeviceDesktop,
  IconGlobe,
  IconHeart,
  IconHome,
  IconInbox,
  IconLibrary,
  IconLink,
  IconLoader2,
  IconLock,
  IconMail,
  IconMenu2,
  IconMessageCircle,
  IconMoon,
  IconPalette,
  IconPencil,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
  IconPoint,
  IconRocket,
  IconRotate2,
  IconSearch,
  IconSettings,
  IconShield,
  IconSquare,
  IconStar,
  IconSun,
  IconUser,
  IconUsers,
  IconX,
} from "@tabler/icons-react"

export interface IconComponentProps {
  size?: number
  strokeWidth?: number
  className?: string
}

export type IconComponent = ComponentType<IconComponentProps>
export type IconLibrary = "tabler"

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

export const iconLibraryOrder: IconLibrary[] = ["tabler"]

export const iconLibraryLabels: Record<IconLibrary, string> = {
  tabler: "Tabler",
}

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

const tablerMap: Record<IconName, IconComponent> = {
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

export const iconMap: Record<IconLibrary, Record<IconName, IconComponent>> = {
  tabler: tablerMap,
}
