import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { type BaseComponentProps } from "@models/BaseProps";
import { cn } from "cn";

export interface ButtonSelectOptions<T = string> {
  label: string;
  value: T;
}

export interface ButtonSelectProps<T = string> extends BaseComponentProps {
  // options
  options: Array<ButtonSelectOptions<T>>;

  // active value
  value: T;

  // select callback
  onSelect?: (value: T) => void;
  disabled?: boolean;
}

/**
 * Small segmented picker: sunken inset track carrying the active item as a
 * card face — isomorphic in both themes, per the XBond console pattern.
 */
export function ButtonSelect<T = string>(props: ButtonSelectProps<T>) {
  const { options, value, onSelect, disabled, className, style } = props;

  return (
    <ToggleGroup
      type="single"
      value={String(value)}
      onValueChange={(next) => {
        if (next) onSelect?.(next as T);
      }}
      disabled={disabled}
      className={cn(
        "inline-flex flex-wrap gap-0 rounded-[calc(var(--radius)-2px)] bg-inset p-0.5",
        className,
      )}
      style={style}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={String(option.value)}
          value={String(option.value)}
          className={cn(
            "h-[26px] rounded-[calc(var(--radius)-4px)] px-3 text-xs font-normal data-[state=on]:bg-card data-[state=on]:font-medium data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_oklch(0.145_0_0/10%)]",
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
