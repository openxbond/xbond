import { type BaseComponentProps } from "@models";
import classnames from "classnames";
import { useTranslation } from "react-i18next";

import "./style.scss";

interface DevicesProps extends BaseComponentProps {
  devices: Array<{ label: string; number: number }>;
  selected: string;
  onChange?: (label: string) => void;
}

export function Devices(props: DevicesProps) {
  const { t } = useTranslation("connections");

  const { className, style } = props;
  const classname = classnames("flex flex-wrap px-1", className);
  function handleSelected(label: string) {
    props.onChange?.(label);
  }

  return (
    <div className={classname} style={style}>
      <div
        className={classnames("connections-devices-item mb-2 pt-2", {
          selected: props.selected === "",
        })}
        onClick={() => handleSelected("")}
      >
        {t("filterAll")}
      </div>
      {props.devices.map((device) => (
        <div
          key={device.label}
          className={classnames("connections-devices-item mb-2 pt-2", {
            selected: props.selected === device.label,
          })}
          onClick={() => handleSelected(device.label)}
        >
          {device.label} ({device.number})
        </div>
      ))}
    </div>
  );
}
