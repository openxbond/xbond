import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { type BaseComponentProps } from "./component-props";

interface CompactSearchProps extends BaseComponentProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  clearLabel: string;
}

// Compact header search shared by the inspect pages: inset field with a
// leading magnifier and a trailing clear, matching the proxies command bar.
export function CompactSearch({
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  clearLabel,
  className,
  style,
}: CompactSearchProps) {
  return (
    <div className={cn("relative flex items-center", className)} style={style}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground/60"
      />
      <input
        className="h-8 w-full rounded-xl border border-border/80 bg-inset/60 pr-7 pl-8 text-xs text-foreground transition-[border-color,background-color] duration-150 placeholder:text-muted-foreground/50 hover:border-brand/40 focus:border-brand focus:bg-card focus:outline-none max-md:h-11 max-md:text-base"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="absolute top-1/2 right-1.5 flex size-5 max-md:size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-inset hover:text-foreground"
          onClick={() => onValueChange("")}
          aria-label={clearLabel}
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      )}
    </div>
  );
}
