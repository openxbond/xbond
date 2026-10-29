import { Button, Header, Input, Modal } from "@components";
import { useAction } from "@lib/actions";
import {
  useCapabilities,
  useClient,
  useGeneral,
  useLocalAPI,
  useProxy,
} from "@stores";
import type { DNSResult } from "@xbond/client/request";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import "./style.scss";

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
      setDnsResult(null);
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
    try {
      const rep = (await localClient.runDoctor()) as DoctorReportData;
      setDoctorReport(rep);
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
    <div className="page diagnostics-page">
      <Header title={t("title")} />

      {/* Card 1: Website connectivity */}
      <section className="diag-card">
        <div className="diag-header">
          <h2>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m12 6 3 6-6 2 3-8Z" />
            </svg>
            {t("connectivity.title")}
          </h2>
          <div className="diag-header-actions">
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

        <div className="site-pings-grid">
          {DEFAULT_SITES.map((site) => {
            const badge = pingBadge(siteTesting[site.id], siteDelays[site.id], {
              pending: "—",
              testing: t("connectivity.testing"),
              failed: t("connectivity.timeoutFailed"),
            });

            return (
              <div key={site.id} className="site-ping-card">
                <div className="site-ping-header">
                  <div>
                    <div className="site-ping-name">
                      {t(`connectivity.sites.${site.id}.name` as const)}
                    </div>
                    <div className="site-ping-desc">
                      {t(`connectivity.sites.${site.id}.desc` as const)}
                    </div>
                  </div>
                  <span className={`ping-badge ${badge.cls}`}>
                    {badge.text}
                  </span>
                </div>
                <div className="site-ping-footer">
                  <span className="text-xs font-mono text-muted-foreground truncate max-w-[140px]">
                    {site.url.replace(/^https?:\/\//, "")}
                  </span>
                  <Button
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
      <section className="diag-card">
        <div className="diag-header">
          <h2>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m10 8 6 4-6 4V8Z" />
            </svg>
            {t("stream.title")}
          </h2>
          <div className="diag-header-actions">
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

        <div className="site-pings-grid">
          {STREAM_SERVICES.map((site) => {
            const badge = pingBadge(siteTesting[site.id], siteDelays[site.id], {
              pending: t("stream.pending"),
              testing: t("stream.testing"),
              failed: t("stream.failed"),
            });

            return (
              <div key={site.id} className="site-ping-card">
                <div className="site-ping-header">
                  <div>
                    <div className="site-ping-name">
                      {t(`stream.services.${site.id}.name` as const)}
                    </div>
                    <div className="site-ping-desc">
                      {t(`stream.services.${site.id}.desc` as const)}
                    </div>
                  </div>
                  <span className={`ping-badge ${badge.cls}`}>
                    {badge.text}
                  </span>
                </div>
                <div className="site-ping-footer">
                  <span className="text-xs font-mono text-muted-foreground truncate max-w-[140px]">
                    {site.url.replace(/^https?:\/\//, "")}
                  </span>
                  <Button
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

        <p className="stream-note">{t("stream.note")}</p>
      </section>

      {/* Card 3: DNS lookup and cache */}
      <section className="diag-card">
        <div className="diag-header">
          <h2>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            {t("dnsSection")}
          </h2>
        </div>

        <form
          className="dns-form"
          onSubmit={(event) => {
            event.preventDefault();
            queryDNS();
          }}
        >
          <label className="dns-field flex-1 min-w-[200px]">
            {t("domain")}
            <Input
              aria-label={t("domain")}
              align="left"
              value={domain}
              placeholder="example.com"
              onChange={setDomain}
              disabled={pending}
            />
          </label>
          <label className="dns-field">
            {t("type")}
            <select
              className="dns-select"
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
          <button
            className={`button button-brand ${pending || !caps.dns ? "button-disabled" : ""}`}
            disabled={pending || !caps.dns}
            type="submit"
          >
            {pending ? tc("loading") : t("query")}
          </button>
        </form>

        {validation && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {validation}
          </p>
        )}

        {dnsResult && (
          <div aria-live="polite" className="mt-5">
            <p className="mb-3 flex flex-wrap gap-4 font-mono text-sm tabular-nums">
              <span>
                {dnsResult.name} · {dnsResult.type}
              </span>
              <span>
                {t("elapsed")}: {dnsResult.elapsed} ms
              </span>
              <span>
                {t("response")}:{" "}
                {responseCodes[dnsResult.dns.Status] ?? dnsResult.dns.Status}
              </span>
            </p>
            {dnsResult.dns.Answer?.length ? (
              <div className="dns-results-table">
                <table className="dns-table">
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
              <p className="text-sm text-muted-foreground">{t("noRecords")}</p>
            )}
          </div>
        )}

        {caps.flushCache && (
          <div className="cache-flush-group">
            <div className="cache-flush-desc">{t("cacheNote")}</div>
            <div className="cache-flush-actions">
              <Button disabled={pending} onClick={() => setClear("dns")}>
                {t("flushDNS")}
              </Button>
              <Button
                type="danger"
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
      <section className="diag-card">
        <div className="diag-header">
          <h2>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            {t("doctor.title")}
          </h2>
          <div className="diag-header-actions">
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
        ) : doctorReport ? (
          <div>
            <div className="doctor-grid">
              {/* Box 1: Three-tier status */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>{t("doctor.threeTier")}</span>
                  <span
                    className={`status-pill ${
                      doctorReport.threeTier.coreReachable &&
                      doctorReport.threeTier.trafficIntercepted
                        ? "pass"
                        : "warn"
                    }`}
                  >
                    {doctorReport.threeTier.coreReachable
                      ? t("doctor.coreOK")
                      : t("doctor.coreError")}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>{t("doctor.takeover")}</span>
                    <strong>
                      {doctorReport.threeTier.trafficIntercepted
                        ? t("doctor.takeoverActive", {
                            mode: doctorReport.threeTier.takeoverMode,
                          })
                        : t("doctor.takeoverInactive")}
                    </strong>
                  </li>
                  <li>
                    <span>{tc("routingMode.title")}</span>
                    <strong>{doctorReport.threeTier.routingMode}</strong>
                  </li>
                  <li>
                    <span>{t("doctor.egress")}</span>
                    <strong>
                      {doctorReport.threeTier.egressVerified
                        ? t("doctor.egressReachable", {
                            ms: doctorReport.threeTier.egressLatencyMs,
                          })
                        : t("doctor.egressUnverified")}
                    </strong>
                  </li>
                  <li>
                    <span>{t("doctor.chain")}</span>
                    <strong className="text-right">
                      {doctorReport.threeTier.strategyChain?.join(" → ") || "—"}
                    </strong>
                  </li>
                </ul>
              </div>

              {/* Box 2: DNS resolution */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>{t("doctor.dnsCheck")}</span>
                  <span
                    className={`status-pill ${
                      doctorReport.dns.proxyDnsSuccess ? "pass" : "fail"
                    }`}
                  >
                    {doctorReport.dns.proxyDnsSuccess
                      ? t("doctor.dnsOK")
                      : t("doctor.dnsError")}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>{t("doctor.localDNS")}</span>
                    <strong>
                      {doctorReport.dns.localDnsSuccess
                        ? t("doctor.ok")
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  <li>
                    <span>{t("doctor.proxyDNS")}</span>
                    <strong>
                      {doctorReport.dns.proxyDnsSuccess
                        ? t("doctor.ok")
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  {doctorReport.dns.localIPs && (
                    <li>
                      <span>{t("doctor.localIP")}</span>
                      <strong className="font-mono text-xs">
                        {doctorReport.dns.localIPs}
                      </strong>
                    </li>
                  )}
                  {doctorReport.dns.proxyIPs && (
                    <li>
                      <span>{t("doctor.proxyIP")}</span>
                      <strong className="font-mono text-xs">
                        {doctorReport.dns.proxyIPs}
                      </strong>
                    </li>
                  )}
                </ul>
              </div>

              {/* Box 3: Egress comparison */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>{t("doctor.egressCompare")}</span>
                  <span
                    className={`status-pill ${
                      doctorReport.egress.proxySuccess ? "pass" : "fail"
                    }`}
                  >
                    {doctorReport.egress.proxySuccess
                      ? t("doctor.egressOK")
                      : t("doctor.egressBlocked")}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>{t("doctor.directEgress")}</span>
                    <strong>
                      {doctorReport.egress.directSuccess
                        ? `${doctorReport.egress.directLatencyMs} ms`
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  <li>
                    <span>{t("doctor.egress")}</span>
                    <strong>
                      {doctorReport.egress.proxySuccess
                        ? `${doctorReport.egress.proxyLatencyMs} ms`
                        : t("doctor.failed")}
                    </strong>
                  </li>
                  {doctorReport.egress.error && (
                    <li>
                      <span>{t("doctor.errorDetail")}</span>
                      <strong className="text-destructive">
                        {doctorReport.egress.error}
                      </strong>
                    </li>
                  )}
                </ul>
              </div>

              {/* Box 4: Gateway health */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>{t("doctor.gatewayHealth")}</span>
                  <span
                    className={`status-pill ${
                      doctorReport.gateway.primaryHealthy ? "pass" : "warn"
                    }`}
                  >
                    {doctorReport.gateway.primaryHealthy
                      ? t("doctor.gatewayHealthy")
                      : t("doctor.gatewayDegraded")}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>{t("doctor.primaryServer")}</span>
                    <strong className="font-mono text-xs truncate max-w-[160px]">
                      {doctorReport.gateway.primaryOrigin || "—"}
                    </strong>
                  </li>
                  <li>
                    <span>{t("doctor.fallbackServer")}</span>
                    <strong>
                      {doctorReport.gateway.fallbackOrigins?.length
                        ? t("doctor.fallbackCount", {
                            count: doctorReport.gateway.fallbackOrigins.length,
                          })
                        : t("doctor.noFallback")}
                    </strong>
                  </li>
                  <li>
                    <span>{t("doctor.checkedAt")}</span>
                    <strong className="text-xs">
                      {new Date(doctorReport.timestamp).toLocaleTimeString()}
                    </strong>
                  </li>
                </ul>
              </div>
            </div>

            <details className="doctor-details-raw">
              <summary>{t("doctor.viewRaw")}</summary>
              <pre className="doctor-raw-pre">
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

      <Modal
        show={!!clear}
        title={t("cache")}
        pending={pending}
        onClose={() => setClear(null)}
        onOk={() => {
          if (clear)
            void run(async () => {
              await client.flushCache(clear);
              setClear(null);
            });
        }}
      >
        {clear === "dns" ? t("confirmDNS") : t("confirmFakeIP")}
      </Modal>
    </div>
  );
}
