import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * 品牌絲綢極光波形：右上錨定的多層半透明流光緞帶。
 * 採用漸變遮罩消融左緣與下緣，搭配絲綢受光面高光線，呈現柔和立體的極光層次；
 */
export function AuroraWave({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const maskId = `xbond-wave-mask-${uid}`;
  const bottomMaskId = `xbond-wave-bottom-${uid}`;
  const fadeYId = `xbond-wave-fy-${uid}`;
  const fadeXId = `xbond-wave-fx-${uid}`;
  const glowId = `xbond-wave-glow-${uid}`;
  const archId = `xbond-wave-arch-${uid}`;
  const mainFoldId = `xbond-wave-main-${uid}`;
  const subFoldId = `xbond-wave-sub-${uid}`;
  const deepCrestId = `xbond-wave-crest-${uid}`;
  const rimLightId = `xbond-wave-rim-${uid}`;

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-0 end-0 hidden select-none rtl:-scale-x-100 dark:opacity-55 lg:block",
        className,
      )}
      viewBox="0 0 760 320"
      fill="none"
      preserveAspectRatio="xMaxYMin meet"
    >
      <defs>
        {/* 讓左緣淡入畫布 */}
        <linearGradient
          id={fadeXId}
          x1="40"
          y1="0"
          x2="260"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="black" />
          <stop offset="1" stopColor="white" />
        </linearGradient>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="760"
          height="320"
        >
          <rect width="760" height="320" fill={`url(#${fadeXId})`} />
        </mask>

        <linearGradient
          id={fadeYId}
          x1="0"
          y1="175"
          x2="0"
          y2="320"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="white" />
          <stop offset="1" stopColor="black" />
        </linearGradient>
        <mask
          id={bottomMaskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="760"
          height="320"
        >
          <rect width="760" height="320" fill={`url(#${fadeYId})`} />
        </mask>

        {/* 環境暖光底暈 */}
        <radialGradient
          id={glowId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(520 155) rotate(-14) scale(360 165)"
        >
          <stop offset="0" stopColor="#FF9E44" stopOpacity="0.34" />
          <stop offset="0.52" stopColor="#FFC285" stopOpacity="0.18" />
          <stop offset="1" stopColor="#FFE4C4" stopOpacity="0" />
        </radialGradient>

        {/* 上層拱形絲綢帶 */}
        <linearGradient
          id={archId}
          x1="310"
          y1="175"
          x2="735"
          y2="68"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFD4A6" stopOpacity="0" />
          <stop offset="0.32" stopColor="#FFBA7A" stopOpacity="0.42" />
          <stop offset="0.68" stopColor="#FF9848" stopOpacity="0.68" />
          <stop offset="1" stopColor="#FFD1A1" stopOpacity="0.28" />
        </linearGradient>

        {/* 主折疊流光緞帶（中間 S 形高飽和暖橙） */}
        <linearGradient
          id={mainFoldId}
          x1="160"
          y1="230"
          x2="740"
          y2="165"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFD8B0" stopOpacity="0" />
          <stop offset="0.24" stopColor="#FFB878" stopOpacity="0.45" />
          <stop offset="0.52" stopColor="#F9842C" stopOpacity="0.88" />
          <stop offset="0.78" stopColor="#F5761A" stopOpacity="0.92" />
          <stop offset="1" stopColor="#FFA352" stopOpacity="0.75" />
        </linearGradient>

        {/* 核心摺疊暗部立體層 */}
        <linearGradient
          id={deepCrestId}
          x1="330"
          y1="138"
          x2="650"
          y2="225"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#F36E12" stopOpacity="0.1" />
          <stop offset="0.45" stopColor="#EB6209" stopOpacity="0.72" />
          <stop offset="0.85" stopColor="#F58328" stopOpacity="0.58" />
          <stop offset="1" stopColor="#FFAE62" stopOpacity="0.15" />
        </linearGradient>

        {/* 左下柔和次級薄紗 */}
        <linearGradient
          id={subFoldId}
          x1="90"
          y1="265"
          x2="580"
          y2="190"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFE2C4" stopOpacity="0" />
          <stop offset="0.38" stopColor="#FFC188" stopOpacity="0.48" />
          <stop offset="0.75" stopColor="#FFA052" stopOpacity="0.42" />
          <stop offset="1" stopColor="#FFD6AD" stopOpacity="0" />
        </linearGradient>

        {/* 絲綢邊緣受光高光線 */}
        <linearGradient
          id={rimLightId}
          x1="140"
          y1="220"
          x2="755"
          y2="95"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFF8F0" stopOpacity="0" />
          <stop offset="0.28" stopColor="#FFF8F0" stopOpacity="0.78" />
          <stop offset="0.62" stopColor="#FFFDF9" stopOpacity="0.92" />
          <stop offset="0.88" stopColor="#FFE8CE" stopOpacity="0.75" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.3" />
        </linearGradient>
      </defs>

      <g mask={`url(#${bottomMaskId})`}>
        <g mask={`url(#${maskId})`}>
          {/* 1. 柔和環境底暈 */}
          <ellipse
            cx="510"
            cy="165"
            rx="370"
            ry="150"
            fill={`url(#${glowId})`}
          />

          {/* 2. 左下延伸薄紗層 */}
          <path
            d="M 70 280 C 155 245, 225 156, 335 162 C 435 168, 495 242, 615 248 C 675 251, 725 228, 760 205 L 760 305 L 70 305 Z"
            fill={`url(#${subFoldId})`}
          />

          {/* 3. 上層高拱絲綢帶 */}
          <path
            d="M 290 205 C 375 148, 455 44, 575 46 C 655 47, 715 86, 760 116 L 760 218 C 700 204, 645 142, 555 132 C 455 120, 375 176, 290 205 Z"
            fill={`url(#${archId})`}
          />

          {/* 4. 主 S 形流光緞帶 */}
          <path
            d="M 135 268 C 225 235, 305 130, 415 134 C 515 138, 575 224, 675 216 C 712 213, 738 196, 760 178 L 760 258 C 705 274, 625 276, 535 245 C 445 214, 385 184, 305 204 C 235 221, 185 252, 135 268 Z"
            fill={`url(#${mainFoldId})`}
          />

          {/* 5. 核心交疊深橙立體褶皺 */}
          <path
            d="M 320 156 C 375 128, 442 132, 515 168 C 582 201, 642 222, 712 204 C 732 199, 748 190, 760 180 L 760 226 C 712 246, 638 242, 558 212 C 472 180, 398 148, 320 156 Z"
            fill={`url(#${deepCrestId})`}
          />

          {/* 6. 絲綢受光面高光描邊（營造晶瑩薄紗邊緣） */}
          <path
            d="M 295 202 C 378 146, 456 45, 575 46 C 655 47, 715 86, 760 116"
            stroke={`url(#${rimLightId})`}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M 138 266 C 226 233, 306 130, 415 134 C 515 138, 575 224, 675 216 C 712 213, 738 196, 760 178"
            stroke={`url(#${rimLightId})`}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M 105 274 C 178 240, 240 162, 342 166 C 436 170, 502 240, 620 246"
            stroke={`url(#${rimLightId})`}
            strokeWidth="1.2"
            strokeOpacity="0.65"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
