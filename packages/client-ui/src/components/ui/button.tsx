import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

// XBond Bento button recipe: a soft, tactile control. Primary actions use
// a subtle ink/brand gradient and lift on hover; glass variants float on
// the aurora canvas without competing with the hero connect action.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control text-[13px] leading-none font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,filter] duration-[160ms] ease-[var(--ease-out-expo)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-destructive/20 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 max-md:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_6px_16px_-10px_oklch(0.2_0.03_265/55%)] hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_6px_16px_-10px_oklch(0.57_0.2_25/55%)] hover:brightness-105 focus-visible:ring-destructive/20",
        outline:
          "glass-button text-foreground hover:border-[var(--glass-border-strong)] hover:bg-white/75 dark:hover:bg-white/10",
        secondary:
          "glass-button text-secondary-foreground hover:bg-white/75 dark:hover:bg-white/10",
        brand:
          "gradient-brand text-brand-action-foreground shadow-[0_8px_20px_-10px_oklch(0.7_0.19_45/55%)] hover:brightness-105",
        success:
          "bg-success text-success-foreground shadow-[0_6px_16px_-10px_oklch(0.66_0.14_168/50%)] hover:bg-success/90",
        warning: "bg-warning text-warning-foreground hover:brightness-105",
        ghost:
          "text-muted-foreground hover:bg-white/55 hover:text-foreground dark:hover:bg-white/10",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[34px] px-3.5 py-1.5 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-[6px] px-2 text-[11px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-[8px] px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-10 px-[18px] has-[>svg]:px-4",
        icon: "size-[34px] max-md:size-11",
        "icon-xs": "size-6 rounded-[6px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[8px] max-md:size-11",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
