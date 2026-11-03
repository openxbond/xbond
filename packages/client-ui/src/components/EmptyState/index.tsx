import { cn } from "@lib/utils";
import { type BaseComponentProps } from "@models";
import type { ReactNode } from "react";

interface EmptyStateProps extends BaseComponentProps {
  icon?: ReactNode;
  message: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  message,
  description,
  action,
  className,
  style,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-5 text-center text-body text-muted-foreground select-none",
        className,
      )}
      style={style}
    >
      {icon}
      <p>{message}</p>
      {description && <p className="text-xs">{description}</p>}
      {action}
    </div>
  );
}
