import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The @theme type scale is font-size only (no paired line-height), so it gets
// its own class group: it must beat built-in text-sm/text-xs when both are
// present, but it must never evict leading-* the way Tailwind's own font-size
// utilities do (they carry a line-height).
const twMerge = extendTailwindMerge<"custom-font-size">({
  extend: {
    classGroups: {
      "custom-font-size": [
        {
          text: [
            "label",
            "body",
            "subtitle",
            "title",
            "metric",
            "headline",
            "display",
          ],
        },
      ],
    },
    conflictingClassGroups: {
      "font-size": ["custom-font-size"],
      "custom-font-size": ["font-size"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
