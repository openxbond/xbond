import type { DNSResult } from "@xbond/client/request";
import { Globe, MonitorPlay, Server, Stethoscope } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Header } from "@/components/page-header";
import { Stat } from "@/components/stat";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useProxy } from "@/features/proxies/proxy-data";
import { errorKind, useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { useClient } from "@/state/controller-target";
import { useCapabilities, useGeneral } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";

const DEFAULT_SITES = [
  { id: "google", url: "https://www.gstatic.com/generate_204" },
  { id: "cloudflare", url: "https://cp.cloudflare.com/generate_204" },
  { id: "apple", url: "https://captive.apple.com/hotspot-detect.html" },
  { id: "github", url: "https://api.github.com" },
] as const;

const STREAM_SERVICES = [
  { id: "bilibiliMainland", url: "https://www.bilibili.com" },
  { id: "bilibiliHt", url: "https://www.bilibili.tv" },
  { id: "bahamut", url: "https://ani.gamer.com.tw" },
  { id: "chatgpt", url: "https://chatgpt.com" },
  { id: "claude", url: "https://claude.ai" },
  { id: "disney", url: "https://www.disneyplus.com" },
  { id: "gemini", url: "https://gemini.google.com" },
  { id: "netflix", url: "https://www.netflix.com/title/80018486" },
  { id: "prime", url: "https://www.primevideo.com" },
  { id: "spotify", url: "https://open.spotify.com" },
  { id: "tiktok", url: "https://www.tiktok.com" },
  { id: "youtube", url: "https://www.youtube.com/premium" },
] as const;

interface BenchmarkSite {
  id: string;
  url: string;
}

const badgeBase =
  "rounded-full px-2 py-[3px] text-xs font-semibold tabular-nums";

/* Latency buckets keep the source palette: light wash + dark text per tier. */
const badgeClass: Record<string, string> = {
  good: "bg-latency-good text-latency-good-text",
  medium: "bg-latency-medium text-latency-medium-text",
  slow: "bg-latency-slow text-latency-slow-text",
  error: "bg-latency-failed text-latency-failed-text",
  untested: "bg-transparent text-muted-foreground",
};

function pingBadge(
  isTesting: boolean | undefined,
  delay: number | undefined,
  labels: { pending: string; testing: string; failed: string },
) {
  if (isTesting) return { cls: "untested", text: labels.testing };
  if (delay === undefined) return { cls: "untested", text: labels.pending };
  if (delay < 0) return { cls: "error", text: labels.failed };
  if (delay < 300) return { cls: "good", text: `${delay} ms` };
  if (delay < 700) return { cls: "medium", text: `${delay} ms` };
  return { cls: "slow", text: `${delay} ms` };
}

function tallySites(
  ids: string[],
  testing: Record<string, boolean | undefined>,
  delays: Record<string, number | undefined>,
) {
  let ok = 0;
  let failed = 0;
  let pending = 0;
  for (const id of ids) {
    if (testing[id] || delays[id] === undefined) pending++;
    else if (delays[id] < 0) failed++;
    else ok++;
  }
  return { ok, failed, pending };
}

const pillBase = "rounded-full px-[7px] py-0.5 text-label font-semibold";

const pillClass: Record<string, string> = {
  pass: "bg-latency-good text-latency-good-text",
  warn: "bg-latency-medium text-latency-medium-text",
  fail: "bg-latency-failed text-latency-failed-text",
};

const responseCodes: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};

interface DoctorReportData {
  timestamp: string;
  threeTier: {
    coreReachable: boolean;
    trafficIntercepted: boolean;
    interceptNote?: string;
    egressVerified: boolean;
    egressLatencyMs: number;
    takeoverMode: string;
    routingMode: string;
    focusStrategy?: string;
    strategyChain?: string[];
  };
  dns: {
    localDnsSuccess: boolean;
    localIPs?: string;
    proxyDnsSuccess: boolean;
    proxyIPs?: string;
    error?: string;
  };
  egress: {
    directSuccess: boolean;
    directLatencyMs: number;
    proxySuccess: boolean;
    proxyLatencyMs: number;
    error?: string;
  };
  gateway: {
    primaryOrigin: string;
    primaryHealthy: boolean;
    fallbackOrigins?: string[];
    fallbackStatuses?: boolean[];
  };
}

