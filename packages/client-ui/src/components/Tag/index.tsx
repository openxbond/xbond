import { Badge } from "@components/ui/badge";
import { cn } from "@lib/utils";
import { type BaseComponentProps } from "@models/BaseProps";

interface TagProps extends BaseComponentProps {
  color?: string;
}

export function Tag({ color, className, style, children, ...rest }: TagProps) {
  return (
    <Badge
      variant="outline"
      {...rest}
      className={cn("bg-inset px-2.5 text-muted-foreground", className)}
      style={{ color, ...style }}
    >
      {children}
    </Badge>
  );
}
