import { Button } from "@components";
import { useAction } from "@lib/actions";
import type { Group as IGroup } from "@lib/request";
import { strategyPath } from "@lib/workspace";
import {
  useProxy,
  useConfig,
  useProxyMapping,
  useClient,
  useI18n,
  useLocalAPI,
} from "@stores";
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
  labels: Map<string, string>;
  onSelect: (name: string) => void;
}
function MemberRow({
  index,
  style,
  names,
  selected,
  canClick,
  pending,
  labels,
  onSelect,
}: RowComponentProps<MemberData>) {
  const name = names[index];
  return (
    <div
      style={style}
      className={"group-member" + (selected === name ? " is-selected" : "")}
    >
      {canClick ? (
        <button
          type="button"
          disabled={pending}
          aria-pressed={selected === name}
          onClick={() => onSelect(name)}
        >
          <span className="member-name">{name}</span>
          <span className="member-result">{labels.get(name)}</span>
        </button>
      ) : (
        <div className="member-static">
          <span className="member-name">{name}</span>
          <span className="member-result">{labels.get(name)}</span>
        </div>
      )}
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
  const { markProxySelected, update } = useProxy();
  const mapping = useProxyMapping();
  const { data: preferences } = useConfig();
  const client = useClient();
  const { run: action, pending } = useAction();
  const { run, results, progress } = useLatency();
  const { hasLocalAPI, selectNode } = useLocalAPI();
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
      return [name, (item?.type || "") + " · " + status];
    }),
  );
  async function select(name: string) {
    await action(async () => {
      if (hasLocalAPI) await selectNode(config.name, name);
      else await client.changeProxySelected(config.name, name);
      markProxySelected(config.name, name);
      await update();
      if (preferences.breakConnections) {
        const snapshot = await client.getConnections();
        const matches = snapshot.data.connections.filter((connection) =>
          connection.chains.includes(config.name),
        );
        await Promise.all(
          matches.map((connection) => client.closeConnection(connection.id)),
        );
      }
    }, false);
  }
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
        <List
          rowComponent={MemberRow}
          rowCount={names.length}
          rowHeight={42}
          rowProps={{
            names,
            selected: config.now,
            canClick: config.type === "Selector",
            pending,
            labels,
            onSelect: (name: string) => void select(name),
          }}
          style={{
            height: Math.min(10, names.length) * 42,
            minHeight: names.length ? 42 : 0,
          }}
        />
      </div>
    </details>
  );
}
