import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@components/ui/empty";
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
    <Empty
      className={cn(
        "flex-none gap-2 p-0 px-5 select-none md:p-0 md:px-5",
        className,
      )}
      style={style}
    >
      {icon && <EmptyMedia>{icon}</EmptyMedia>}
      <EmptyHeader>
        <EmptyTitle>{message}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
