export const segmentedTrack =
  // flex-wrap：连接页设备筛选可达几十段，nowrap 会把超出的段裁掉，
  // 换行让每一段都可达且可点。
  "inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl bg-inset/70 dark:bg-muted/40 p-1 border border-border/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] backdrop-blur-xs select-none";

export const segmentedItem =
  "relative inline-flex min-h-7 min-w-0 max-w-full items-center justify-center rounded-lg px-3 py-1 text-xs xl:text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:text-foreground hover:bg-card/40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 max-md:min-h-10 optical-center";
