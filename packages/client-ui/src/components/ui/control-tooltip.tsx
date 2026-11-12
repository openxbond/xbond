import { Tooltip } from "radix-ui";
import type { ReactElement } from "react";

export function ControlTooltip({
  children,
  description,
}: {
  children: ReactElement;
  description: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
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
