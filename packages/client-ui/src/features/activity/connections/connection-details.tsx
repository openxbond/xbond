import { basePath, formatTraffic } from "@xbond/client/helper";
import { workspaceLink } from "@xbond/client/workspace";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { type BaseComponentProps } from "@/components/component-props";
import { cn } from "@/lib/utils";

import { type Connection } from "./use-connections";

interface ConnectionsInfoProps extends BaseComponentProps {
  connection: Partial<Connection>;
}

export function ConnectionInfo(props: ConnectionsInfoProps) {
  const { t } = useTranslation("connections");
  const { search } = useLocation();
  const { rule, rulePayload } = props.connection;

  return (
    <div
      className={cn(props.className, "flex flex-col overflow-y-auto text-sm")}
    >
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.id")}</span>
        <span className="font-mono">{props.connection.id}</span>
      </div>
      <div className="my-3 flex justify-between">
        <div className="flex flex-1">
          <span className="w-20 font-bold">{t("info.network")}</span>
          <span className="font-mono">
            {props.connection.metadata?.network}
          </span>
        </div>
        <div className="flex flex-1">
          <span className="w-20 font-bold">{t("info.inbound")}</span>
          <span className="font-mono">{props.connection.metadata?.type}</span>
        </div>
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.host")}</span>
        <span className="flex-1 break-all font-mono">
          {props.connection.metadata?.host
            ? `${props.connection.metadata.host}:${props.connection.metadata?.destinationPort}`
            : t("info.hostEmpty")}
        </span>
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.dstIP")}</span>
        <span className="font-mono">
          {props.connection.metadata?.destinationIP
            ? `${props.connection.metadata.destinationIP}:${props.connection.metadata?.destinationPort}`
            : t("info.hostEmpty")}
        </span>
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.srcIP")}</span>
        <span className="font-mono">{`${props.connection.metadata?.sourceIP}:${props.connection.metadata?.sourcePort}`}</span>
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.process")}</span>
        <span className="flex-1 break-all font-mono">
          {props.connection.metadata?.processPath
            ? `${basePath(props.connection.metadata.processPath)}`
            : t("info.hostEmpty")}
        </span>
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.processPath")}</span>
        <span className="flex-1 break-all font-mono">
          {props.connection.metadata?.processPath
            ? `${props.connection.metadata.processPath}`
            : t("info.hostEmpty")}
        </span>
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.rule")}</span>
        {rule === "final" && !rulePayload ? (
          <span className="font-mono">{rule}</span>
        ) : (
          rule && (
            <Link
              className="min-w-0 flex-1 break-all font-mono text-brand-text underline underline-offset-4"
              to={workspaceLink(search, "/rules", {
                tab: "rules",
                matchedRuleType: rule,
                matchedRulePayload: rulePayload ?? "",
              })}
            >
              {rule}
              {rulePayload && ` :: ${rulePayload}`}
            </Link>
          )
        )}
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.chains")}</span>
        <span className="flex-1 break-all font-mono">
          {props.connection.chains?.slice().reverse().join(" / ")}
        </span>
      </div>
      <div className="my-3 flex justify-between">
        <div className="flex flex-1">
          <span className="w-20 font-bold">{t("info.upload")}</span>
          <span className="font-mono">
            {formatTraffic(props.connection.upload ?? 0)}
          </span>
        </div>
        <div className="flex flex-1">
          <span className="w-20 font-bold">{t("info.download")}</span>
          <span className="font-mono">
            {formatTraffic(props.connection.download ?? 0)}
          </span>
        </div>
      </div>
      <div className="my-3 flex">
        <span className="w-20 font-bold">{t("info.status")}</span>
        <span className="font-mono">
          {!props.connection.completed ? (
            <span className="text-success">{t("info.opening")}</span>
          ) : (
            <span className="text-destructive">{t("info.closed")}</span>
          )}
        </span>
      </div>
    </div>
  );
}
