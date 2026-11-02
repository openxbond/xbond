import { type BaseComponentProps } from "@models/BaseProps";
import { cn } from "cn";

interface TagProps extends BaseComponentProps {
  color?: string;
}

export function Tag({ color, className, style, children, ...rest }: TagProps) {
  return (
    <span
      {...rest}
      className={cn(
        "flex h-[22px] items-center justify-center rounded-full border border-border bg-inset px-2.5 text-center text-xs text-muted-foreground",
        className,
      )}
      style={{ color, ...style }}
    >
      {children}
    </span>
  );
}
