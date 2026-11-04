import "@fontsource-variable/inter";
import "@xbond/client-ui/styles.css";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  ButtonSelect,
  Switch,
  XBondIcon,
  QuotaRing,
  EmptyState,
  StrategyDirectory,
  StrategyPath,
  StrategyChoice,
  renderNodeTitle,
} from "@xbond/client-ui/components";
import { setAppLanguage } from "@xbond/client-ui/locale";
import { cn } from "@xbond/client-ui/utils";
import { formatTraffic } from "@xbond/client/helper";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type {
  ExtensionSnapshot,
  Preferences,
  RoutingMode,
} from "../shared/control.ts";
import type { WebsiteOverride } from "../shared/routing.ts";
import {
  useController,
  openManagement,
  exportLog,
  type Controller,
} from "./controller.ts";
import { language, translator, type TextKey } from "./locale.ts";

const pages = [
  "home",
  "nodes",
  "account",
  "rules",
  "requests",
  "logs",
  "diagnostics",
  "settings",
] as const;
type Page = (typeof pages)[number];
type T = ReturnType<typeof translator>;
interface Context {
  model: ExtensionSnapshot;
  controller: Controller;
  t: T;
  navigate: (page: Page, group?: string) => void;
}
declare const __XBOND_API_ORIGIN__: string;
const popup = document.body.dataset.surface === "popup";

// Former ext-* SCSS recipes, inlined where they apply. Inputs land on 10px
// radii (rounded-md) per the migrated dashboard Input, not the legacy 7px.
const fieldClass =
  "min-w-0 rounded-md border border-input bg-inset px-[11px] py-[9px] text-foreground caret-brand";
const mutedText = "text-[12px] text-muted-foreground";
const linkButton =
  "inline-flex min-h-8 cursor-pointer items-center border-0 bg-transparent p-0 text-start text-[12px] text-brand-text hover:underline hover:underline-offset-[3px]";
const actionsClass = "mt-4 flex flex-wrap items-center gap-[9px]";
const badgeClass =
  "inline-flex rounded bg-inset px-1.5 py-0.5 text-[11px] whitespace-nowrap max-[700px]:max-w-[110px] max-[700px]:whitespace-normal";
const settingRow =
  "flex items-center justify-between gap-6 border-b border-b-border py-5 text-[13px] last:border-0 max-[700px]:gap-3";
const brandClass =
  "flex items-center gap-[9px] whitespace-nowrap text-[21px] font-[650]";
const warningBox =
  "rounded-lg bg-[color-mix(in_oklab,var(--warning)_12%,var(--card))] px-4 py-3.5 text-[13px] text-warning-text";
const tableBox =
  "overflow-auto rounded-[10px] border border-border [&_td]:border-b [&_td]:border-b-border [&_td]:px-[13px] [&_td]:py-3 [&_td]:text-start [&_td]:align-top [&_td]:[overflow-wrap:anywhere] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-b-border [&_th]:bg-inset [&_th]:px-[13px] [&_th]:py-3 [&_th]:text-start [&_th]:text-[12px] [&_th]:font-medium [&_th]:text-muted-foreground [&_tbody_tr:last-child_td]:border-b-0";

