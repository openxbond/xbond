import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-control-border/60 bg-border p-[3px] shadow-[inset_0_1px_2px_oklch(0_0_0/10%)] transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] max-md:data-[size=sm]:before:-inset-3 data-[size=default]:h-[26px] data-[size=default]:w-[46px] data-[size=sm]:h-5 data-[size=sm]:w-9 data-[state=checked]:border-brand-action data-[state=checked]:bg-brand-action",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none size-[18px] shrink-0 rounded-full bg-switch-thumb shadow-[0_1px_3px_oklch(0_0_0/25%)] transition-transform duration-150 ease-out motion-reduce:transition-none group-data-[size=sm]/switch:size-3 ltr:data-[state=checked]:translate-x-5 rtl:data-[state=checked]:-translate-x-5 ltr:group-data-[size=sm]/switch:data-[state=checked]:translate-x-4 rtl:group-data-[size=sm]/switch:data-[state=checked]:-translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
