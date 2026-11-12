import { Slot, Tooltip } from "radix-ui";
import type { ComponentProps, ReactElement } from "react";

function ControlTooltipTrigger({
  "data-state": _tooltipState,
  ...props
}: ComponentProps<typeof Slot.Root> & { "data-state"?: string }) {
  // The control owns data-state for its selected or checked styling.
  return <Slot.Root {...props} />;
}

export function ControlTooltip({
  children,
  description,
}: {
  children: ReactElement;
  description: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <ControlTooltipTrigger>{children}</ControlTooltipTrigger>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={8}
          collisionPadding={12}
          className="z-50 max-w-64 rounded-control border bg-popover px-3 py-2 text-label text-popover-foreground shadow-elevation-raised"
        >
          {description}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
