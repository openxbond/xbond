import { type BaseComponentProps } from "@models/BaseProps";
import { noop } from "@xbond/client/helper";
import classnames from "classnames";
import { type KeyboardEvent, type FocusEvent, type ChangeEvent } from "react";

import "./style.scss";

interface InputProps extends BaseComponentProps {
  value?: string | number;
  align?: "left" | "center" | "right";
  inside?: boolean;
  autoFocus?: boolean;
  type?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: string, event?: ChangeEvent<HTMLInputElement>) => void;
  onEnter?: (event?: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (event?: FocusEvent<HTMLInputElement>) => void;
}

export function Input(props: InputProps) {
  const {
    className,
    style,
    value = "",
    align = "center",
    inside = false,
    autoFocus = false,
    type = "text",
    disabled = false,
    onChange = noop,
    onBlur = noop,
    onEnter = noop,
  } = props;
  const classname = classnames(
    "input",
    `text-${align}`,
    { "focus:shadow-none": inside },
    className,
  );

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.code === "Enter") {
      onEnter(e);
    }
  }

  return (
    <input
      id={props.id}
      aria-label={props["aria-label"]}
      aria-invalid={props["aria-invalid"]}
      aria-describedby={props["aria-describedby"]}
      placeholder={props.placeholder}
      min={props.min}
      max={props.max}
      step={props.step}
      disabled={disabled}
      className={classname}
      style={style}
      value={value}
      autoFocus={autoFocus}
      type={type}
      onChange={(event) => onChange(event.target.value, event)}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
    />
  );
}
