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
              "h-auto shrink data-[state=on]:bg-brand data-[state=on]:text-brand-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
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
