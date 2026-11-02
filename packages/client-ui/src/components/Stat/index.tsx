import { type BaseComponentProps } from "@models";
import { cn } from "cn";
import type { ReactNode } from "react";

interface StatProps extends BaseComponentProps {
  label: ReactNode;
  /** "sm" renders the value as a quiet secondary figure. */
  size?: "md" | "sm";
}

export function Stat({
  label,
  size = "md",
  className,
  style,
  children,
}: StatProps) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-0.5", className)}
      style={style}
    >
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <strong
        className={cn(
          "tabular-nums",
          size === "sm"
            ? "text-[12.5px] font-medium text-muted-foreground"
            : "text-[15px] font-bold text-foreground",
        )}
      >
        {children}
      </strong>
    </div>
  );
}
