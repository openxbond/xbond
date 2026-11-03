"use client";

import { cn } from "@lib/utils";
import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // DESIGN.md switch recipe: ~44×26 track with a white knob, brand when
        // checked; the component keeps its own hit area instead of a padded
        // wrapper.
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none data-[size=default]:h-[26px] data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 data-[state=checked]:bg-brand data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_oklch(0_0_0/20%)] ring-0 transition-transform group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4 data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-0 motion-reduce:transition-none",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
