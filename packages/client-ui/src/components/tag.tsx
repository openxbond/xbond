import { cn } from "@/lib/utils";

import { type BaseComponentProps } from "./component-props";
import { Badge } from "./ui/badge";

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
