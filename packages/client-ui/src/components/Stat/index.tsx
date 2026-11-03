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
      <span className="text-label text-muted-foreground">{label}</span>
      <strong
        className={cn(
          "tabular-nums",
          size === "sm"
            ? "text-label font-medium text-muted-foreground"
            : "text-subtitle font-bold text-foreground",
        )}
      >
        {children}
      </strong>
    </div>
  );
}
