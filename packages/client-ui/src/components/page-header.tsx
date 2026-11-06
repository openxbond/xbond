import { cn } from "@/lib/utils";

import { type BaseComponentProps } from "./component-props";

interface HeaderProps extends BaseComponentProps {
  // header title
  title: string;
}

export function Header(props: HeaderProps) {
  const { title, children, className, style } = props;

  return (
    <header
      className={cn(
        "header flex min-h-9 w-full flex-row items-center justify-between gap-3 select-none",
        className,
      )}
      style={style}
    >
      <h1 className="shrink-0 text-[18px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
        {title}
      </h1>
      <div className="flex flex-auto flex-wrap items-center justify-end gap-y-1">
        {children}
      </div>
    </header>
  );
}