export default function Diagnostics() {
  const { t } = useTranslation("diagnostics");
  const { t: tc } = useTranslation("common");
  const { t: tr } = useTranslation("runtime");

  const client = useClient();
  const caps = useCapabilities();
  const { groups, global } = useProxy();
  const { general } = useGeneral();
  const { hasLocalAPI, client: localClient } = useLocalAPI();
  const { run, pending } = useAction();

  // Site Benchmark State
  const [siteDelays, setSiteDelays] = useState<Record<string, number>>({});
  const [siteTesting, setSiteTesting] = useState<Record<string, boolean>>({});

  // DNS State
  const [domain, setDomain] = useState("");
  const [type, setType] = useState("A");
  const [validation, setValidation] = useState("");
  const [dnsResult, setDnsResult] = useState<{
    dns: DNSResult;
    elapsed: number;
    name: string;
    type: string;
  } | null>(null);
  const [clear, setClear] = useState<"dns" | "fakeip" | null>(null);

  // Doctor State
  const [doctorReport, setDoctorReport] = useState<DoctorReportData | null>(
    null,
  );
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorError, setDoctorError] = useState<
    ReturnType<typeof errorKind> | ""
  >("");

  // Target proxy node for site latency tests
  const targetProxy =
    general.mode.toLowerCase() === "global"
      ? global?.now || "GLOBAL"
      : groups[0]?.now || groups[0]?.name || "GLOBAL";

  async function testSite(site: BenchmarkSite) {
    setSiteTesting((prev) => ({ ...prev, [site.id]: true }));
    try {
      const res = await client.getProxyDelay(targetProxy, site.url, 5000);
      setSiteDelays((prev) => ({ ...prev, [site.id]: res.data.delay }));
    } catch {
      setSiteDelays((prev) => ({ ...prev, [site.id]: -1 }));
    } finally {
      setSiteTesting((prev) => ({ ...prev, [site.id]: false }));
    }
  }

  async function testAllSites(sites: readonly BenchmarkSite[]) {
    await Promise.all(sites.map((site) => testSite(site)));
  }

  function queryDNS() {
    const name = domain.trim();
    if (!name || /[\s/:?#@]/.test(name) || name.length > 253) {
      setValidation(t("invalidDomain"));
      return;
    }
    setValidation("");
    void run(async () => {
      const start = performance.now();
      // Keep the previous result mounted while the new query runs: clearing it
      // first collapsed the card and made the whole section flicker.
      const { data } = await client.queryDNS(
        new URL(`https://${name}`).hostname,
        type,
      );
      setDnsResult({
        dns: data,
        elapsed: Math.round(performance.now() - start),
        name,
        type,
      });
    }, false);
  }

  async function runDoctor() {
    if (!localClient) return;
    setDoctorRunning(true);
    setDoctorError("");
    try {
      const rep = (await localClient.runDoctor()) as DoctorReportData;
      setDoctorReport(rep);
    } catch (error) {
      // 失敗與「未曾執行」必須分開呈現，否則 daemon 中斷時卡片回到空白提示。
      setDoctorError(errorKind(error));
    } finally {
      setDoctorRunning(false);
    }
  }

  async function exportBugReport() {
    if (!localClient) return;
    void run(async () => {
      const result = await localClient.getBugReport();
      const objectURL = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = objectURL;
      a.download = "xbond-bugreport.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
    }, false);
  }

  return (
    <div className="page gap-6">
      <Header title={t("title")} />

      {/* Card 1: Website connectivity */}
      <section className="rounded-card border border-border bg-card p-6 shadow-elevation-card">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
            <Globe size={20} aria-hidden="true" />
            {t("connectivity.title")}
          </h2>
          <div className="flex items-center gap-2.5">
            {(() => {
              const tally = tallySites(
                DEFAULT_SITES.map((site) => site.id),
                siteTesting,
                siteDelays,
              );
              return tally.ok + tally.failed > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("summary", tally)}
                </span>
              ) : null;
            })()}
            <span className="text-xs text-muted-foreground">
              {t("testNode", { name: targetProxy })}
            </span>
            <Button
              disabled={Object.values(siteTesting).some(Boolean)}
              onClick={() => void testAllSites(DEFAULT_SITES)}
            >
              {t("connectivity.testAll")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          {DEFAULT_SITES.map((site) => {
            const badge = pingBadge(siteTesting[site.id], siteDelays[site.id], {
              pending: "—",
              testing: t("connectivity.testing"),
              failed: t("connectivity.timeoutFailed"),
            });

            return (
              <div
                key={site.id}
                className="flex flex-col justify-between gap-3 rounded-control border border-border bg-inset p-4 transition-colors duration-150 hover:border-brand/40 motion-reduce:transition-none"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {t(`connectivity.sites.${site.id}.name` as const)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t(`connectivity.sites.${site.id}.desc` as const)}
                    </div>
                  </div>
                  <span className={cn(badgeBase, badgeClass[badge.cls])}>
                    {badge.text}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span
                    className="max-w-[140px] truncate font-mono text-xs text-muted-foreground"
                    title={site.url}
                  >
                    {site.url.replace(/^https?:\/\//, "")}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!siteTesting[site.id]}
                    onClick={() => void testSite(site)}
                  >
                    {t("connectivity.test")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Card 2: Streaming services */}
      <section className="rounded-card border border-border bg-card p-6 shadow-elevation-card">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
            <MonitorPlay size={20} aria-hidden="true" />
            {t("stream.title")}
          </h2>
          <div className="flex items-center gap-2.5">
            {(() => {
              const tally = tallySites(
                STREAM_SERVICES.map((site) => site.id),
                siteTesting,
                siteDelays,
              );
              return tally.ok + tally.failed > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("summary", tally)}
                </span>
              ) : null;
            })()}
            <span className="text-xs text-muted-foreground">
              {t("testNode", { name: targetProxy })}
            </span>
            <Button
              disabled={Object.values(siteTesting).some(Boolean)}
              onClick={() => void testAllSites(STREAM_SERVICES)}
            >
              {t("stream.testAll")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          {STREAM_SERVICES.map((site) => {
            const badge = pingBadge(siteTesting[site.id], siteDelays[site.id], {
              pending: t("stream.pending"),
              testing: t("stream.testing"),
              failed: t("stream.failed"),
            });

            return (
              <div
                key={site.id}
                className="flex flex-col justify-between gap-3 rounded-control border border-border bg-inset p-4 transition-colors duration-150 hover:border-brand/40 motion-reduce:transition-none"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {t(`stream.services.${site.id}.name` as const)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t(`stream.services.${site.id}.desc` as const)}
                    </div>
                  </div>
                  <span className={cn(badgeBase, badgeClass[badge.cls])}>
                    {badge.text}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span
                    className="max-w-[140px] truncate font-mono text-xs text-muted-foreground"
                    title={site.url}
                  >
                    {site.url.replace(/^https?:\/\//, "")}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!siteTesting[site.id]}
                    onClick={() => void testSite(site)}
                  >
                    {t("stream.testOne")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">{t("stream.note")}</p>
      </section>

      {/* Card 3: DNS lookup and cache */}
      <section className="rounded-card border border-border bg-card p-6 shadow-elevation-card">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
            <Server size={20} aria-hidden="true" />
            {t("dnsSection")}
          </h2>
        </div>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            queryDNS();
          }}
        >
          <label className="flex min-w-[200px] flex-[1_1_260px] flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            {t("domain")}
            <Input
              aria-label={t("domain")}
              aria-invalid={Boolean(validation)}
              value={domain}
              placeholder="example.com"
              onChange={(e) => {
                setValidation("");
                setDomain(e.target.value);
              }}
              disabled={pending}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            {t("type")}
            <select
              className="h-[34px] rounded-sm border border-border bg-card px-3 text-body text-foreground"
              value={type}
              disabled={pending}
              onChange={(event) => setType(event.target.value)}
            >
              {[
                "A",
                "AAAA",
                "CNAME",
                "MX",
                "TXT",
                "NS",
                "SOA",
                "PTR",
                "HTTPS",
                "SRV",
                "CAA",
              ].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            className="h-[34px]"
            disabled={pending || !caps.dns}
            type="submit"
          >
            {t("query")}
          </Button>
        </form>

        {validation && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {validation}
          </p>
        )}

        {dnsResult && (
          <div
            aria-live="polite"
            aria-busy={pending}
            className={cn(
              "mt-5 transition-opacity duration-150 motion-reduce:transition-none",
              pending && "opacity-55",
            )}
          >
            <div className="flex flex-wrap items-end gap-6">
              <span className="font-mono text-xs text-muted-foreground">
                {dnsResult.name} · {dnsResult.type}
              </span>
              <Stat label={t("elapsed")}>{dnsResult.elapsed} ms</Stat>
              <Stat label={t("response")}>
                {responseCodes[dnsResult.dns.Status] ?? dnsResult.dns.Status}
              </Stat>
            </div>
            {dnsResult.dns.Answer?.length ? (
              <div className="mt-4 overflow-x-auto rounded-sm border border-border">
                <table className="w-full border-collapse text-left text-body [&_td]:border-b [&_td]:border-border [&_td]:px-3.5 [&_td]:py-2.5 [&_th]:border-b [&_th]:border-border [&_th]:bg-inset [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:text-muted-foreground [&_tr:last-child_td]:border-b-0">
                  <thead>
                    <tr>
                      <th>{t("domain")}</th>
                      <th>{t("type")}</th>
                      <th>{t("ttl")}</th>
                      <th>{t("data")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnsResult.dns.Answer.map((record, index) => (
                      <tr key={index}>
                        <td className="font-mono">{record.name}</td>
                        <td className="tabular-nums">{record.type}</td>
                        <td className="tabular-nums">{record.TTL}</td>
                        <td className="break-all font-mono">{record.data}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("noRecords")}
              </p>
            )}
          </div>
        )}

        {caps.flushCache && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-label text-muted-foreground">
              {t("cacheNote")}
            </div>
            <div className="flex gap-2.5">
              <Button disabled={pending} onClick={() => setClear("dns")}>
                {t("flushDNS")}
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => setClear("fakeip")}
              >
                {t("flushFakeIP")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Card 4: Self-check report */}
      <section className="rounded-card border border-border bg-card p-6 shadow-elevation-card">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
            <Stethoscope size={20} aria-hidden="true" />
            {t("doctor.title")}
          </h2>
          <div className="flex items-center gap-2.5">
            <Button
              disabled={!localClient || doctorRunning}
              onClick={() => void runDoctor()}
            >
              {doctorRunning ? t("doctor.running") : t("doctor.runBtn")}
            </Button>
            <Button
              disabled={!localClient || pending}
              onClick={() => void exportBugReport()}
            >
              {t("doctor.exportBugreport")}
            </Button>
          </div>
        </div>

        {!hasLocalAPI ? (
          <p className="text-sm text-muted-foreground">
            {t("doctor.remoteNote")}
          </p>
        ) : doctorError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-control border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text"
          >
            <span>{tr(doctorError)}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={doctorRunning}
              onClick={() => void runDoctor()}
            >
              {tc("retry")}
            </Button>
          </div>
        ) : doctorReport ? (
          <div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
              {/* Box 1: Three-tier status */}
              <div className="flex flex-col gap-3 rounded-control border border-border bg-inset p-4">
                <div className="flex items-center justify-between text-body font-semibold">
                  <span>{t("doctor.threeTier")}</span>
                  <span
                    className={cn(
                      pillBase,
                      doctorReport.threeTier.coreReachable &&
                        doctorReport.threeTier.trafficIntercepted
                        ? pillClass.pass
                        : pillClass.warn,
                    )}
                  >
                    {!doctorReport.threeTier.coreReachable
                      ? t("doctor.coreError")
                      : doctorReport.threeTier.trafficIntercepted
                        ? t("doctor.coreOK")
                        : t("doctor.coreNotIntercepted")}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.takeover")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.threeTier.trafficIntercepted
                        ? t("doctor.takeoverActive", {
                            mode: doctorReport.threeTier.takeoverMode,
                          })
                        : t("doctor.takeoverInactive")}
                    </strong>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{tc("routingMode.title")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.threeTier.routingMode}
                    </strong>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.egress")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.threeTier.egressVerified
                        ? t("doctor.egressReachable", {
                            ms: doctorReport.threeTier.egressLatencyMs,
                          })
                        : t("doctor.egressUnverified")}
                    </strong>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.chain")}</span>
                    <strong className="text-right font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.threeTier.strategyChain?.join(" → ") || "—"}
                    </strong>
                  </li>
                  {doctorReport.threeTier.interceptNote && (
                    <li className="text-muted-foreground [overflow-wrap:anywhere]">
                      {doctorReport.threeTier.interceptNote}
                    </li>
                  )}
                </ul>
              </div>

              {/* Box 2: DNS resolution */}
              <div className="flex flex-col gap-3 rounded-control border border-border bg-inset p-4">
                <div className="flex items-center justify-between text-body font-semibold">
                  <span>{t("doctor.dnsCheck")}</span>
                  <span
                    className={cn(
                      pillBase,
                      doctorReport.dns.proxyDnsSuccess
                        ? pillClass.pass
                        : pillClass.fail,
                    )}
                  >
                    {doctorReport.dns.proxyDnsSuccess
                      ? t("doctor.dnsOK")
                      : t("doctor.dnsError")}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.localDNS")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.dns.localDnsSuccess
                        ? t("doctor.ok")
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.proxyDNS")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.dns.proxyDnsSuccess
                        ? t("doctor.ok")
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  {doctorReport.dns.localIPs && (
                    <li className="flex justify-between gap-2 text-muted-foreground">
                      <span>{t("doctor.localIP")}</span>
                      <strong className="font-mono text-xs font-medium text-foreground [overflow-wrap:anywhere]">
                        {doctorReport.dns.localIPs}
                      </strong>
                    </li>
                  )}
                  {doctorReport.dns.proxyIPs && (
                    <li className="flex justify-between gap-2 text-muted-foreground">
                      <span>{t("doctor.proxyIP")}</span>
                      <strong className="font-mono text-xs font-medium text-foreground [overflow-wrap:anywhere]">
                        {doctorReport.dns.proxyIPs}
                      </strong>
                    </li>
                  )}
                  {doctorReport.dns.error && (
                    <li className="text-destructive-text [overflow-wrap:anywhere]">
                      {doctorReport.dns.error}
                    </li>
                  )}
                </ul>
              </div>

              {/* Box 3: Egress comparison */}
              <div className="flex flex-col gap-3 rounded-control border border-border bg-inset p-4">
                <div className="flex items-center justify-between text-body font-semibold">
                  <span>{t("doctor.egressCompare")}</span>
                  <span
                    className={cn(
                      pillBase,
                      doctorReport.egress.proxySuccess
                        ? pillClass.pass
                        : pillClass.fail,
                    )}
                  >
                    {doctorReport.egress.proxySuccess
                      ? t("doctor.egressOK")
                      : t("doctor.egressBlocked")}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.directEgress")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.egress.directSuccess
                        ? `${doctorReport.egress.directLatencyMs} ms`
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.egress")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.egress.proxySuccess
                        ? `${doctorReport.egress.proxyLatencyMs} ms`
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  {doctorReport.egress.error && (
                    <li className="flex justify-between gap-2 text-muted-foreground">
                      <span>{t("doctor.errorDetail")}</span>
                      <strong className="font-medium text-destructive [overflow-wrap:anywhere]">
                        {doctorReport.egress.error}
                      </strong>
                    </li>
                  )}
                </ul>
              </div>

              {/* Box 4: Gateway health */}
              <div className="flex flex-col gap-3 rounded-control border border-border bg-inset p-4">
                <div className="flex items-center justify-between text-body font-semibold">
                  <span>{t("doctor.gatewayHealth")}</span>
                  <span
                    className={cn(
                      pillBase,
                      doctorReport.gateway.primaryHealthy
                        ? pillClass.pass
                        : pillClass.warn,
                    )}
                  >
                    {doctorReport.gateway.primaryHealthy
                      ? t("doctor.gatewayHealthy")
                      : t("doctor.gatewayDegraded")}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.primaryServer")}</span>
                    <strong className="max-w-[160px] truncate font-mono text-xs font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.gateway.primaryOrigin || "—"}
                    </strong>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.fallbackServer")}</span>
                    <strong className="font-medium text-foreground [overflow-wrap:anywhere]">
                      {doctorReport.gateway.fallbackOrigins?.length
                        ? t("doctor.fallbackCount", {
                            count: doctorReport.gateway.fallbackOrigins.length,
                          })
                        : t("doctor.noFallback")}
                    </strong>
                  </li>
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>{t("doctor.checkedAt")}</span>
                    <strong className="text-xs font-medium text-foreground [overflow-wrap:anywhere]">
                      {new Date(doctorReport.timestamp).toLocaleTimeString()}
                    </strong>
                  </li>
                </ul>
              </div>
            </div>

            <details className="mt-4 text-xs text-muted-foreground">
              <summary className="mb-2 cursor-pointer text-brand-text">
                {t("doctor.viewRaw")}
              </summary>
              <pre className="max-h-60 overflow-auto rounded-sm border border-border bg-inset p-3 font-mono text-label">
                {JSON.stringify(doctorReport, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("doctor.emptyPrompt")}
          </p>
        )}
      </section>

      <Dialog
        open={!!clear}
        onOpenChange={(open) => {
          if (!open && !pending) setClear(null);
        }}
      >
        <DialogContent closeLabel={tc("close")} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("cache")}</DialogTitle>
          </DialogHeader>
          <div>{clear === "dns" ? t("confirmDNS") : t("confirmFakeIP")}</div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setClear(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if (clear)
                  void run(async () => {
                    await client.flushCache(clear);
                    setClear(null);
                  });
              }}
            >
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
