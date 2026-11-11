import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { renderNodeTitle } from "./country-flag";

export interface StrategyDirectoryItem {
  name: string;
  detail: string;
  count: number;
  kind?: string;
}

/**
 * Left rail of the proxy workbench: the pane chrome (border, scroll, mobile
 * hiding) lives here so the directory is a drop-in grid child; the page
 * supplies only the surrounding grid.
 */
export function StrategyDirectory({
  items,
  value,
  onSelect,
  label,
  className,
}: {
  items: StrategyDirectoryItem[];
  value: string;
  onSelect: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto border-r border-border/80 bg-inset/30 p-2.5 [scrollbar-width:thin] max-md:hidden",
        className,
      )}
      aria-label={label}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.name}
          className={cn(
            "group relative w-full min-w-0 cursor-pointer rounded-xl border p-2 text-start transition-[color,background-color,border-color,box-shadow] duration-150 select-none motion-reduce:transition-none",
            value === item.name
              ? "border-brand/40 bg-brand-soft shadow-xs"
              : "border-transparent hover:border-border/60 hover:bg-card/70 hover:shadow-2xs",
          )}
          aria-current={value === item.name ? "true" : undefined}
          onClick={() => onSelect(item.name)}
          aria-label={item.name}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-1.5">
              <span
                title={item.name}
                className={cn(
                  "min-w-0 overflow-hidden text-xs xl:text-sm font-semibold text-ellipsis whitespace-nowrap text-foreground",
                  value === item.name && "font-bold text-brand-text",
                )}
              >
                {renderNodeTitle(item.name)}
              </span>
              {item.kind && (
                <span className="shrink-0 rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-caption font-mono font-medium text-muted-foreground">
                  {item.kind}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
              <span
                title={item.detail || "—"}
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-caption"
              >
                {renderNodeTitle(item.detail || "—")}
              </span>
              <span className="shrink-0 text-caption font-mono tabular-nums text-muted-foreground/80">
                {item.count}
              </span>
            </div>
          </div>
        </button>
      ))}
    </nav>
  );
}

export function StrategyPath({ path }: { path: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-caption leading-tight">
      {path.map((name, index) => (
        <span
          key={`${index}:${name}`}
          className="inline-flex items-center gap-0.5"
        >
          {index > 0 && (
            <ChevronRight
              className="size-2 text-muted-foreground/35 shrink-0 rtl:rotate-180"
              aria-hidden="true"
            />
          )}
          <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-inset/50 px-1.5 py-0.2 text-caption font-medium text-foreground/75 shadow-2xs">
            {renderNodeTitle(name)}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Node tile for the proxy group grid: selection is
 * the warm brand wash with a brand border, disabled tiles stay quiet.
 */
export function StrategyChoice({
  name,
  selected,
  disabled = false,
  onSelect,
  children,
  detail,
}: {
  name: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <li
      data-node={name}
      className={cn(
        "group node-grid-tile relative flex min-h-[42px] w-full list-none items-center justify-between gap-2 rounded-xl border bg-card p-1 ps-2.5 pe-2 transition-[color,background-color,border-color,box-shadow] duration-150 select-none shadow-2xs motion-reduce:transition-none",
        selected
          ? "border-brand/60 bg-brand-soft/40 shadow-xs ring-1 ring-brand/20"
          : disabled
            ? "border-border/50 opacity-60 cursor-not-allowed"
            : "border-border/80 hover:border-brand/40 hover:bg-inset/50 hover:shadow-2xs cursor-pointer",
      )}
    >
      <button
        type="button"
        className="flex min-h-[36px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[inherit] border-0 bg-transparent py-0.5 text-start text-inherit font-[inherit] focus-visible:outline-none disabled:cursor-default"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid size-3.5 shrink-0 place-items-center rounded-full border-2 transition-[border-color,background-color,box-shadow] duration-150",
            selected
              ? "border-brand bg-brand text-white shadow-2xs"
              : "border-muted-foreground/40 group-hover:border-brand/60",
          )}
        >
          {selected && <span className="size-1 rounded-full bg-white" />}
        </span>
        <span
          title={name}
          className={cn(
            "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-label font-medium text-foreground",
            selected && "font-semibold text-brand-text",
          )}
        >
          {renderNodeTitle(name)}
          {detail && (
            <small
              // DESIGN：需截斷的內容要有取得全名的途徑；鏈尾是解析出的真實
              // 節點名，移動端無 hover，靠 title 至少保住桌面與讀屏途徑。
              title={typeof detail === "string" ? detail : undefined}
              className="mt-0.5 block text-caption font-normal text-muted-foreground truncate"
            >
              {detail}
            </small>
          )}
        </span>
      </button>
      {children && (
        <span className="flex shrink-0 items-center gap-1.5">{children}</span>
      )}
    </li>
  );
}
