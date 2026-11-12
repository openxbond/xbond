import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { ControlTooltip } from "./ui/control-tooltip";
import { segmentedItem, segmentedTrack } from "./ui/segmented-styles";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
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
  variant?: "brand" | "default";
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
  variant = "brand",
  size = "default",
}: SegmentedControlProps<T>) {
  const id = useId();
  const { i18n } = useTranslation();

  // 選中態兩主題同語義（DESIGN segment-selected：柔桃底、深橙字）：
  // 淺色此前用近白底+細橙環，底色與軌道同為近白，灰階下辨認度不足。
  const activeStyles =
    variant === "brand"
      ? "data-[state=on]:bg-brand-soft data-[state=on]:text-brand-text data-[state=on]:font-semibold dark:data-[state=on]:bg-brand-soft dark:data-[state=on]:text-brand-text"
      : "data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:font-semibold data-[state=on]:shadow-2xs data-[state=on]:ring-1 data-[state=on]:ring-black/5 dark:data-[state=on]:ring-white/10 dark:data-[state=on]:shadow-black/25";

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
        : "min-h-7 px-3 py-1 text-xs xl:text-[13px] max-md:min-h-10 max-md:px-4 rounded-lg";

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
            title={option.disabledReason}
            className={cn(
              segmentedItem,
              "h-auto shrink aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
              sizeItemStyles,
              activeStyles,
              itemClassName,
            )}
          >
            {option.label}
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
