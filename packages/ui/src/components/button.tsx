import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import type { IconComponent } from "@workspace/ui/lib/icon-context"
import { cn } from "@workspace/ui/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        primary: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline:
          "bg-input text-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground aria-expanded:[&_svg]:text-foreground",
        secondary:
          "bg-input text-secondary-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground aria-expanded:[&_svg]:text-foreground",
        tertiary:
          "border border-border bg-transparent text-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground aria-expanded:[&_svg]:text-foreground",
        ghost:
          "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground aria-expanded:[&_svg]:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-foreground dark:bg-destructive/20 dark:hover:bg-destructive/30 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground",
        link: "text-primary underline-offset-4 hover:underline [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        md: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-lg),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-xl has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-lg),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-xl has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-lg),10px)] in-data-[slot=button-group]:rounded-xl [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-lg),12px)] in-data-[slot=button-group]:rounded-xl",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  loading = false,
  active = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    leadingIcon?: IconComponent
    trailingIcon?: IconComponent
    loading?: boolean
    active?: boolean
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-active={active ? "" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        buttonVariants({ variant, size, className }),
        active && "bg-accent text-foreground"
      )}
      {...props}
    >
      {LeadingIcon ? <LeadingIcon data-icon="inline-start" /> : null}
      {children}
      {TrailingIcon ? <TrailingIcon data-icon="inline-end" /> : null}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
