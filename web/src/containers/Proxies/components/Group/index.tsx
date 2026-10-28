import { Button } from "@components";
import { CopyButton } from "@components/CopyButton";
import { useNodeSelection } from "@lib/node-selection";
import type { Group as IGroup } from "@lib/request";
import { strategyPath } from "@lib/workspace";
import { useProxyMapping, useI18n } from "@stores";
import { useLatency } from "@stores/latency";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { List, type RowComponentProps } from "react-window";

import "./style.scss";

interface MemberData {
  names: string[];
  selected: string;
  canClick: boolean;
  pending: boolean;
  switchingName: string;
  switchingLabel: string;
  labels: Map<string, string>;
  delays: Map<string, number | undefined>;
  statuses: Map<string, string>;
  canTests: Map<string, boolean>;
  onSelect: (name: string) => void;
  onTest: (name: string) => void;
}
function MemberRow({
  index,
  style,
  names,
  selected,
  canClick,
  pending,
  switchingName,
  switchingLabel,
  labels,
  delays,
  statuses,
  canTests,
  onSelect,
  onTest,
}: RowComponentProps<MemberData>) {
  const name = names[index];
  const delay = delays.get(name);
  const status = statuses.get(name);
  const isTesting = status === "testing";
  const canTest = canTests.get(name) ?? false;

  return (
    <div
      style={style}
      className={"group-member" + (selected === name ? " is-selected" : "")}
    >
      {canClick ? (
        <button
          type="button"
          className="member-select-btn"
          aria-label={name}
          disabled={pending}
          aria-pressed={selected === name}
          onClick={() => onSelect(name)}
        >
          <span className="member-name">
            <svg
              className="member-check"
              viewBox="0 0 18 18"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="7" />
              {selected === name && <path d="m5.5 9 2.3 2.5 4.7-5" />}
            </svg>
            <span className="member-text">{name}</span>
          </span>
        </button>
      ) : (
        <div className="member-static">
          <span className="member-name">
            <span className="member-bullet" aria-hidden="true" />
            <span className="member-text">{name}</span>
          </span>
        </div>
      )}
      <div className="member-actions">
        <span className="member-result">
          {pending && switchingName === name ? (
            switchingLabel
          ) : isTesting ? (
            <span className="node-delay-pill testing">測速中…</span>
          ) : delay !== undefined && delay > 0 ? (
            <span
              className={`node-delay-pill ${
                delay < 150 ? "good" : delay <= 400 ? "medium" : "slow"
              }`}
            >
              {delay} ms
            </span>
          ) : (
            <span className="node-delay-pill untested">{labels.get(name)}</span>
          )}
        </span>
        {canTest && (
          <button
            type="button"
            className={`node-speed-btn ${isTesting ? "is-testing" : ""}`}
            title="單獨測速此節點"
            aria-label={`單獨測速: ${name}`}
            disabled={isTesting}
            onClick={(e) => {
              e.stopPropagation();
              onTest(name);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill={isTesting ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
export function Group({
  config,
  search = "",
  initialOpen = false,
}: {
  config: IGroup;
  search?: string;
  initialOpen?: boolean;
}) {
  const mapping = useProxyMapping();
  const {
    select: selectNode,
    pending,
    selectedName: switchingName,
    result: selectionStatus,
  } = useNodeSelection();
  const { run, results, progress } = useLatency();
  const { translation } = useI18n();
  const { t } = translation("Speed");
  const { t: ui } = translation("ClientUI");
  const [params] = useSearchParams();
  const [open, setOpen] = useState(
    initialOpen || params.get("group") === config.name,
  );
  const path = strategyPath(config, mapping);
  const names = config.all.filter(
    (name) =>
      !search ||
      config.name.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase()),
  );
  const labels = new Map(
    names.map((name) => {
      const item = mapping.get(name);
      const result = results[name];
      const delay = result?.delay ?? item?.history?.at(-1)?.delay;
      const status =
        result && result.status !== "ok"
          ? t(result.status)
          : delay
            ? delay + " ms"
            : t("untested");
      return [name, (item?.type || "") + (status ? " · " + status : "")];
    }),
  );
  const delays = new Map(
    names.map((name) => {
      const item = mapping.get(name);
      const result = results[name];
      return [name, result?.delay ?? item?.history?.at(-1)?.delay];
    }),
  );
  const statuses = new Map(
    names.map((name) => [name, results[name]?.status || ""]),
  );
  const canTests = new Map(
    names.map((name) => {
      const item = mapping.get(name);
      return [
        name,
        Boolean(item && !["Direct", "Reject", "DNS"].includes(item.type)),
      ];
    }),
  );
  const select = (name: string) => selectNode(config.name, name);
  return (
    <details
      className="proxy-group"
      open={open || Boolean(search)}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="proxy-group-summary">
        <span className="group-name">
          {config.name}
          <small>
            {config.type} · {config.all.length} {ui("members")}
          </small>
        </span>
        <span className="group-selected">
          <span>{ui("selected")}</span>
          <strong>{config.now || "—"}</strong>
        </span>
        <span className="group-disclosure">
          {open ? ui("collapse") : ui("expand")}
        </span>
      </summary>
      <div className="group-workspace">
        <div className="group-toolbar">
          <span>{path.join(" → ")}</span>
          {config.now && (
            <CopyButton value={config.now} label={ui("copyNode")} />
          )}
          <Button
            disabled={progress.running || !names.length}
            onClick={() =>
              void run(
                names.filter((name) => {
                  const item = mapping.get(name);
                  return (
                    item && !["Direct", "Reject", "DNS"].includes(item.type)
                  );
                }),
              )
            }
          >
            {t("groupTest")}
          </Button>
        </div>
        {(pending || selectionStatus !== "idle") && (
          <p
            className={
              "group-feedback" +
              (selectionStatus === "failed"
                ? " is-error"
                : selectionStatus === "partial"
                  ? " is-warning"
                  : "")
            }
            role={selectionStatus === "failed" ? "alert" : "status"}
          >
            {ui(
              pending
                ? "switching"
                : selectionStatus === "partial"
                  ? "switchPartial"
                  : selectionStatus === "success"
                    ? "switched"
                    : "switchFailed",
            )}
          </p>
        )}
        <List
          rowComponent={MemberRow}
          rowCount={names.length}
          rowHeight={48}
          rowProps={{
            names,
            selected: config.now,
            canClick: config.type === "Selector",
            pending,
            switchingName,
            switchingLabel: ui("switching"),
            labels,
            delays,
            statuses,
            canTests,
            onSelect: (name: string) => void select(name),
            onTest: (name: string) => void run([name]),
          }}
          style={{
            height: Math.min(10, names.length) * 48,
            minHeight: names.length ? 48 : 0,
          }}
        />
      </div>
    </details>
  );
}
