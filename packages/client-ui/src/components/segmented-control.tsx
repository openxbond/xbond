import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { segmentedItem, segmentedTrack } from "./ui/segmented-styles";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
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
}: SegmentedControlProps<T>) {
  const id = useId();
  const { i18n } = useTranslation();

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
      className={cn(segmentedTrack, className)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option, index) => {
        const reasonId = option.disabledReason ? id + "-" + index : undefined;
        return (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            disabled={option.disabled && !reasonId}
            aria-disabled={reasonId ? true : undefined}
            aria-describedby={reasonId}
            title={option.disabledReason}
            className={cn(
              segmentedItem,
              // 選中是白色浮起膠囊、深色前景字（DESIGN.md「輸入與設定行」）：
              // 品牌橙留在軌道，不壓在小字上，保住對比。
              "h-auto shrink data-[state=on]:bg-white/95 data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-[0_6px_14px_-10px_oklch(0.2_0.03_265/45%)] data-[state=on]:ring-1 data-[state=on]:ring-border-strong dark:data-[state=on]:bg-white/15 dark:data-[state=on]:ring-white/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
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
      })}
    </ToggleGroup>
  );
}
