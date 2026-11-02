import { type BaseComponentProps } from "@models/BaseProps";
import { noop } from "@xbond/client/helper";
import classnames from "classnames";

import "./style.scss";

interface SwitchProps extends BaseComponentProps {
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
}

export function Switch(props: SwitchProps) {
  const {
    className,
    checked = false,
    disabled = false,
    onChange = noop,
    label,
  } = props;
  const classname = classnames("switch", { checked, disabled }, className);

  function handleClick() {
    if (!disabled) {
      onChange(!checked);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={classname}
      onClick={handleClick}
    />
  );
}
