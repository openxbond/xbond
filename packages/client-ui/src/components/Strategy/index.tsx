import type { ReactNode } from "react";

import { renderNodeTitle } from "../CountryFlag";

import "./style.scss";

export interface StrategyDirectoryItem {
  name: string;
  detail: string;
  count: number;
  kind?: string;
}
export function StrategyDirectory({
  items,
  value,
  onSelect,
  label,
  className = "",
}: {
  items: StrategyDirectoryItem[];
  value: string;
  onSelect: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <nav
      className={`proxy-directory strategy-directory ${className}`}
      aria-label={label}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.name}
          className={`proxy-dir-item ${value === item.name ? "is-active" : ""}`}
          aria-current={value === item.name ? "true" : undefined}
          onClick={() => onSelect(item.name)}
        >
          <span className="dir-item-top">
            <strong className="dir-item-name">
              {renderNodeTitle(item.name)}
            </strong>
            {item.kind && <span className="dir-item-badge">{item.kind}</span>}
          </span>
          <span className="dir-item-bottom">
            <span className="dir-item-now" title={item.detail}>
              {renderNodeTitle(item.detail || "—")}
            </span>
            <span className="dir-item-count">{item.count}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
export function StrategyPath({ path }: { path: string[] }) {
  return (
    <span className="strategy-path" title={path.join(" → ")}>
      {path.map((name, index) => (
        <span key={`${index}:${name}`}>
          {index > 0 && <span aria-hidden="true"> → </span>}
          {renderNodeTitle(name)}
        </span>
      ))}
    </span>
  );
}
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
      className={`node-grid-tile strategy-choice ${selected ? "is-selected" : ""} ${disabled ? "is-readonly" : "is-clickable"}`}
    >
      <button
        type="button"
        className="strategy-select-action"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
      >
        <span
          className={`tile-radio ${selected ? "is-active" : ""}`}
          aria-hidden="true"
        />
        <span className="tile-name" title={name}>
          {renderNodeTitle(name)}
          {detail && <small className="strategy-choice-detail">{detail}</small>}
        </span>
      </button>
      {children && <span className="tile-right">{children}</span>}
    </li>
  );
}
