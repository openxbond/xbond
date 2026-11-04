import { Field, FieldLabel } from "@components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { cn } from "@lib/utils";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export default function UpdateFrequency({
  value,
  onChange,
  disabled,
  inline,
  className,
}: {
  value: number;
  onChange: (hours: number) => void;
  disabled: boolean;
  inline?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("configuration");
  const id = useId();

  return (
    <Field
      data-disabled={disabled}
      orientation={inline ? "horizontal" : "vertical"}
      className={cn(inline ? "w-auto gap-2.5" : "gap-2", className)}
    >
      <FieldLabel htmlFor={id}>{t("updateFrequency")}</FieldLabel>
      <Select
        value={String(value)}
        onValueChange={(hours) => onChange(Number(hours))}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          size={inline ? "sm" : "default"}
          className={inline ? "w-36" : "w-full"}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
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
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
