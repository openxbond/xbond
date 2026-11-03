import { cn } from "cn";

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
  return (
    <div
      className={cn(
        "inline-flex gap-0.5 rounded-control border border-border/70 bg-inset p-[3px]",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isDisabled = disabled || option.disabledReason !== undefined;
        return (
          <button
            type="button"
            key={option.value}
            aria-pressed={value === option.value}
            className={cn(
              "min-w-0 cursor-pointer rounded-[9px] px-4 py-[7px] text-body whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none",
              value === option.value
                ? "bg-brand font-semibold text-brand-foreground shadow-brand"
                : "bg-transparent text-foreground/72 hover:text-foreground",
            )}
            disabled={isDisabled}
            title={option.disabledReason}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
