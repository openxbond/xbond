import { type BaseComponentProps } from "@models/BaseProps";
import classnames from "classnames";

import "./style.scss";

export interface ButtonSelectOptions<T = string> {
  label: string;
  value: T;
}

export interface ButtonSelectProps<T = string> extends BaseComponentProps {
  // options
  options: Array<ButtonSelectOptions<T>>;

  // active value
  value: T;

  // select callback
  onSelect?: (value: T) => void;
  disabled?: boolean;
}

export function ButtonSelect<T = string>(props: ButtonSelectProps<T>) {
  const { options, value, onSelect } = props;

  return (
    <div className="button-select">
      {options.map((option) => (
        <button
          disabled={props.disabled}
          aria-pressed={value === option.value}
          value={String(option.value)}
          key={String(option.value)}
          className={classnames("button-select-options", {
            actived: value === option.value,
          })}
          onClick={() => onSelect?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
