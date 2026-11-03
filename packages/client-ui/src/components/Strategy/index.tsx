import { cn } from "cn";
import type { ReactNode } from "react";

import { renderNodeTitle } from "../CountryFlag";

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
        "flex h-full min-h-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-2.5 [scrollbar-width:thin] max-md:hidden",
        className,
      )}
      aria-label={label}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.name}
          className={cn(
            "relative w-full min-w-0 cursor-pointer rounded-lg border-0 px-3 py-[11px] text-start text-foreground transition-colors duration-150 motion-reduce:transition-none",
            value === item.name
              ? "bg-brand-soft before:absolute before:top-1/2 before:left-[5px] before:h-5 before:w-[2.5px] before:-translate-y-1/2 before:rounded-sm before:bg-brand before:content-['']"
              : "hover:bg-inset",
          )}
          aria-current={value === item.name ? "true" : undefined}
          onClick={() => onSelect(item.name)}
        >
          <span className="flex items-center justify-between gap-2">
            <strong
              className={cn(
                "overflow-hidden text-body font-semibold text-ellipsis whitespace-nowrap",
                value === item.name && "font-[650] text-brand-text",
              )}
            >
              {renderNodeTitle(item.name)}
            </strong>
            {item.kind && (
              <span className="shrink-0 rounded border border-border px-1 py-px text-2xs text-muted-foreground">
                {item.kind}
              </span>
            )}
          </span>
          <span className="mt-[5px] flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {renderNodeTitle(item.detail || "—")}
            </span>
            <span className="shrink-0 text-label tabular-nums">
              {item.count}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}

export function StrategyPath({ path }: { path: string[] }) {
  return (
    <span
      className="[overflow-wrap:anywhere] leading-[1.7]"
      title={path.join(" → ")}
    >
      {path.map((name, index) => (
        <span key={`${index}:${name}`}>
          {index > 0 && <span aria-hidden="true"> → </span>}
          {renderNodeTitle(name)}
        </span>
      ))}
    </span>
  );
}

/**
 * Node tile shared by the proxy group grid and the extension: selection is
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
        "node-grid-tile relative flex min-h-[54px] w-full list-none items-center justify-between gap-3 rounded-[10px] border bg-card p-0 transition-all duration-150 select-none focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring max-md:min-h-[50px] motion-reduce:transition-none",
        selected
          ? "border-brand bg-brand-soft"
          : disabled
            ? "border-border"
            : "cursor-pointer border-border hover:bg-inset hover:border-brand",
      )}
    >
      <button
        type="button"
        className="flex min-h-[52px] min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[inherit] border-0 bg-transparent p-3 text-start text-inherit font-[inherit] focus-visible:outline-none disabled:cursor-default"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
      >
        <span
          aria-hidden="true"
          className={cn(
            "block size-[13px] shrink-0 rounded-full border border-muted-foreground",
            selected && "border-4 border-brand-text",
          )}
        />
        <span
          title={name}
          className={cn(
            "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-[550] text-foreground",
            selected && "font-semibold text-brand-text",
          )}
        >
          {renderNodeTitle(name)}
          {detail && (
            <small className="mt-1 block text-label font-normal text-muted-foreground">
              {detail}
            </small>
          )}
        </span>
      </button>
      {children && (
        <span className="flex shrink-0 items-center gap-1.5 pe-3">
          {children}
        </span>
      )}
    </li>
  );
}
