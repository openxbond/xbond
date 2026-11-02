import "@fontsource-variable/inter";
import "@xbond/client-ui/tokens.css";
import {
  Button,
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

import "./style.scss";

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
    <section className="ext-panel">
      <div className="ext-section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
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
        <label className="ext-rail-label" htmlFor="ext-routing-mode">
          {t("mode")}
        </label>
        <select
          id="ext-routing-mode"
          value={model.mode}
          disabled={disabled}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === "rule" || mode === "global" || mode === "direct")
              void controller.act({ type: "set-mode", mode });
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </>
    );
  return (
    <div className="ext-modes">
      <ButtonSelect<RoutingMode>
        value={model.mode}
        disabled={disabled}
        options={options}
        onSelect={(mode) => void controller.act({ type: "set-mode", mode })}
      />
    </div>
  );
}
function Power({ context }: { context: Context }) {
  const { model, controller, t } = context;
  return (
    <div
      className={`ext-power ${model.state.kind === "ok" && model.enabled && model.mode !== "direct" ? "is-on" : ""}`}
    >
      <div>
        <h1>
          <span className="ext-status-dot" />
          {status(model, t)}
        </h1>
        <p>
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
        label={t("enable")}
        onChange={(enabled) =>
          void controller.act({ type: "set-enabled", enabled })
        }
      />
    </div>
  );
}
function ConfigurationNotice({ context }: { context: Context }) {
  const { model, controller, t } = context;
  if (model.pendingLogin || !model.signedIn) return <Login context={context} />;
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
      <div className="ext-recovery">
        <h2>{t("controlLost")}</h2>
        <p>
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
function Login({ context }: { context: Context }) {
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
    <div className="ext-login">
      <h2>
        {pending
          ? t("waiting")
          : model.loginEnded === "expired"
            ? t("loginExpired")
            : model.loginEnded === "failed"
              ? t("loginFailed")
              : t("signIn")}
      </h2>
      <p>{t("loginHint")}</p>
      {pending && (
        <>
          <p className="ext-device-code" aria-label={t("deviceCode")}>
            {pending.userCode}
          </p>
          <p>
            {t("expiresIn")}:{" "}
            {Math.max(0, Math.ceil((pending.expiresAt - now) / 1000))} s
          </p>
        </>
      )}
      <div className="ext-actions">
        {pending ? (
          <>
            <Button
              type="brand"
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
            type="brand"
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
  if (!quota) return <p className="ext-muted">{t("quotaUnknown")}</p>;
  const used = quota.uploadBytes + quota.downloadBytes;
  const remaining = Math.max(0, quota.totalBytes - used);
  return (
    <div className={`ext-quota ${compact ? "is-compact" : ""}`}>
      {!compact && quota.totalBytes > 0 && (
        <QuotaRing percent={(remaining / quota.totalBytes) * 100} />
      )}
      <div>
        <p>
          {t("remaining")} <strong>{formatTraffic(remaining)}</strong>{" "}
          <span className="ext-muted">/ {formatTraffic(quota.totalBytes)}</span>
        </p>
        {!compact && (
          <p className="ext-muted">
            {t("used")}: {formatTraffic(used)}
          </p>
        )}
        <p className="ext-muted">
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
  if (model.mode === "direct")
    return rail ? (
      <div className="ext-node-workspace is-compact has-rail">
        <div className="ext-rail-modes">{rail}</div>
        <section className="ext-members">
          <h2>{t("follow")}</h2>
          <p>{t("inherited")}</p>
          <p className="ext-muted">{t("differentExits")}</p>
        </section>
      </div>
    ) : (
      <div className="ext-inherited">
        <h2>{t("follow")}</h2>
        <p>{t("inherited")}</p>
        <p className="ext-muted">{t("differentExits")}</p>
      </div>
    );
  return (
    <div
      className={`ext-node-workspace ${compact ? "is-compact" : ""} ${global ? "is-global" : ""} ${rail ? "has-rail" : ""}`}
    >
      {rail && <div className="ext-rail-modes">{rail}</div>}
      {!global && (
        <StrategyDirectory
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
      <section className="ext-members">
        <div className="ext-section-heading">
          <h2>{global ? t("globalExit") : (group?.name ?? t("nodes"))}</h2>
          <span className="ext-muted">{unique.length}</span>
        </div>
        <div className="ext-strategy-path">
          <StrategyPath
            path={global ? model.globalPath : (group?.path ?? [])}
          />
        </div>
        <div className="ext-node-search">
          <input
            aria-label={t("search")}
            type="search"
            placeholder={t("search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {!compact && (
            <select
              aria-label={t("sort")}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="default">{t("source")}</option>
              <option value="name">A → Z</option>
            </select>
          )}
        </div>
        <ul className="ext-member-list">
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
              {!compact && <span className="ext-badge">{detail(name)}</span>}
            </StrategyChoice>
          ))}
        </ul>
        {unique.length === 0 && <EmptyState message={t("noNodes")} />}{" "}
        {!compact && (
          <p className="ext-muted ext-node-note">
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
      <div className="ext-home-power">
        <Power context={context} />
        <Modes context={context} />
      </div>
      <ConfigurationNotice context={context} />
      {model.signedIn && model.config.available && (
        <div className="ext-two-columns">
          <Panel
            title={t("groups")}
            action={
              <button className="ext-link" onClick={() => navigate("nodes")}>
                {t("allGroups")}
              </button>
            }
          >
            {model.groups.slice(0, 4).map((group) => (
              <button
                className="ext-group-summary"
                key={group.name}
                onClick={() => navigate("nodes", group.name)}
              >
                <strong>{renderNodeTitle(group.name)}</strong>
                <StrategyPath path={group.path.slice(1)} />
              </button>
            ))}
          </Panel>
          <Panel title={t("remaining")}>
            <Quota context={context} />
          </Panel>
          <Panel title={t("config")}>
            <p>XBond Cloud</p>
            <p className="ext-muted">
              {t("updated")}:{" "}
              {date(
                model.config.updatedAt,
                language(model.preferences.language),
              )}
            </p>
            {model.config.error && (
              <p className="ext-warning">{t("updateFailed")}</p>
            )}
            <Button
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
            <div className="ext-actions">
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
      <div className="ext-two-columns">
        <Panel title="XBond Cloud">
          <Quota context={context} />
          <div className="ext-actions">
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
              type="danger"
              onClick={() => void controller.act({ type: "logout" })}
              disabled={controller.pending}
            >
              {t("signOut")}
            </Button>
          </div>
        </Panel>
        <Panel title={t("config")}>
          <dl>
            <dt>{t("source")}</dt>
            <dd>XBond Cloud</dd>
            <dt>{t("updated")}</dt>
            <dd>
              {date(
                model.config.updatedAt,
                language(model.preferences.language),
              )}
            </dd>
            <dt>{t("result")}</dt>
            <dd>{model.config.available ? t("applied") : t("noConfig")}</dd>
          </dl>
          <Button
            type="brand"
            disabled={controller.pending}
            onClick={() => void controller.act({ type: "refresh-config" })}
          >
            {t("refresh")}
          </Button>
        </Panel>
      </div>
      {model.config.error && (
        <div className="ext-warning" role="alert">
          <p>{t("updateFailed")}</p>
          <details>
            <summary>{t("details")}</summary>
            <pre>{model.config.error}</pre>
          </details>
        </div>
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
      <div className="ext-toolbar">
        <input
          type="search"
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
        <span className="ext-muted">{filtered.length}</span>
      </div>
      <div className="ext-table-scroll">
        <table>
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
      <div className="ext-pagination">
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
      <p className="ext-notice">{t("exceptionHint")}</p>
      <Panel title={t("exceptions")}>
        <div className="ext-table-scroll">
          <table>
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
                      <span className="ext-danger">{t("invalidTarget")}</span>
                    ) : (
                      <label className="ext-checkbox">
                        <input
                          type="checkbox"
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
                    <div className="ext-actions">
                      <Button
                        disabled={controller.pending}
                        onClick={() => edit(rule)}
                      >
                        {t("edit")}
                      </Button>
                      <Button
                        type="danger"
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
        <details
          key={editing?.id ?? "new"}
          open={!!editing}
          className="ext-rule-form"
        >
          <summary>{t(editing ? "edit" : "add")}</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="ext-form-grid">
              <label>
                {t("domain")}
                <input
                  required
                  value={domain}
                  placeholder="docs.example.org"
                  onChange={(event) => setDomain(event.target.value)}
                />
              </label>
              <label>
                {t("match")}
                <select
                  value={match}
                  onChange={(event) =>
                    setMatch(
                      event.target.value === "suffix" ? "suffix" : "exact",
                    )
                  }
                >
                  <option value="exact">{t("exact")}</option>
                  <option value="suffix">{t("suffix")}</option>
                </select>
              </label>
              <label>
                {t("target")}
                <select
                  value={target || targets[0]}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  {targets.map((name) => (
                    <option value={name} key={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ext-actions">
              <Button
                htmlType="submit"
                type="brand"
                disabled={controller.pending}
              >
                {t("save")}
              </Button>
              {editing && (
                <Button
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
          className="ext-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.act({ type: "predict-route", host });
          }}
        >
          <input
            required
            value={host}
            aria-label={t("domain")}
            placeholder="docs.example.org"
            onChange={(event) => setHost(event.target.value)}
          />
          <Button htmlType="submit" type="brand" disabled={controller.pending}>
            {t("predict")}
          </Button>
        </form>
        {model.prediction && (
          <div className="ext-prediction">
            <strong>{model.prediction.host}</strong>
            <p>{model.prediction.condition}</p>
            <StrategyPath path={model.prediction.path} />
          </div>
        )}
        <p className="ext-muted">{t("predictionHint")}</p>
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
            type={model.recording ? "normal" : "brand"}
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
      <div className="ext-toolbar">
        <input
          type="search"
          placeholder={t("domain")}
          aria-label={t("domain")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label={t("result")}
          value={result}
          onChange={(event) => setResult(event.target.value)}
        >
          {["all", "completed", "failed", "pending"].map((key) => (
            <option value={key} key={key}>
              {t(key as TextKey)}
            </option>
          ))}
        </select>
        <Button
          disabled={controller.pending}
          onClick={() => void controller.act({ type: "clear-requests" })}
        >
          {t("clear")}
        </Button>
      </div>
      <div className="ext-table-scroll">
        <table>
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
                    className={record.status === "failed" ? "ext-danger" : ""}
                  >
                    {t(record.status)}
                  </span>
                  {record.error && <small>{record.error}</small>}
                </td>
                <td>
                  {record.duration === undefined
                    ? "—"
                    : `${Math.round(record.duration)} ms`}
                </td>
                <td>
                  <button
                    className="ext-link"
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
      <p className="ext-muted ext-note">{t("requestHint")}</p>
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
      <div className="ext-toolbar">
        <input
          type="search"
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label={t("level")}
          value={level}
          onChange={(event) => setLevel(event.target.value)}
        >
          {["all", "info", "warn", "error"].map((key) => (
            <option value={key} key={key}>
              {t(key as TextKey)}
            </option>
          ))}
        </select>
        <Button onClick={() => exportLog(events)}>{t("export")}</Button>
        <Button
          disabled={controller.pending}
          onClick={() => void controller.act({ type: "clear-events" })}
        >
          {t("clear")}
        </Button>
      </div>
      <div className="ext-table-scroll">
        <table>
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
                    className={`ext-badge ${event.level === "error" ? "ext-danger" : event.level === "warn" ? "ext-warning" : ""}`}
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
      <div className="ext-toolbar">
        <Button
          onClick={() => void controller.act({ type: "reconcile" })}
          disabled={controller.pending}
        >
          {t("retry")}
        </Button>
        <Button
          type="brand"
          onClick={() => void controller.act({ type: "check-connectivity" })}
          disabled={controller.pending || model.state.kind !== "ok"}
        >
          {t("test")}
        </Button>
      </div>
      <Panel title={t("diagnostics")}>
        <dl>
          {checks.map(([key, value]) => (
            <div className="ext-diagnostic" key={key}>
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {connectivity.target && (
          <p className="ext-muted">
            {connectivity.target} ·{" "}
            {date(connectivity.at, language(model.preferences.language))}{" "}
            {connectivity.duration !== undefined
              ? `· ${connectivity.duration} ms`
              : ""}
          </p>
        )}
        {connectivity.error && (
          <p className="ext-danger">{connectivity.error}</p>
        )}
        <p className="ext-muted">{t("reachHint")}</p>
      </Panel>
      <ConfigurationNotice context={context} />
      <div className="ext-actions">
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
      <div className="ext-setting">
        <label htmlFor="theme">{t("theme")}</label>
        <select
          id="theme"
          disabled={controller.pending}
          value={model.preferences.theme}
          onChange={(event) => {
            const theme = event.target.value;
            if (theme === "system" || theme === "light" || theme === "dark")
              update({ theme });
          }}
        >
          {["system", "light", "dark"].map((value) => (
            <option key={value} value={value}>
              {t(value as TextKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="ext-setting">
        <label htmlFor="language">{t("language")}</label>
        <select
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
        >
          <option value="system">{t("system")}</option>
          <option value="en_US">English</option>
          <option value="zh_CN">简体中文</option>
          <option value="zh_HK">繁體中文（香港）</option>
          <option value="ko">한국어</option>
          <option value="fa">فارسی</option>
        </select>
      </div>
      {(["autoUpdate", "restore"] as const).map((key) => (
        <div className="ext-setting" key={key}>
          <span>{t(key)}</span>
          <Switch
            checked={model.preferences[key]}
            label={t(key)}
            disabled={controller.pending}
            onChange={(checked) => update({ [key]: checked })}
          />
        </div>
      ))}
      <div className="ext-setting">
        <span>{t("privacy")}</span>
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
    <div className="ext-popup">
      <header className="ext-popup-header">
        <div className="ext-brand">
          <XBondIcon />
          XBond
        </div>
        <button className="ext-link" onClick={() => openManagement()}>
          {t("manage")} →
        </button>
      </header>
      <Power context={context} />
      {unavailable ? (
        <div className="ext-popup-unavailable">
          <ConfigurationNotice context={context} />
        </div>
      ) : (
        <Nodes
          context={context}
          compact
          rail={<Modes context={context} variant="rail" />}
        />
      )}
      <footer className="ext-popup-footer">
        <Quota context={context} compact />
        <div className="ext-popup-footer-links">
          <span>{t("scope")}</span>
          <button
            className="ext-link"
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
      <div className="ext-starting">
        <XBondIcon />
        <h1>XBond</h1>
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
        <Modes context={context} />
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
      className={`ext-feedback ${controller.error ? "is-error" : ""}`}
      role={controller.error ? "alert" : "status"}
      aria-live="polite"
    >
      {controller.pending ? (
        t("pending")
      ) : controller.error ? (
        <>
          <span>{t("failed")}</span>
          <details>
            <summary>{t("details")}</summary>
            <pre>{controller.error}</pre>
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
        <div className="ext-app">
          <aside className="ext-sidebar">
            <a href="#home" className="ext-brand">
              <XBondIcon />
              XBond
            </a>
            <nav aria-label="XBond">
              {pages.map((name, index) => (
                <a
                  href={`#${name}`}
                  key={name}
                  className={page === name ? "active" : ""}
                  aria-current={page === name ? "page" : undefined}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
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
                </a>
              ))}
            </nav>
            <footer>
              <p className="ext-sidebar-status">{status(model, t)}</p>
              <p>{t("scope")}</p>
              <button className="ext-link" onClick={() => navigate("account")}>
                XBond Cloud
              </button>
            </footer>
          </aside>
          <main className="ext-main">
            <header className="ext-page-heading">
              <div>
                <h1>{t(page)}</h1>
                {page === "home" && <p>{t("summary")}</p>}
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
