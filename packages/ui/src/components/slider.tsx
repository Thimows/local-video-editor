"use client"

import { useState } from "react"

import {
  Slider as FluidSlider,
  type SliderProps as FluidSliderProps,
  type SliderValue as FluidSliderValue,
} from "@workspace/ui/components/ui/slider"
import { cn } from "@workspace/ui/lib/utils"

type CompatSliderValue = number | readonly number[]

type SliderProps = Omit<FluidSliderProps, "value" | "onChange"> & {
  value?: CompatSliderValue
  defaultValue?: CompatSliderValue
  onChange?: (value: FluidSliderValue) => void
  onValueChange?: (value: number[]) => void
}

function normalizeValue(
  value: CompatSliderValue | undefined,
  fallback: number
): FluidSliderValue {
  if (Array.isArray(value)) {
    const firstValue = value[0] ?? fallback

    if (value.length > 1) {
      return [firstValue, value[1] ?? firstValue] as [number, number]
    }

    return firstValue
  }

  return typeof value === "number" ? value : fallback
}

function toValueArray(value: FluidSliderValue): number[] {
  return Array.isArray(value) ? value : [value]
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  showValue = false,
  valuePosition = "tooltip",
  onChange,
  onValueChange,
  ...props
}: SliderProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState<FluidSliderValue>(
    () => normalizeValue(defaultValue ?? value, min)
  )
  const sliderValue =
    value === undefined ? uncontrolledValue : normalizeValue(value, min)

  function handleChange(nextValue: FluidSliderValue) {
    if (value === undefined) {
      setUncontrolledValue(nextValue)
    }

    onChange?.(nextValue)
    onValueChange?.(toValueArray(nextValue))
  }

  return (
    <FluidSlider
      className={cn("overflow-visible", className)}
      value={sliderValue}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      showValue={showValue}
      valuePosition={valuePosition}
      {...props}
    />
  )
}

export { Slider }
export type { SliderProps }
