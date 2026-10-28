import { type BaseComponentProps } from "@models";
import classnames from "classnames";
import type { ReactNode } from "react";

import "./style.scss";

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
    <div className={classnames("empty-state", className)} style={style}>
      {icon}
      <p>{message}</p>
      {description && <p className="empty-state-description">{description}</p>}
      {action}
    </div>
  );
}
