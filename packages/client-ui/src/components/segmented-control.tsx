import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { ControlTooltip } from "./ui/control-tooltip";
import { segmentedItem, segmentedTrack } from "./ui/segmented-styles";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Icon-only item: the label stays as the accessible name and is not
   * rendered visually (theme/appearance toggles and the like). */
  icon?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  description?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
  orientation?: "horizontal" | "vertical";
  size?: "sm" | "default" | "lg";
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
  itemClassName,
  orientation = "horizontal",
  size = "default",
}: SegmentedControlProps<T>) {
  const id = useId();
  const { i18n } = useTranslation();

  // 選中態直接用品牌橙：實心橙底、白字與同一套陰影，不再用桃色或中性
  // 白卡。品牌橙是選中與主操作共用的信號。
  const activeStyles =
    "data-[state=on]:bg-brand-action data-[state=on]:text-brand-action-foreground data-[state=on]:font-semibold data-[state=on]:shadow-2xs data-[state=on]:hover:bg-brand-action data-[state=on]:hover:text-brand-action-foreground";

  const sizeTrackStyles =
    size === "sm"
      ? "p-0.5 rounded-lg gap-0.5"
      : size === "lg"
        ? "p-1.5 rounded-2xl gap-1.5"
        : "p-1 rounded-xl gap-1";

  const sizeItemStyles =
    size === "sm"
      ? "min-h-[24px] px-2 py-0.5 text-xs max-md:min-h-10 max-md:px-3.5 rounded-md"
      : size === "lg"
        ? "min-h-9 px-4 py-1.5 text-sm rounded-xl"
        : // M3 label large: control text holds 14px at every width (the old
          // 12→13 desktop bump was an off-ramp pixel value).
          "min-h-7 px-3 py-1 text-sm max-md:min-h-10 max-md:px-4 rounded-lg";

  return (
    <ToggleGroup
      type="single"
      spacing={0.5}
      value={value ?? ""}
      dir={i18n.dir()}
      orientation={orientation}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next);
        if (
          !disabled &&
          option &&
          !option.disabled &&
          option.disabledReason === undefined
        ) {
          onChange(option.value);
        }
      }}
      className={cn(segmentedTrack, sizeTrackStyles, className)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option, index) => {
        const reasonId = option.disabledReason ? id + "-" + index : undefined;
        const item = (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            disabled={option.disabled && !reasonId}
            aria-disabled={reasonId ? true : undefined}
            aria-describedby={reasonId}
            aria-label={
              option.icon && typeof option.label === "string"
                ? option.label
                : undefined
            }
            title={option.disabledReason}
            className={cn(
              segmentedItem,
              "h-auto shrink aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
              sizeItemStyles,
              activeStyles,
              itemClassName,
            )}
          >
            {option.icon ?? option.label}
            {reasonId && (
              <span id={reasonId} className="sr-only">
                {option.disabledReason}
              </span>
            )}
          </ToggleGroupItem>
        );
        return option.description && !reasonId ? (
          <ControlTooltip key={option.value} description={option.description}>
            {item}
          </ControlTooltip>
        ) : (
          item
        );
      })}
    </ToggleGroup>
  );
}
