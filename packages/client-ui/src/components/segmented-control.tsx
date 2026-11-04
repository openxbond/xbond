import { useId } from "react";

import { cn } from "@/lib/utils";

import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** 擋位不可用時的原因；設定後按鈕禁用並以 title 提示。 */
  disabledReason?: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  /** 無障礙組名；同時作為視覺標籤由調用方自行排版。 */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/**
 * 三檔以內的互斥分段選擇。選中滑塊用品牌橙配深色字（DESIGN.md：
 * 亮橙底不配白字）；等待結果由調用方以 disabled 表達，成功後才改變選中。
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
}: SegmentedProps<T>) {
  const id = useId();
  return (
    <ToggleGroup
      type="single"
      spacing={0.5}
      value={value ?? ""}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next);
        if (!disabled && option && option.disabledReason === undefined)
          onChange(option.value);
      }}
      className={cn(
        "inline-flex gap-0.5 rounded-control border border-border/70 bg-inset p-[3px]",
        className,
      )}
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isDisabled = disabled || option.disabledReason !== undefined;
        // 禁用擋位保留焦點（aria-disabled），原因以 aria-describedby +
        // title 同步告知；disabled 按鈕不可聚焦，鍵盤與讀屏用戶會錯過原因。
        const reasonId = option.disabledReason
          ? `${id}-${option.value}-reason`
          : undefined;
        return (
          <ToggleGroupItem
            type="button"
            key={option.value}
            value={option.value}
            aria-disabled={isDisabled || undefined}
            aria-describedby={reasonId}
            className={cn(
              "min-w-0 max-md:flex max-md:min-h-11 max-md:items-center cursor-pointer rounded-[9px] px-4 py-[7px] text-body whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none",
              "text-foreground/72 hover:text-foreground data-[state=on]:bg-brand data-[state=on]:font-semibold data-[state=on]:text-brand-foreground data-[state=on]:shadow-brand",
              isDisabled && "cursor-not-allowed",
            )}
            title={option.disabledReason}
          >
            {option.label}
            {option.disabledReason && (
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
