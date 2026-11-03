import { type BaseComponentProps } from "@models";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

interface DevicesProps extends BaseComponentProps {
  devices: Array<{ label: string; number: number }>;
  selected: string;
  onChange?: (label: string) => void;
}

export function Devices(props: DevicesProps) {
  const { t } = useTranslation("connections");

  const { className, style } = props;
  function handleSelected(label: string) {
    props.onChange?.(label);
  }
  // Selected chips keep their brand colors on hover — the base hover styles
  // only apply to unselected ones, matching the old cascade order.
  const itemClass = (selected: boolean) =>
    cn(
      "connections-devices-item mb-2 mr-2 cursor-pointer rounded-full border bg-inset px-3 py-1 text-label leading-[18px] tabular-nums transition-colors duration-[120ms]",
      selected
        ? "border-brand bg-brand-soft font-medium text-brand-text"
        : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
    );

  return (
    <div className={cn("flex flex-wrap px-1", className)} style={style}>
      <button
        type="button"
        className={itemClass(props.selected === "")}
        aria-pressed={props.selected === ""}
        onClick={() => handleSelected("")}
      >
        {t("filterAll")}
      </button>
      {props.devices.map((device) => (
        <button
          type="button"
          key={device.label}
          className={itemClass(props.selected === device.label)}
          aria-pressed={props.selected === device.label}
          onClick={() => handleSelected(device.label)}
        >
          {device.label} ({device.number})
        </button>
      ))}
    </div>
  );
}
