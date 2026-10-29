import { type BaseComponentProps } from "@models";
import { noop } from "@xbond/client/helper";
import classnames from "classnames";
import { type MouseEventHandler } from "react";

import "./style.scss";

interface ButtonProps extends BaseComponentProps {
  type?: "primary" | "normal" | "danger" | "success" | "warning" | "brand";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}

export function Button(props: ButtonProps) {
  const {
    type = "normal",
    onClick = noop,
    children,
    className,
    style,
    disabled,
  } = props;
  const classname = classnames("button", `button-${type}`, className, {
    "button-disabled": disabled,
  });

  return (
    <button
      className={classname}
      style={style}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
