import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export default function UpdateFrequency({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (hours: number) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("configuration");
  const id = useId();
  return (
    <div className="grid gap-2 text-sm">
      <label htmlFor={id}>{t("updateFrequency")}</label>
      <Select
        value={String(value)}
        onValueChange={(hours) => onChange(Number(hours))}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full rounded-control border-border-strong bg-inset text-foreground"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-control border-border bg-popover shadow-elevation-raised">
          {![0, 4, 12, 24, 72, 168].includes(value) && (
            <SelectItem value={String(value)}>
              {t("updateHours", { count: value })}
            </SelectItem>
          )}
          <SelectItem value="0">{t("updateDisabled")}</SelectItem>
          {[4, 12].map((count) => (
            <SelectItem key={count} value={String(count)}>
              {t("updateHours", { count })}
            </SelectItem>
          ))}
          {[1, 3, 7].map((count) => (
            <SelectItem key={count} value={String(count * 24)}>
              {t("updateDays", { count })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
