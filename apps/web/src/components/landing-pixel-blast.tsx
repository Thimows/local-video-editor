"use client"

import { useTheme } from "next-themes"

import PixelBlast from "@/components/PixelBlast.jsx"

const primaryColors = {
  light: "#00b0e5",
  dark: "#00cfff",
}

export function LandingPixelBlast({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme()
  const color =
    resolvedTheme === "dark" ? primaryColors.dark : primaryColors.light

  return (
    <div aria-hidden="true" className={className}>
      <PixelBlast
        variant="diamond"
        pixelSize={4}
        color={color}
        className=""
        style={undefined}
        patternScale={1}
        patternDensity={1}
        enableRipples
        rippleSpeed={0.3}
        rippleThickness={0.1}
        rippleIntensityScale={1.1}
        speed={0.4}
        transparent
        edgeFade={0.2}
      />
    </div>
  )
}
