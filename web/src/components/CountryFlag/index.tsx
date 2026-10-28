import "flag-icons/css/flag-icons.min.css";
import classnames from "classnames";
import { type ReactNode } from "react";

import "./style.scss";

export interface CountryFlagProps {
  code: string;
  className?: string;
}

export function CountryFlag({ code, className }: CountryFlagProps) {
  const normalized = code.toLowerCase();
  return (
    <span
      className={classnames(
        "fi",
        `fi-${normalized}`,
        "country-flag-icon",
        className,
      )}
      aria-label={code.toUpperCase()}
      title={code.toUpperCase()}
    />
  );
}

const REGIONAL_INDICATOR_PAIR = /([\uD83C][\uDDE6-\uDDFF]){2}/;

/**
 * Parses node names with flag emojis or leading 2-letter country prefixes,
 * transforming them into standard flag-icons.
 */
export function renderNodeTitle(name: string): ReactNode {
  if (!name) return name;

  // 1. Check for standard Unicode flag emoji (surrogate pairs)
  const matchEmoji = name.match(REGIONAL_INDICATOR_PAIR);
  if (matchEmoji && matchEmoji.index !== undefined) {
    const flagStr = matchEmoji[0];
    const cp1 = flagStr.codePointAt(0) ?? 0;
    const cp2 = flagStr.codePointAt(2) ?? 0;
    const char1 = String.fromCharCode(cp1 - 0x1f1e6 + 65);
    const char2 = String.fromCharCode(cp2 - 0x1f1e6 + 65);
    const countryCode = `${char1}${char2}`.toLowerCase();
    const before = name.slice(0, matchEmoji.index).trim();
    const after = name.slice(matchEmoji.index + flagStr.length).trim();

    return (
      <span className="node-title-with-flag">
        {before && <span className="title-prefix">{before} </span>}
        <CountryFlag code={countryCode} />
        <span className="title-text">{after || name}</span>
      </span>
    );
  }

  // 2. Check for leading 2-letter country code (e.g. "JP 日本" or "HK 香港")
  const matchLeading = name.match(/^([A-Za-z]{2})[\s-]+(.+)$/);
  if (matchLeading) {
    const candidate = matchLeading[1].toLowerCase();
    return (
      <span className="node-title-with-flag">
        <CountryFlag code={candidate} />
        <span className="title-text">{matchLeading[2]}</span>
      </span>
    );
  }

  return name;
}
