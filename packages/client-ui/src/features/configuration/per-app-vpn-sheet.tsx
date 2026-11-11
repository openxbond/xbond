import type { TFunction } from "i18next";
import { Search, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SegmentedControl } from "@/components/segmented-control";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getSplitTunnelConfig,
  listInstalledApps,
  setSplitTunnelConfig,
  type InstalledApp,
  type SplitTunnelMode,
} from "@/platform/android-bridge";

/**
 * 分應用代理（Per-App VPN）抽屜：三檔模式（全部應用 / 繞過選中 / 僅代理選中）、
 * 應用搜索與系統應用過濾。勾選即存（防抖寫入 SharedPreferences），VPN 運行中
 * 由原生側自動平滑重建隧道，無需手動重連。僅在 Android 宿主掛載。
 */
export function PerAppVpnSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(sheetOpen) => {
        if (!sheetOpen) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="flex h-[85dvh] flex-col rounded-t-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+12px)]"
      >
        {/* 面板只在打開時掛載：橋接配置在掛載瞬間讀一次，天然是初始值。 */}
        {open && <PerAppVpnPanel />}
      </SheetContent>
    </Sheet>
  );
}

function PerAppVpnPanel() {
  const { t } = useTranslation("configuration");
  const { t: common } = useTranslation("common");
  const [mode, setMode] = useState<SplitTunnelMode>("all");
  const [packages, setPackages] = useState<Set<string>>(new Set());
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [saveTimer, setSaveTimer] = useState<number | null>(null);

  // 面板打開時掛載：橋接配置異步讀入，到達前保持「全部應用」初值。
  useEffect(() => {
    let cancelled = false;
    void getSplitTunnelConfig().then((config) => {
      if (cancelled) return;
      setMode(config.mode);
      setPackages(new Set(config.packages));
    });
    void listInstalledApps().then((list) => {
      if (!cancelled) setApps(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 勾選即存：防抖 800ms 合併連續點擊，一次寫盤一次隧道重建。
  function persist(nextMode: SplitTunnelMode, nextPackages: Set<string>) {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    const timer = window.setTimeout(() => {
      void setSplitTunnelConfig({
        mode: nextMode,
        packages: [...nextPackages],
      }).then((ok) => {
        if (!ok) toast.error(t("perAppVpn.saveFailed"), { duration: 6000 });
      });
    }, 800);
    setSaveTimer(timer);
  }

  function togglePackage(pkg: string) {
    setPackages((previous) => {
      const next = new Set(previous);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      persist(mode, next);
      return next;
    });
  }

  function switchMode(nextMode: SplitTunnelMode) {
    setMode(nextMode);
    persist(nextMode, packages);
  }

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    return apps.filter(
      (app) =>
        (showSystem || !app.isSystem) &&
        (!q ||
          app.label.toLowerCase().includes(q) ||
          app.packageName.toLowerCase().includes(q)),
    );
  }, [apps, query, showSystem]);

  // 已選應用置頂，勾選狀態一眼可見。
  const ordered = useMemo(() => {
    const selected = filtered.filter((app) => packages.has(app.packageName));
    const rest = filtered.filter((app) => !packages.has(app.packageName));
    return [...selected, ...rest];
  }, [filtered, packages]);

  const modeSummary = perAppVpnSummary(t, mode, packages.size);

  return (
    <>
      <div className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-border" />
      <SheetTitle className="text-base font-semibold text-foreground">
        {t("perAppVpn.title")}
      </SheetTitle>
      <p className="pb-2 text-xs text-muted-foreground">
        {t("perAppVpn.description")}
      </p>

      <SegmentedControl
        ariaLabel={t("perAppVpn.title")}
        value={mode}
        className="grid w-full grid-cols-3"
        onChange={(value) => switchMode(value as SplitTunnelMode)}
        options={[
          { value: "all", label: t("perAppVpn.modeAll") },
          { value: "disallow", label: t("perAppVpn.modeDisallow") },
          { value: "allow", label: t("perAppVpn.modeAllow") },
        ]}
      />
      <p className="pt-1.5 text-[11px] text-muted-foreground">
        {mode === "disallow"
          ? t("perAppVpn.modeDisallowDesc")
          : mode === "allow"
            ? t("perAppVpn.modeAllowDesc")
            : t("perAppVpn.modeAllDesc")}
      </p>

      <div className="flex items-center gap-2 pt-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60"
          />
          <input
            className="h-10 w-full rounded-xl border border-border/80 bg-inset/60 pr-3 pl-8 text-sm text-foreground placeholder:text-muted-foreground/50 hover:border-brand/40 focus:border-brand focus:bg-card focus:outline-none"
            value={query}
            placeholder={t("perAppVpn.searchApps")}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("perAppVpn.searchApps")}
          />
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            size="sm"
            checked={showSystem}
            onCheckedChange={setShowSystem}
            aria-label={t("perAppVpn.showSystem")}
          />
          {t("perAppVpn.showSystem")}
        </label>
      </div>

      <div className="mt-2 -mx-1 min-h-0 flex-1 overflow-y-auto">
        {apps === null ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {common("loading")}
          </p>
        ) : ordered.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {common("empty")}
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-1 p-0">
            {ordered.map((app) => {
              const checked = packages.has(app.packageName);
              return (
                <li key={app.packageName}>
                  <label
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-1.5 transition-colors",
                      checked
                        ? "border-brand/40 bg-brand-soft/50"
                        : "border-transparent hover:bg-inset/60",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => togglePackage(app.packageName)}
                      aria-label={app.label}
                    />
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-inset text-muted-foreground">
                      <Smartphone className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {app.label}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {app.packageName}
                      </span>
                    </span>
                    {app.isSystem && (
                      <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t("perAppVpn.systemBadge")}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="shrink-0 pt-2 text-center text-[11px] text-muted-foreground">
        {modeSummary}
      </p>
    </>
  );
}

/** 配置頁行尾的狀態摘要（全部應用 / 繞過 N 個 / 僅代理 N 個）。 */
export function perAppVpnSummary(
  t: TFunction<"configuration">,
  mode: SplitTunnelMode,
  count: number,
): string {
  switch (mode) {
    case "allow":
      return t("perAppVpn.summaryAllow", { number: count });
    case "disallow":
      return count === 0
        ? t("perAppVpn.summaryAll")
        : t("perAppVpn.summaryBypass", { number: count });
    default:
      return t("perAppVpn.summaryAll");
  }
}