function route(): Page {
  const value = location.hash.slice(1).split("?")[0];
  return pages.find((page) => page === value) ?? "home";
}
function date(value: number | null | undefined, locale: string) {
  return value && Number.isFinite(value)
    ? new Intl.DateTimeFormat(locale.replace("_", "-"), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value)
    : "—";
}
function status(model: ExtensionSnapshot, t: T): string {
  if (model.pendingLogin) return t("waiting");
  if (!model.signedIn) return t("signIn");
  if (model.state.kind === "control-lost") return t("controlLost");
  if (model.state.kind === "auth-failed") return t("authFailed");
  if (model.state.kind === "unreachable") return t("unreachable");
  if (model.state.kind === "error") return t("failed");
  if (!model.config.available) return t("config");
  if (model.mode === "direct") return t("follow");
  return t(model.enabled && model.state.kind === "ok" ? "on" : "off");
}
function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="mb-5 min-w-0 max-[700px]:p-4">
      <CardHeader className="mb-3.5 flex items-center justify-between max-[700px]:items-start">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function Empty({ context }: { context: Context }) {
  return (
    <EmptyState
      message={context.t("noConfig")}
      action={
        <Button onClick={() => context.navigate("account")}>
          {context.t("account")}
        </Button>
      }
    />
  );
}
function Modes({
  context,
  variant = "row",
}: {
  context: Context;
  variant?: "row" | "rail";
}) {
  const { model, controller, t } = context;
  const disabled =
    controller.pending || !model.signedIn || !model.config.available;
  const options: Array<{ label: string; value: RoutingMode }> = [
    { label: t("rule"), value: "rule" },
    { label: t("global"), value: "global" },
    { label: t("follow"), value: "direct" },
  ];
  if (variant === "rail")
    return (
      <>
        <label
          className="text-[11px] text-muted-foreground"
          htmlFor="ext-routing-mode"
        >
          {t("mode")}
        </label>
        <NativeSelect
          id="ext-routing-mode"
          className={"text-[12px]"}
          value={model.mode}
          disabled={disabled}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === "rule" || mode === "global" || mode === "direct")
              void controller.act({ type: "set-mode", mode });
          }}
        >
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </>
    );
  return (
    <ButtonSelect<RoutingMode>
      value={model.mode}
      disabled={disabled}
      options={options}
      onSelect={(mode) => void controller.act({ type: "set-mode", mode })}
    />
  );
}
function Power({
  context,
  compact = false,
}: {
  context: Context;
  compact?: boolean;
}) {
  const { model, controller, t } = context;
  const on =
    model.state.kind === "ok" && model.enabled && model.mode !== "direct";
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        compact ? "h-[70px] flex-none gap-3.5 px-5" : "flex-1 gap-5",
      )}
    >
      <div>
        <h1
          className={cn(
            "font-semibold leading-[1.35]",
            compact ? "text-[17px]" : "text-[22px]",
          )}
        >
          <span
            className={cn(
              "me-2 inline-block h-[7px] w-[7px] rounded-full align-middle",
              on ? "bg-success-text" : "bg-muted-foreground",
            )}
          />
          {status(model, t)}
        </h1>
        <p
          className={cn(
            "mt-[5px] text-muted-foreground",
            compact
              ? "max-w-[410px] text-[11px] leading-[1.4]"
              : "max-w-[600px] text-[12px]",
          )}
        >
          {model.mode === "direct"
            ? t("inherited")
            : model.state.kind === "ok"
              ? `${t(model.mode === "global" ? "global" : "rule")} · ${t("applied")}`
              : model.state.kind === "off" &&
                  model.signedIn &&
                  model.config.available
                ? t("ready")
                : t("scope")}
        </p>
      </div>
      <Switch
        checked={
          model.enabled && model.state.kind === "ok" && model.mode !== "direct"
        }
        disabled={
          controller.pending ||
          !model.signedIn ||
          !model.config.available ||
          model.state.kind === "control-lost"
        }
        aria-label={t("enable")}
        onCheckedChange={(enabled) =>
          void controller.act({ type: "set-enabled", enabled })
        }
      />
    </div>
  );
}
function ConfigurationNotice({
  context,
  compact = false,
}: {
  context: Context;
  compact?: boolean;
}) {
  const { model, controller, t } = context;
  if (model.pendingLogin || !model.signedIn)
    return <Login context={context} compact={compact} />;
  if (!model.config.available)
    return (
      <EmptyState
        message={t("noConfig")}
        action={
          <Button
            onClick={() => void controller.act({ type: "refresh-config" })}
            disabled={controller.pending}
          >
            {t("refresh")}
          </Button>
        }
      />
    );
  if (model.state.kind === "control-lost")
    return (
      <div
        className={cn(
          "rounded-[10px] bg-inset px-6 py-[30px]",
          compact && "bg-transparent px-0 py-[18px]",
        )}
      >
        <h2 className="text-[17px] font-semibold">{t("controlLost")}</h2>
        <p className="mb-[18px] mt-3 text-[13px] text-muted-foreground">
          {t(model.state.holder === "policy" ? "policy" : "otherExtension")}
        </p>
        <Button
          onClick={() => void controller.act({ type: "reconcile" })}
          disabled={controller.pending}
        >
          {t("retry")}
        </Button>
      </div>
    );
  return null;
}
function Login({
  context,
  compact = false,
}: {
  context: Context;
  compact?: boolean;
}) {
  const { model, controller, t } = context;
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!model.pendingLogin) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [model.pendingLogin]);
  const pending = model.pendingLogin;
  return (
    <div className={cn("max-w-[650px]", compact ? "py-[23px]" : "py-7")}>
      <h2
        className={cn("font-semibold", compact ? "text-[20px]" : "text-[17px]")}
      >
        {pending
          ? t("waiting")
          : model.loginEnded === "expired"
            ? t("loginExpired")
            : model.loginEnded === "failed"
              ? t("loginFailed")
              : t("signIn")}
      </h2>
      <p className="my-3 text-[13px] text-muted-foreground">{t("loginHint")}</p>
      {pending && (
        <>
          <p
            className="my-3 select-all rounded-[9px] bg-inset p-4 text-center font-mono text-[27px] tracking-[0.12em] text-foreground"
            aria-label={t("deviceCode")}
          >
            {pending.userCode}
          </p>
          <p className="my-3 text-[13px] text-muted-foreground">
            {t("expiresIn")}:{" "}
            {Math.max(0, Math.ceil((pending.expiresAt - now) / 1000))} s
          </p>
        </>
      )}
      <div className={actionsClass}>
        {pending ? (
          <>
            <Button
              variant="brand"
              disabled={controller.pending}
              onClick={() =>
                chrome.tabs.create({ url: pending.verificationUri })
              }
            >
              {t("verify")}
            </Button>
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(pending.userCode)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {t(copied ? "copied" : "copy")}
            </Button>
            <Button
              disabled={controller.pending}
              onClick={() => void controller.act({ type: "login-cancel" })}
            >
              {t("cancel")}
            </Button>
          </>
        ) : (
          <Button
            variant="brand"
            disabled={controller.pending}
            onClick={() => {
              if (popup) openManagement("account");
              else void controller.act({ type: "login-start" });
            }}
          >
            {t("signIn")}
          </Button>
        )}
      </div>
    </div>
  );
}
function Quota({
  context,
  compact = false,
}: {
  context: Context;
  compact?: boolean;
}) {
  const { model, t } = context;
  const quota = model.quota;
  if (!quota) return <p className={mutedText}>{t("quotaUnknown")}</p>;
  const used = quota.uploadBytes + quota.downloadBytes;
  const remaining = Math.max(0, quota.totalBytes - used);
  return (
    <div className={compact ? "block" : "flex items-center gap-5 py-[18px]"}>
      {!compact && quota.totalBytes > 0 && (
        <QuotaRing percent={(remaining / quota.totalBytes) * 100} />
      )}
      <div>
        <p className={compact ? "text-[12px] leading-[1.4]" : undefined}>
          {t("remaining")}{" "}
          <strong
            className={cn(
              "font-semibold tabular-nums",
              compact ? "text-[13px]" : "text-[20px]",
            )}
          >
            {formatTraffic(remaining)}
          </strong>{" "}
          <span className={mutedText}>/ {formatTraffic(quota.totalBytes)}</span>
        </p>
        {!compact && (
          <p className={cn(mutedText, "mt-[7px]")}>
            {t("used")}: {formatTraffic(used)}
          </p>
        )}
        <p
          className={cn(
            mutedText,
            compact ? "mt-[5px] leading-[1.4]" : "mt-[7px]",
          )}
        >
          {t("expiry")}:{" "}
          {quota.expiresAt > 0
            ? date(quota.expiresAt * 1000, language(model.preferences.language))
            : "—"}
        </p>
      </div>
    </div>
  );
}
function Nodes({
  context,
  compact = false,
  rail,
}: {
  context: Context;
  compact?: boolean;
  rail?: ReactNode;
}) {
  const { model, controller, t } = context;
  const initial =
    new URLSearchParams(location.hash.split("?")[1]).get("group") ??
    model.preferences.focusedGroup;
  const [focus, setFocus] = useState(initial);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("default");
  const group =
    model.groups.find((item) => item.name === focus) ??
    model.groups.find((item) => item.name === model.final) ??
    model.groups[0];
  if (!model.config.available) return <Empty context={context} />;
  const global = model.mode === "global";
  const names = global
    ? [
        ...model.groups.map((item) => item.name),
        ...model.nodes.map((item) => item.name),
        "DIRECT",
        "REJECT",
      ]
    : (group?.members ?? []);
  const unique = [...new Set(names)].filter((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
  if (sort === "name") unique.sort((a, b) => a.localeCompare(b));
  const selected = global ? model.globalExit : group?.selected;
  const focusGroup = (name: string) => {
    setFocus(name);
    setQuery("");
    void controller.act({
      type: "set-preferences",
      preferences: { ...model.preferences, focusedGroup: name },
    });
  };
  const select = (name: string) =>
    void controller.act(
      global
        ? { type: "set-global-exit", target: name }
        : { type: "set-selection", group: group.name, member: name },
    );
  const detail = (name: string) =>
    name === "DIRECT"
      ? t("direct")
      : name === "REJECT"
        ? t("reject")
        : model.groups.some((item) => item.name === name)
          ? t("group")
          : t("untested");
  // has-rail：左栏承载模式控件（弹窗），组目录叠在其下；全局模式无目录。
  // 弹窗压平为固定 300px 高的行内工作区，管理页保持 220px 目录 + 成员两栏。
  const workspace = cn(
    "grid min-h-[340px] overflow-hidden",
    popup
      ? "h-[300px] min-h-0 flex-1 rounded-none border-y border-border"
      : "h-[min(68dvh,660px)] rounded-[12px] border border-border",
    rail
      ? global
        ? "grid-cols-[154px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] [grid-template-areas:'modes_members']"
        : "grid-cols-[154px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] [grid-template-areas:'modes_members''groups_members']"
      : global
        ? "grid-cols-1"
        : "grid-cols-[220px_minmax(0,1fr)]",
  );
  const railModes = cn(
    "grid content-start gap-1.5 border-e border-border bg-background [grid-area:modes]",
    popup ? "px-[7px] py-2" : "border-b p-2.5",
  );
  const members = cn(
    "flex min-h-0 flex-col overflow-hidden",
    popup ? "px-[15px] pb-0 pt-3" : "p-5",
  );
  if (model.mode === "direct")
    return rail ? (
      <div className={workspace}>
        <div className={railModes}>{rail}</div>
        <section className={cn(members, "[grid-area:members]")}>
          <h2
            className={cn(
              "font-semibold",
              popup ? "text-[13px]" : "text-[17px]",
            )}
          >
            {t("follow")}
          </h2>
          <p>{t("inherited")}</p>
          <p className={mutedText}>{t("differentExits")}</p>
        </section>
      </div>
    ) : (
      <div className="rounded-[10px] bg-inset px-6 py-[30px]">
        <h2 className="text-[17px] font-semibold">{t("follow")}</h2>
        <p className="mb-[18px] mt-3 text-[13px] text-muted-foreground">
          {t("inherited")}
        </p>
        <p className="mb-[18px] mt-3 text-[13px] text-muted-foreground">
          {t("differentExits")}
        </p>
      </div>
    );
  return (
    <div className={workspace}>
      {rail && <div className={railModes}>{rail}</div>}
      {!global && (
        <StrategyDirectory
          className={cn("max-md:flex", rail && "[grid-area:groups]")}
          label={t("groups")}
          items={model.groups.map((item) => ({
            name: item.name,
            detail: item.selected,
            count: item.members.length,
            kind: compact ? undefined : item.type,
          }))}
          value={group?.name ?? ""}
          onSelect={focusGroup}
        />
      )}
      <section className={cn(members, rail && "[grid-area:members]")}>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2
            className={cn(
              "font-semibold",
              popup ? "text-[13px]" : "text-[17px]",
            )}
          >
            {global ? t("globalExit") : (group?.name ?? t("nodes"))}
          </h2>
          <span className={mutedText}>{unique.length}</span>
        </div>
        <div
          className={cn(
            "text-[12px] text-muted-foreground",
            popup
              ? "mb-1 truncate leading-[1.5]"
              : "border-b border-b-border pb-3.5",
          )}
        >
          <StrategyPath
            path={global ? model.globalPath : (group?.path ?? [])}
          />
        </div>
        <div className={cn("flex gap-2.5", popup ? "mb-1 mt-[7px]" : "my-3.5")}>
          <Input
            aria-label={t("search")}
            type="search"
            placeholder={t("search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={
              popup
                ? "min-w-0 w-full flex-1 rounded-md border border-input bg-inset px-[10px] py-[7px] text-[12px] text-foreground caret-brand"
                : cn(fieldClass, "w-full flex-1")
            }
          />
          {!compact && (
            <NativeSelect
              aria-label={t("sort")}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className={cn(fieldClass, "max-w-[110px] text-[12px]")}
            >
              <NativeSelectOption value="default">
                {t("source")}
              </NativeSelectOption>
              <NativeSelectOption value="name">A → Z</NativeSelectOption>
            </NativeSelect>
          )}
        </div>
        <ul
          className={
            popup
              ? "flex min-h-0 flex-[1_1_0] flex-col overflow-auto"
              : "grid min-h-0 flex-1 content-start gap-2.5 overflow-auto [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))] max-[1000px]:[grid-template-columns:repeat(auto-fill,minmax(190px,1fr))] max-[700px]:grid-cols-1"
          }
        >
          {unique.map((name) => (
            <StrategyChoice
              key={name}
              name={name}
              selected={name === selected}
              disabled={
                controller.pending || (!global && group?.type !== "select")
              }
              onSelect={() => select(name)}
              detail={compact || global ? detail(name) : undefined}
            >
              {!compact && (
                <Badge variant="secondary" className={badgeClass}>
                  {detail(name)}
                </Badge>
              )}
            </StrategyChoice>
          ))}
        </ul>
        {unique.length === 0 && <EmptyState message={t("noNodes")} />}{" "}
        {!compact && (
          <p className={cn(mutedText, "pt-3.5")}>
            {group?.type === "urltest" ? t("testPending") : t("differentExits")}
          </p>
        )}
      </section>
    </div>
  );
}
function Home({ context }: { context: Context }) {
  const { model, controller, t, navigate } = context;
  return (
    <>
      <div className="flex items-center justify-between gap-[25px] border-b border-b-border pb-7 pt-[15px] max-[1000px]:flex-wrap">
        <Power context={context} />
        <Modes context={context} />
      </div>
      <ConfigurationNotice context={context} />
      {model.signedIn && model.config.available && (
        <div className="mt-6 grid grid-cols-2 gap-5 [&>*]:mb-0 max-[1000px]:grid-cols-1">
          <Panel
            title={t("groups")}
            action={
              <button className={linkButton} onClick={() => navigate("nodes")}>
                {t("allGroups")}
              </button>
            }
          >
            {model.groups.slice(0, 4).map((group) => (
              <button
                className="block w-full cursor-pointer border-0 border-b border-b-border bg-transparent p-0 py-3.5 text-start text-foreground"
                key={group.name}
                onClick={() => navigate("nodes", group.name)}
              >
                <strong className="mb-[5px] block text-[13px] font-[550]">
                  {renderNodeTitle(group.name)}
                </strong>
                <span className="text-[12px] text-muted-foreground">
                  <StrategyPath path={group.path.slice(1)} />
                </span>
              </button>
            ))}
          </Panel>
          <Panel title={t("remaining")}>
            <Quota context={context} />
          </Panel>
          <Panel title={t("config")}>
            <p>XBond Cloud</p>
            <p className={cn(mutedText, "mt-2")}>
              {t("updated")}:{" "}
              {date(
                model.config.updatedAt,
                language(model.preferences.language),
              )}
            </p>
            {model.config.error && (
              <p className={cn(warningBox, "mb-[18px] mt-2")}>
                {t("updateFailed")}
              </p>
            )}
            <Button
              className="mt-3.5"
              onClick={() => void controller.act({ type: "refresh-config" })}
              disabled={controller.pending}
            >
              {t("refresh")}
            </Button>
          </Panel>
          <Panel title={t("diagnostics")}>
            <p>
              {t("untested")}: {t("connectivity")}
            </p>
            <div className={actionsClass}>
              <Button onClick={() => navigate("rules")}>{t("predict")}</Button>
              <Button onClick={() => navigate("diagnostics")}>
                {t("test")}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
function Account({ context }: { context: Context }) {
  const { model, controller, t } = context;
  if (!model.signedIn || model.pendingLogin) return <Login context={context} />;
  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-5 [&>*]:mb-0 max-[1000px]:grid-cols-1">
        <Panel title="XBond Cloud">
          <Quota context={context} />
          <div className={actionsClass}>
            <Button
              onClick={() =>
                chrome.tabs.create({
                  url: new URL("/dash", __XBOND_API_ORIGIN__).href,
                })
              }
            >
              {t("cloud")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void controller.act({ type: "logout" })}
              disabled={controller.pending}
            >
              {t("signOut")}
            </Button>
          </div>
        </Panel>
        <Panel title={t("config")}>
          <dl className="text-[13px]">
            <dt className="text-muted-foreground">{t("source")}</dt>
            <dd className="mb-[17px] mt-1.5">XBond Cloud</dd>
            <dt className="text-muted-foreground">{t("updated")}</dt>
            <dd className="mb-[17px] mt-1.5">
              {date(
                model.config.updatedAt,
                language(model.preferences.language),
              )}
            </dd>
            <dt className="text-muted-foreground">{t("result")}</dt>
            <dd className="mb-[17px] mt-1.5">
              {model.config.available ? t("applied") : t("noConfig")}
            </dd>
          </dl>
          <Button
            variant="brand"
            className="mt-3.5"
            disabled={controller.pending}
            onClick={() => void controller.act({ type: "refresh-config" })}
          >
            {t("refresh")}
          </Button>
        </Panel>
      </div>
      {model.config.error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{t("updateFailed")}</AlertTitle>
          <AlertDescription>
            <details className="min-w-0">
              <summary>{t("details")}</summary>
              <pre className="whitespace-pre-wrap wrap-anywhere">
                {model.config.error}
              </pre>
            </details>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
function RuleTable({ rules, t }: { rules: ExtensionSnapshot["rules"]; t: T }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = rules.filter((rule) =>
    `${rule.condition} ${rule.payload} ${rule.target}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          className={cn(fieldClass, "max-w-[400px] flex-1")}
        />
        <span className={mutedText}>{filtered.length}</span>
      </div>
      <div className={tableBox}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th>{t("condition")}</th>
              <th>{t("domain")}</th>
              <th>{t("target")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(page * 100, (page + 1) * 100).map((rule, index) => (
              <tr key={`${index}:${rule.payload}`}>
                <td>{rule.condition}</td>
                <td>{rule.payload}</td>
                <td>{renderNodeTitle(rule.target)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <EmptyState message={t("noRules")} />}
      <div className="mt-3.5 flex items-center justify-end gap-3 text-[12px]">
        <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ←
        </Button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(filtered.length / 100))}
        </span>
        <Button
          disabled={(page + 1) * 100 >= filtered.length}
          onClick={() => setPage((p) => p + 1)}
        >
          →
        </Button>
      </div>
    </>
  );
}
function Rules({ context }: { context: Context }) {
  const { model, controller, t } = context;
  const [editing, setEditing] = useState<WebsiteOverride | null>(null);
  const [domain, setDomain] = useState("");
  const [match, setMatch] = useState<"exact" | "suffix">("exact");
  const [target, setTarget] = useState("");
  const [host, setHost] = useState(
    new URLSearchParams(location.hash.split("?")[1]).get("host") ?? "",
  );
  if (!model.config.available) return <Empty context={context} />;
  const targets = [
    ...model.groups.map((item) => item.name),
    ...model.nodes.map((item) => item.name),
    "DIRECT",
    "REJECT",
  ];
  const edit = (rule: WebsiteOverride) => {
    setEditing(rule);
    setDomain(rule.domain);
    setMatch(rule.match);
    setTarget(rule.target);
  };
  const save = async () => {
    const ok = await controller.act({
      type: "save-override",
      override: {
        id: editing?.id ?? crypto.randomUUID(),
        domain,
        match,
        target: target || targets[0] || "DIRECT",
        enabled: editing?.enabled ?? true,
      },
    });
    if (ok) {
      setEditing(null);
      setDomain("");
    }
  };
  return (
    <>
      <p className="mb-[18px] rounded-lg bg-inset px-4 py-3.5 text-[13px]">
        {t("exceptionHint")}
      </p>
      <Panel title={t("exceptions")}>
        <div className={tableBox}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th>{t("domain")}</th>
                <th>{t("match")}</th>
                <th>{t("target")}</th>
                <th>{t("result")}</th>
                <th aria-label={t("details")} />
              </tr>
            </thead>
            <tbody>
              {model.overrides.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.domain}</td>
                  <td>{t(rule.match)}</td>
                  <td>{renderNodeTitle(rule.target)}</td>
                  <td>
                    {model.overrideErrors.includes(rule.id) ? (
                      <span className="text-destructive-text">
                        {t("invalidTarget")}
                      </span>
                    ) : (
                      <label className="flex items-center gap-2 whitespace-nowrap">
                        <input
                          type="checkbox"
                          className="accent-brand"
                          aria-label={`${t("enabled")}: ${rule.domain}`}
                          checked={rule.enabled}
                          disabled={controller.pending}
                          onChange={() =>
                            void controller.act({
                              type: "save-override",
                              override: { ...rule, enabled: !rule.enabled },
                            })
                          }
                        />
                        {t(rule.enabled ? "enabled" : "disabled")}
                      </label>
                    )}
                  </td>
                  <td aria-label={`${t("edit")}: ${rule.domain}`}>
                    <div className="flex flex-nowrap items-center gap-[9px]">
                      <Button
                        className="px-[9px] text-[12px]"
                        disabled={controller.pending}
                        onClick={() => edit(rule)}
                      >
                        {t("edit")}
                      </Button>
                      <Button
                        variant="destructive"
                        className="px-[9px] text-[12px]"
                        disabled={controller.pending}
                        onClick={() =>
                          void controller.act({
                            type: "delete-override",
                            id: rule.id,
                          })
                        }
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details key={editing?.id ?? "new"} open={!!editing} className="mt-5">
          <summary className="cursor-pointer text-[13px] font-semibold text-brand-text">
            {t(editing ? "edit" : "add")}
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <FieldGroup className="grid grid-cols-3 gap-3.5 max-[1000px]:grid-cols-2 max-[700px]:grid-cols-1">
              <Field className="gap-2">
                <FieldLabel htmlFor="override-domain">{t("domain")}</FieldLabel>
                <Input
                  id="override-domain"
                  required
                  value={domain}
                  placeholder="docs.example.org"
                  onChange={(event) => setDomain(event.target.value)}
                  className={fieldClass}
                />
              </Field>
              <Field className="gap-2">
                <FieldLabel htmlFor="override-match">{t("match")}</FieldLabel>
                <NativeSelect
                  id="override-match"
                  value={match}
                  onChange={(event) =>
                    setMatch(
                      event.target.value === "suffix" ? "suffix" : "exact",
                    )
                  }
                  className={fieldClass}
                >
                  <NativeSelectOption value="exact">
                    {t("exact")}
                  </NativeSelectOption>
                  <NativeSelectOption value="suffix">
                    {t("suffix")}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field className="gap-2">
                <FieldLabel htmlFor="override-target">{t("target")}</FieldLabel>
                <NativeSelect
                  id="override-target"
                  value={target || targets[0]}
                  onChange={(event) => setTarget(event.target.value)}
                  className={fieldClass}
                >
                  {targets.map((name) => (
                    <NativeSelectOption value={name} key={name}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </FieldGroup>
            <div className={actionsClass}>
              <Button
                type="submit"
                variant="brand"
                disabled={controller.pending}
              >
                {t("save")}
              </Button>
              {editing && (
                <Button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setDomain("");
                  }}
                >
                  {t("cancel")}
                </Button>
              )}
            </div>
          </form>
        </details>
      </Panel>
      <Panel title={t("predict")}>
        <form
          className="mb-5 flex flex-wrap items-center gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.act({ type: "predict-route", host });
          }}
        >
          <Input
            required
            value={host}
            aria-label={t("domain")}
            placeholder="docs.example.org"
            onChange={(event) => setHost(event.target.value)}
            className={cn(fieldClass, "max-w-[400px] flex-1")}
          />
          <Button type="submit" variant="brand" disabled={controller.pending}>
            {t("predict")}
          </Button>
        </form>
        {model.prediction && (
          <div className="mb-3.5 rounded-lg bg-inset p-3.5">
            <strong>{model.prediction.host}</strong>
            <p>{model.prediction.condition}</p>
            <div className="mt-2 text-[13px]">
              <StrategyPath path={model.prediction.path} />
            </div>
          </div>
        )}
        <p className={mutedText}>{t("predictionHint")}</p>
      </Panel>
      <Panel title={t("cloudRules")}>
        <RuleTable rules={model.rules} t={t} />
      </Panel>
    </>
  );
}
function Requests({ context }: { context: Context }) {
  const { model, controller, t } = context;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("all");
  const records = model.requests.filter(
    (record) =>
      (result === "all" || record.status === result) &&
      record.host.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Panel
        title={t(model.recording ? "recordingOn" : "recordingOff")}
        action={
          <Button
            variant={model.recording ? "outline" : "brand"}
            disabled={controller.pending}
            onClick={() =>
              void controller.act({
                type: "set-recording",
                enabled: !model.recording,
              })
            }
          >
            {t(model.recording ? "stop" : "start")}
          </Button>
        }
      >
        <p>{t("privacy")}</p>
      </Panel>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder={t("domain")}
          aria-label={t("domain")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={cn(fieldClass, "max-w-[400px] flex-1")}
        />
        <NativeSelect
          aria-label={t("result")}
          value={result}
          onChange={(event) => setResult(event.target.value)}
          className={fieldClass}
        >
          {["all", "completed", "failed", "pending"].map((key) => (
            <NativeSelectOption value={key} key={key}>
              {t(key as TextKey)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          disabled={controller.pending}
          onClick={() => void controller.act({ type: "clear-requests" })}
        >
          {t("clear")}
        </Button>
      </div>
      <div className={tableBox}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th>{t("time")}</th>
              <th>{t("domain")}</th>
              <th>{t("type")}</th>
              <th>{t("result")}</th>
              <th>{t("duration")}</th>
              <th aria-label={t("details")} />
            </tr>
          </thead>
          <tbody>
            {[...records].reverse().map((record) => (
              <tr key={record.id}>
                <td>{new Date(record.at).toLocaleTimeString()}</td>
                <td>{record.host}</td>
                <td>{record.type}</td>
                <td>
                  <span
                    className={
                      record.status === "failed"
                        ? "text-destructive-text"
                        : undefined
                    }
                  >
                    {t(record.status)}
                  </span>
                  {record.error && (
                    <small className="block max-w-[300px] text-[11px] text-muted-foreground">
                      {record.error}
                    </small>
                  )}
                </td>
                <td>
                  {record.duration === undefined
                    ? "—"
                    : `${Math.round(record.duration)} ms`}
                </td>
                <td>
                  <button
                    className={linkButton}
                    onClick={() => {
                      location.assign(
                        `#rules?host=${encodeURIComponent(record.host)}`,
                      );
                    }}
                  >
                    {t("predict")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length === 0 && (
        <EmptyState message={t("noRequests")} description={t("start")} />
      )}
      <p className={cn(mutedText, "mt-5")}>{t("requestHint")}</p>
    </>
  );
}
function Logs({ context }: { context: Context }) {
  const { model, controller, t } = context;
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const events = model.events.filter(
    (event) =>
      (level === "all" || event.level === level) &&
      event.message.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={cn(fieldClass, "max-w-[400px] flex-1")}
        />
        <NativeSelect
          aria-label={t("level")}
          value={level}
          onChange={(event) => setLevel(event.target.value)}
          className={fieldClass}
        >
          {["all", "info", "warn", "error"].map((key) => (
            <NativeSelectOption value={key} key={key}>
              {t(key as TextKey)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button onClick={() => exportLog(events)}>{t("export")}</Button>
        <Button
          disabled={controller.pending}
          onClick={() => void controller.act({ type: "clear-events" })}
        >
          {t("clear")}
        </Button>
      </div>
      <div className={tableBox}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th>{t("time")}</th>
              <th>{t("level")}</th>
              <th>{t("logs")}</th>
            </tr>
          </thead>
          <tbody>
            {[...events].reverse().map((event, index) => (
              <tr key={`${index}:${event.at}`}>
                <td>{new Date(event.at).toLocaleTimeString()}</td>
                <td>
                  <span
                    className={cn(
                      badgeClass,
                      event.level === "error"
                        ? "text-destructive-text"
                        : event.level === "warn"
                          ? "text-warning-text"
                          : "text-muted-foreground",
                    )}
                  >
                    {t(event.level)}
                  </span>
                </td>
                <td>{event.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length === 0 && <EmptyState message={t("noEvents")} />}
    </>
  );
}
function Diagnostics({ context }: { context: Context }) {
  const { model, controller, t } = context;
  const connectivity = model.connectivity;
  const checks: [
    [TextKey, string],
    [TextKey, string],
    [TextKey, string],
    [TextKey, string],
  ] = [
    ["accountState", model.signedIn ? t("valid") : t("signIn")],
    ["config", model.config.available ? t("valid") : t("noConfig")],
    [
      "control",
      model.control === "controlled_by_this_extension"
        ? t("ourControl")
        : model.control === "controlled_by_other_extensions"
          ? t("otherExtension")
          : model.control === "not_controllable"
            ? t("policy")
            : t("unknown"),
    ],
    [
      "connectivity",
      connectivity.status === "unknown"
        ? t("untested")
        : connectivity.status === "checking"
          ? t("pending")
          : connectivity.status === "ok"
            ? t("completed")
            : t("failed"),
    ],
  ];
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void controller.act({ type: "reconcile" })}
          disabled={controller.pending}
        >
          {t("retry")}
        </Button>
        <Button
          variant="brand"
          onClick={() => void controller.act({ type: "check-connectivity" })}
          disabled={controller.pending || model.state.kind !== "ok"}
        >
          {t("test")}
        </Button>
      </div>
      <Panel title={t("diagnostics")}>
        <dl className="text-[13px]">
          {checks.map(([key, value]) => (
            <div
              className="grid grid-cols-[150px_1fr] gap-5 border-b border-b-border py-[15px] max-[700px]:grid-cols-[110px_1fr] max-[700px]:gap-3"
              key={key}
            >
              <dt className="text-muted-foreground">{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {connectivity.target && (
          <p className={mutedText}>
            {connectivity.target} ·{" "}
            {date(connectivity.at, language(model.preferences.language))}{" "}
            {connectivity.duration !== undefined
              ? `· ${connectivity.duration} ms`
              : ""}
          </p>
        )}
        {connectivity.error && (
          <p className="text-destructive-text">{connectivity.error}</p>
        )}
        <p className={cn(mutedText, connectivity.target && "mt-2")}>
          {t("reachHint")}
        </p>
      </Panel>
      <ConfigurationNotice context={context} />
      <div className={actionsClass}>
        <Button onClick={() => context.navigate("account")}>
          {t("account")}
        </Button>
        <Button onClick={() => context.navigate("nodes")}>{t("nodes")}</Button>
        <Button onClick={() => context.navigate("logs")}>{t("logs")}</Button>
      </div>
    </>
  );
}
function Settings({ context }: { context: Context }) {
  const { model, controller, t } = context;
  const update = (changes: Partial<Preferences>) =>
    void controller.act({
      type: "set-preferences",
      preferences: { ...model.preferences, ...changes },
    });
  return (
    <Panel title={t("settings")}>
      <div className={settingRow}>
        <label htmlFor="theme">{t("theme")}</label>
        <NativeSelect
          id="theme"
          disabled={controller.pending}
          value={model.preferences.theme}
          onChange={(event) => {
            const theme = event.target.value;
            if (theme === "system" || theme === "light" || theme === "dark")
              update({ theme });
          }}
          className={cn(fieldClass, "min-w-[150px] max-[700px]:min-w-[120px]")}
        >
          {["system", "light", "dark"].map((value) => (
            <NativeSelectOption key={value} value={value}>
              {t(value as TextKey)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className={settingRow}>
        <label htmlFor="language">{t("language")}</label>
        <NativeSelect
          id="language"
          disabled={controller.pending}
          value={model.preferences.language}
          onChange={(event) => {
            const value = event.target.value;
            if (
              value === "system" ||
              value === "en_US" ||
              value === "zh_CN" ||
              value === "zh_HK" ||
              value === "ko" ||
              value === "fa"
            )
              update({ language: value });
          }}
          className={cn(fieldClass, "min-w-[150px] max-[700px]:min-w-[120px]")}
        >
          <NativeSelectOption value="system">{t("system")}</NativeSelectOption>
          <NativeSelectOption value="en_US">English</NativeSelectOption>
          <NativeSelectOption value="zh_CN">简体中文</NativeSelectOption>
          <NativeSelectOption value="zh_HK">
            繁體中文（香港）
          </NativeSelectOption>
          <NativeSelectOption value="ko">한국어</NativeSelectOption>
          <NativeSelectOption value="fa">فارسی</NativeSelectOption>
        </NativeSelect>
      </div>
      {(["autoUpdate", "restore"] as const).map((key) => (
        <div className={settingRow} key={key}>
          <span className="max-w-[75%]">{t(key)}</span>
          <Switch
            checked={model.preferences[key]}
            aria-label={t(key)}
            disabled={controller.pending}
            onCheckedChange={(checked) => update({ [key]: checked })}
          />
        </div>
      ))}
      <div className={settingRow}>
        <span className="max-w-[75%]">{t("privacy")}</span>
        <Button onClick={() => context.navigate("requests")}>
          {t("requests")}
        </Button>
      </div>
    </Panel>
  );
}
function Popup({ context }: { context: Context }) {
  const { model, t } = context;
  const unavailable =
    !model.signedIn ||
    !!model.pendingLogin ||
    !model.config.available ||
    model.state.kind === "control-lost";
  return (
    <div className="flex h-[568px] flex-col bg-card [&_[data-slot=button]]:min-h-9 [&_[data-slot=button]]:text-[12px]">
      <header className="flex h-[52px] flex-none items-center justify-between border-b border-b-border px-5">
        <div className={cn(brandClass, "gap-[7px] text-[18px]")}>
          <XBondIcon className="h-[25px] w-[23px]" />
          XBond
        </div>
        <button className={linkButton} onClick={() => openManagement()}>
          {t("manage")} →
        </button>
      </header>
      <Power context={context} compact />
      {unavailable ? (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-1">
          <ConfigurationNotice context={context} compact />
        </div>
      ) : (
        <Nodes
          context={context}
          compact
          rail={<Modes context={context} variant="rail" />}
        />
      )}
      <footer className="h-[92px] flex-none border-t border-t-border px-5 py-3">
        <Quota context={context} compact />
        <div className="mt-1 flex items-center justify-between gap-2.5 text-[10px] text-muted-foreground">
          <span>{t("scope")}</span>
          <button
            className={cn(linkButton, "min-h-[22px] text-[11px]")}
            onClick={() => openManagement("diagnostics")}
          >
            {t("diagnostics")}
          </button>
        </div>
      </footer>
    </div>
  );
}
function App() {
  const controller = useController();
  const model = controller.model;
  const [page, setPage] = useState<Page>(route);
  const lang = language(model?.preferences.language ?? "system");
  const t = translator(lang);
  useEffect(() => {
    const change = () => setPage(route());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("lang", lang.replace("_", "-"));
    document.documentElement.setAttribute("dir", lang === "fa" ? "rtl" : "ltr");
    setAppLanguage(lang);
    const theme = model?.preferences.theme ?? "system";
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && query.matches),
      );
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [lang, model?.preferences.theme]);
  // styles.css 的 base 层给 html 设了 overflow:hidden（控制台自带内部滚动），
  // 扩展沿用文档滚动；弹窗则把 body 固定成 520×568 视口。
  useEffect(() => {
    document.documentElement.classList.add("overflow-auto");
    document.body.className = popup
      ? "h-[568px] w-[520px] overflow-hidden bg-card text-[14px] leading-[1.55]"
      : "text-[14px] leading-[1.55]";
  }, []);
  const navigate = (destination: Page, group?: string) => {
    if (popup) {
      openManagement(destination, group);
      return;
    }
    location.assign(
      "#" + destination + (group ? `?group=${encodeURIComponent(group)}` : ""),
    );
  };
  if (!model)
    return (
      <div className="grid min-h-[400px] content-center justify-center gap-4 p-[30px] text-center">
        <XBondIcon className="mx-auto w-10" />
        <h1 className="text-[25px] font-semibold leading-[1.35] max-[700px]:text-[22px]">
          XBond
        </h1>
        <p>
          {controller.error?.includes("extension_unavailable")
            ? t("unavailable")
            : controller.error
              ? t("failed")
              : t("loading")}
        </p>
        {controller.error && (
          <Button onClick={() => void controller.refresh()}>
            {t("retry")}
          </Button>
        )}
      </div>
    );
  const context: Context = { model, controller, t, navigate };
  const views: Record<Page, ReactNode> = {
    home: <Home context={context} />,
    nodes: (
      <>
        <div className="mb-[18px] flex justify-end">
          <Modes context={context} />
        </div>
        <Nodes context={context} />
      </>
    ),
    account: <Account context={context} />,
    rules: <Rules context={context} />,
    requests: <Requests context={context} />,
    logs: <Logs context={context} />,
    diagnostics: <Diagnostics context={context} />,
    settings: <Settings context={context} />,
  };
  const feedback = (
    <div
      className={cn(
        "fixed z-10 max-w-[min(400px,90vw)] rounded-[9px] bg-card px-[15px] py-2.5 text-[13px] shadow-[0_7px_30px_oklch(0_0_0/15%)] empty:hidden",
        controller.error ? "text-destructive-text" : "text-success-text",
        popup
          ? "bottom-[100px] inset-x-5 max-w-none text-[12px]"
          : "bottom-5 end-[25px]",
      )}
      role={controller.error ? "alert" : "status"}
      aria-live="polite"
    >
      {controller.pending ? (
        t("pending")
      ) : controller.error ? (
        <>
          <span>{t("failed")}</span>
          <details className="mt-[7px] text-[12px]">
            <summary>{t("details")}</summary>
            <pre className="max-h-[100px] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
              {controller.error}
            </pre>
          </details>
        </>
      ) : controller.feedback ? (
        t("saved")
      ) : (
        ""
      )}
    </div>
  );
  return (
    <>
      {popup ? (
        <Popup context={context} />
      ) : (
        <div className="grid min-h-dvh grid-cols-[192px_minmax(0,1fr)] gap-3 p-3 max-[1000px]:grid-cols-[164px_minmax(0,1fr)] max-[700px]:block max-[700px]:p-2">
          <aside className="sticky top-3 flex h-[calc(100dvh-24px)] flex-col rounded-2xl bg-sidebar px-3 py-[18px] shadow-[0_4px_20px_oklch(0_0_0/3%)] max-[700px]:static max-[700px]:mb-2.5 max-[700px]:h-auto max-[700px]:p-3">
            <a
              href="#home"
              className={cn(
                brandClass,
                "px-2.5 pb-[25px] max-[700px]:px-0 max-[700px]:pb-3 max-[700px]:text-[18px]",
              )}
            >
              <XBondIcon className="h-[29px] w-[27px] shrink-0" />
              XBond
            </a>
            <nav
              aria-label="XBond"
              className="grid gap-1 max-[700px]:flex max-[700px]:overflow-auto"
            >
              {pages.map((name, index) => (
                <a
                  href={`#${name}`}
                  key={name}
                  className={cn(
                    "flex items-center gap-[11px] rounded-lg px-3 py-[11px] text-[13px] text-muted-foreground max-[700px]:whitespace-nowrap max-[700px]:px-[11px] max-[700px]:py-2",
                    page === name &&
                      "bg-card font-semibold text-foreground shadow-[0_2px_7px_oklch(0_0_0/6%)]",
                  )}
                  aria-current={page === name ? "page" : undefined}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-[18px] w-[18px] shrink-0 max-[700px]:hidden"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                  >
                    <path
                      d={
                        [
                          "M12 3 3 10v11h6v-7h6v7h6V10z",
                          "M4 4h16v6H4zM4 14h16v6H4z",
                          "M4 7h16v14H4zM8 7V3h8v4",
                          "M4 6h16M4 12h12M4 18h8",
                          "M3 6h18M3 12h18M3 18h18",
                          "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
                          "M8 3h8M10 3v7L5 21h14l-5-11V3",
                          "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3",
                        ][index]
                      }
                    />
                  </svg>
                  {t(name)}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-[5px] w-[5px] shrink-0 rounded-full bg-brand",
                      page === name ? "ms-auto" : "hidden",
                      "max-[700px]:hidden",
                    )}
                  />
                </a>
              ))}
            </nav>
            <footer className="mt-auto border-t border-t-border px-2.5 pt-4 text-[11px] text-muted-foreground max-[700px]:hidden">
              <p className="mb-1.5 text-[12px] text-foreground">
                {status(model, t)}
              </p>
              <p>{t("scope")}</p>
              <button
                className={linkButton}
                onClick={() => navigate("account")}
              >
                XBond Cloud
              </button>
            </footer>
          </aside>
          <main className="min-w-0 rounded-2xl bg-card p-7 shadow-[0_4px_20px_oklch(0_0_0/2%)] max-[1000px]:p-[22px] max-[700px]:p-[18px]">
            <header className="mb-[26px] flex items-start justify-between gap-5 max-[700px]:flex-wrap max-[700px]:gap-3.5">
              <div>
                <h1 className="text-[25px] font-semibold leading-[1.35] max-[700px]:text-[22px]">
                  {t(page)}
                </h1>
                {page === "home" && (
                  <p className="mt-[7px] text-[13px] text-muted-foreground">
                    {t("summary")}
                  </p>
                )}
              </div>
              {page !== "account" && model.config.available && (
                <Button
                  disabled={controller.pending}
                  onClick={() =>
                    void controller.act({ type: "refresh-config" })
                  }
                >
                  {t("refresh")}
                </Button>
              )}
            </header>
            {views[page]}
          </main>
        </div>
      )}
      {feedback}
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Extension root missing");
createRoot(root).render(<App />);
