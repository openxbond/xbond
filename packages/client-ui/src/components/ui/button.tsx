import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control text-sm leading-tight font-medium whitespace-nowrap optical-center transition-[background-color,border-color,color] duration-[160ms] ease-[var(--ease-out-expo)] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-destructive/20 motion-reduce:transition-none max-md:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_6px_16px_-10px_oklch(0.2_0.03_265/55%)] hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_6px_16px_-10px_oklch(0.57_0.2_25/55%)] hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "glass-button text-foreground hover:border-control-border hover:bg-inset active:bg-muted",
        secondary:
          "glass-button text-secondary-foreground hover:border-control-border hover:bg-inset active:bg-muted",
        brand:
          "gradient-brand rounded-full bg-brand-action text-brand-action-foreground shadow-brand-action hover:bg-brand-action-hover hover:bg-none active:bg-brand-text active:bg-none",
        success:
          "bg-success text-success-foreground shadow-[0_6px_16px_-10px_oklch(0.66_0.14_168/50%)] hover:bg-success/90",
        warning: "bg-warning text-warning-foreground hover:bg-warning/90",
        ghost:
          "text-muted-foreground hover:bg-white/55 hover:text-foreground dark:hover:bg-white/10",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-3.5 py-1.5 xl:h-11 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-[6px] px-2 text-caption has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-[8px] px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-11 px-[18px] xl:h-12 has-[>svg]:px-4",
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
