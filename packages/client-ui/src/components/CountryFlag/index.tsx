import "flag-icons/css/flag-icons.min.css";
import { cn } from "cn";
import { type ReactNode } from "react";

export interface CountryFlagProps {
  code: string;
  className?: string;
}

export function CountryFlag({ code, className }: CountryFlagProps) {
  const normalized = code.toLowerCase();
  return (
    <span
      className={cn(
        "fi fi-" + normalized,
        // Compact flag chip: fixed ratio, hairline ring, baseline aligned.
        "mr-1.5 inline-block h-[13.5px] w-[18px] shrink-0 rounded-[2.5px] bg-cover leading-[13.5px] shadow-[0_0_0_1px_oklch(0_0_0/12%)] align-[-1.5px] before:hidden",
        className,
      )}
      aria-label={code.toUpperCase()}
      title={code.toUpperCase()}
    />
  );
}

const REGIONAL_INDICATOR_PAIR = /([\uD83C][\uDDE6-\uDDFF]){2}/;

const COUNTRY_NAME_MAP: Array<[RegExp, string]> = [
  [/香港|Hong\s*Kong|\bHK\b/i, "hk"],
  [/日本|Japan|Tokyo|Osaka|\bJP\b/i, "jp"],
  [/台湾|Taiwan|Taipei|\bTW\b/i, "tw"],
  [/美国|United\s*States|America|USA|\bUS\b/i, "us"],
  [/新加坡|Singapore|狮城|\bSG\b/i, "sg"],
  [/韩国|Korea|Seoul|\bKR\b/i, "kr"],
  [/英国|United\s*Kingdom|\bUK\b|\bGB\b|London/i, "gb"],
  [/德国|Germany|Frankfurt|\bDE\b/i, "de"],
  [/法国|France|Paris|\bFR\b/i, "fr"],
  [/加拿大|Canada|\bCA\b/i, "ca"],
  [/澳大利亚|澳洲|Australia|Sydney|\bAU\b/i, "au"],
  [/荷兰|Netherlands|Amsterdam|\bNL\b/i, "nl"],
  [/俄罗斯|Russia|Moscow|\bRU\b/i, "ru"],
  [/印度|India|\bIN\b/i, "in"],
  [/马来西亚|Malaysia|\bMY\b/i, "my"],
  [/土耳其|Turkey|\bTR\b/i, "tr"],
  [/巴西|Brazil|\bBR\b/i, "br"],
  [/阿根廷|Argentina|\bAR\b/i, "ar"],
  [/菲律宾|Philippines|\bPH\b/i, "ph"],
  [/泰国|Thailand|\bTH\b/i, "th"],
  [/越南|Vietnam|\bVN\b/i, "vn"],
];

/**
 * 读取节点名称自带的旗帜 emoji（XBond 订阅的节点名前缀即旗帜）；
 * 若无 emoji 则根据前缀或常见地区名称智能推断。
 */
export function nodeFlagCode(name: string): string | null {
  if (!name) return null;
  const match = name.match(REGIONAL_INDICATOR_PAIR);
  if (match) {
    const cp1 = match[0].codePointAt(0) ?? 0;
    const cp2 = match[0].codePointAt(2) ?? 0;
    const char1 = String.fromCharCode(cp1 - 0x1f1e6 + 65);
    const char2 = String.fromCharCode(cp2 - 0x1f1e6 + 65);
    return `${char1}${char2}`.toLowerCase();
  }

  const leading = name.match(/^([A-Za-z]{2})[\s-]+/);
  if (leading) {
    return leading[1].toLowerCase();
  }

  for (const [pattern, code] of COUNTRY_NAME_MAP) {
    if (pattern.test(name)) return code;
  }

  return null;
}

/** 去掉名称自带的旗帜 emoji，用于旗帜已单独展示的场合，避免重复。 */
export function stripFlagEmoji(name: string): string {
  return name ? name.replace(REGIONAL_INDICATOR_PAIR, "").trim() : name;
}

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
      <span className="inline-flex max-w-full min-w-0 items-center align-middle">
        {before && <span className="mr-1 shrink-0">{before} </span>}
        <CountryFlag code={countryCode} />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {after || name}
        </span>
      </span>
    );
  }

  // 2. Check for leading 2-letter country code (e.g. "JP 日本" or "HK 香港")
  const matchLeading = name.match(/^([A-Za-z]{2})[\s-]+(.+)$/);
  if (matchLeading) {
    const candidate = matchLeading[1].toLowerCase();
    return (
      <span className="inline-flex max-w-full min-w-0 items-center align-middle">
        <CountryFlag code={candidate} />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {matchLeading[2]}
        </span>
      </span>
    );
  }

  return name;
}
