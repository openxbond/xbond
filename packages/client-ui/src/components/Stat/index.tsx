import { type BaseComponentProps } from "@models";
import classnames from "classnames";
import type { ReactNode } from "react";

import "./style.scss";

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
      className={classnames("stat", { small: size === "sm" }, className)}
      style={style}
    >
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{children}</strong>
    </div>
  );
}
