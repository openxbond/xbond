import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { cn } from "@lib/utils";
import { type BaseComponentProps } from "@models/BaseProps";

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
            "h-[26px] rounded-[calc(var(--radius)-4px)] px-3 text-label font-normal data-[state=on]:bg-brand data-[state=on]:font-semibold data-[state=on]:text-brand-foreground data-[state=on]:shadow-brand",
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
