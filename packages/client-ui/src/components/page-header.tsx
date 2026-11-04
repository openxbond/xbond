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
        "header my-2.5 flex w-full flex-row items-center justify-between select-none",
        className,
      )}
      style={style}
    >
      <h1 className="shrink-0 text-xl leading-[1.4] font-semibold tracking-normal text-foreground">
        {title}
      </h1>
      <div className="flex flex-auto flex-wrap items-center justify-end gap-y-1">
        {children}
      </div>
    </header>
  );
}
