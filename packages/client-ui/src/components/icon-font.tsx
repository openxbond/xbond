import { cn } from "@/lib/utils";

import { type BaseComponentProps } from "./component-props";

import "@/styles/icon-font.css";

interface IconProps extends BaseComponentProps {
  // icon type
  type: string;

  // icon size
  size?: number;

  onClick?: React.FormEventHandler;
}

export function Icon(props: IconProps) {
  const { type, size = 14, className, style } = props;
  return (
    <i
      {...props}
      className={cn("clash-iconfont", `icon-${type}`, className)}
      style={{ fontSize: size, ...style }}
    />
  );
}
