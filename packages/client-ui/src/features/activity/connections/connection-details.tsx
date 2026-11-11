import { basePath, formatTraffic } from "@xbond/client/helper";
import { workspaceLink } from "@xbond/client/workspace";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { type BaseComponentProps } from "@/components/component-props";
import { cn } from "@/lib/utils";

import { type Connection } from "./use-connections";

interface ConnectionsInfoProps extends BaseComponentProps {
  connection: Partial<Connection>;
}

function InfoRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 gap-3 py-2.5", className)}>
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-foreground">{children}</dd>
    </div>
  );
}

export function ConnectionInfo(props: ConnectionsInfoProps) {
  const { t } = useTranslation("connections");
  const { search } = useLocation();
  const { rule, rulePayload } = props.connection;

  return (
    <div className={cn(props.className, "flex flex-col overflow-y-auto")}>
      <dl className="divide-y divide-border/60 text-sm">
        <InfoRow label={t("info.id")}>
          <span className="font-mono">{props.connection.id}</span>
        </InfoRow>
        <div className="flex gap-6">
          <InfoRow className="min-w-0 flex-1" label={t("info.network")}>
            <span className="font-mono">
              {props.connection.metadata?.network}
            </span>
          </InfoRow>
          <InfoRow className="min-w-0 flex-1" label={t("info.inbound")}>
            <span className="font-mono">{props.connection.metadata?.type}</span>
          </InfoRow>
        </div>
        <InfoRow label={t("info.host")}>
          <span className="font-mono">
            {props.connection.metadata?.host
              ? `${props.connection.metadata.host}:${props.connection.metadata?.destinationPort}`
              : t("info.hostEmpty")}
          </span>
        </InfoRow>
        <InfoRow label={t("info.dstIP")}>
          <span className="font-mono">
            {props.connection.metadata?.destinationIP
              ? `${props.connection.metadata.destinationIP}:${props.connection.metadata?.destinationPort}`
              : t("info.hostEmpty")}
          </span>
        </InfoRow>
        <InfoRow label={t("info.srcIP")}>
          <span className="font-mono">{`${props.connection.metadata?.sourceIP}:${props.connection.metadata?.sourcePort}`}</span>
        </InfoRow>
        <InfoRow label={t("info.process")}>
          <span className="font-mono">
            {props.connection.metadata?.processPath
              ? `${basePath(props.connection.metadata.processPath)}`
              : t("info.hostEmpty")}
          </span>
        </InfoRow>
        <InfoRow label={t("info.processPath")}>
          <span className="font-mono">
            {props.connection.metadata?.processPath
              ? `${props.connection.metadata.processPath}`
              : t("info.hostEmpty")}
          </span>
        </InfoRow>
        <InfoRow label={t("info.rule")}>
          {rule === "final" && !rulePayload ? (
            <span className="font-mono">{rule}</span>
          ) : (
            rule && (
              <Link
                className="break-all font-mono text-brand-text underline underline-offset-4"
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
        </InfoRow>
        <InfoRow label={t("info.chains")}>
          <span className="font-mono">
            {props.connection.chains?.slice().reverse().join(" / ")}
          </span>
        </InfoRow>
        <div className="flex gap-6">
          <InfoRow className="min-w-0 flex-1" label={t("info.upload")}>
            <span className="font-mono">
              {formatTraffic(props.connection.upload ?? 0)}
            </span>
          </InfoRow>
          <InfoRow className="min-w-0 flex-1" label={t("info.download")}>
            <span className="font-mono">
              {formatTraffic(props.connection.download ?? 0)}
            </span>
          </InfoRow>
        </div>
        <InfoRow label={t("info.status")}>
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              props.connection.completed
                ? "text-muted-foreground"
                : "text-success",
            )}
          >
            <span
              className={cn(
                "status-dot",
                !props.connection.completed && "online",
              )}
            />
            {props.connection.completed ? t("info.closed") : t("info.opening")}
          </span>
        </InfoRow>
      </dl>
    </div>
  );
}
