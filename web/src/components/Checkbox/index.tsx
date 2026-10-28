import { noop } from "@lib/helper";
import { type BaseComponentProps } from "@models/BaseProps";
import classnames from "classnames";

import "./style.scss";

interface CheckboxProps extends BaseComponentProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
}

export function Checkbox(props: CheckboxProps) {
  const { className, checked = false, onChange = noop } = props;
  const classname = classnames("checkbox", { checked }, className);

  return (
    <label className={classname}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="checkbox-marker" aria-hidden="true">
        <svg
          viewBox="0 0 18 18"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m4 9 3 3 7-7" />
        </svg>
      </span>
      <span>{props.children}</span>
    </label>
  );
}
