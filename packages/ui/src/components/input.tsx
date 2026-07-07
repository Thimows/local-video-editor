"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { useShape } from "@workspace/ui/lib/shape-context"
import { cn } from "@workspace/ui/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const shape = useShape()

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 border-0 bg-background px-4 py-1 text-[13px] text-muted-foreground outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:text-foreground focus:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:bg-destructive/10",
        shape.input,
        className
      )}
      {...props}
    />
  )
}

export { Input }
