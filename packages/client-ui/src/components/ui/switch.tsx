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
        // wrapper. The ::before extends the touch target past the 44×44 CSS
        // px floor without moving the visual track.
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] data-[size=default]:h-[26px] data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 data-[state=checked]:bg-brand data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none flex items-center justify-center rounded-full bg-white shadow-[0_1px_3px_oklch(0_0_0/20%)] ring-0 transition-transform group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4 data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-0 motion-reduce:transition-none",
        )}
      >
        {/* 開啟以品牌橙配深色功能標記（DESIGN.md「控制項與設定行」）。 */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-2.5 scale-75 text-brand-foreground opacity-0 transition-opacity group-data-[state=checked]/switch:scale-100 group-data-[state=checked]/switch:opacity-100 motion-reduce:transition-none group-data-[size=sm]/switch:hidden"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
