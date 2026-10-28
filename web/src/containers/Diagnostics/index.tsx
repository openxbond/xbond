import { Button, Header, Input, Modal } from "@components";
import { useAction } from "@lib/actions";
import type { DNSResult } from "@lib/request";
import {
  useCapabilities,
  useClient,
  useGeneral,
  useI18n,
  useLocalAPI,
  useProxy,
} from "@stores";
import { useState } from "react";

import "./style.scss";

interface BenchmarkSite {
  name: string;
  url: string;
  desc: string;
}

const DEFAULT_SITES: BenchmarkSite[] = [
  {
    name: "Google 204",
    url: "https://www.gstatic.com/generate_204",
    desc: "Google 核心連線探針",
  },
  {
    name: "Cloudflare",
    url: "https://cp.cloudflare.com/generate_204",
    desc: "Cloudflare 邊緣節點",
  },
  {
    name: "Apple Captive",
    url: "https://captive.apple.com/hotspot-detect.html",
    desc: "Apple 閘道可達性測試",
  },
  {
    name: "GitHub API",
    url: "https://api.github.com",
    desc: "GitHub 開發者介面",
  },
];

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
  const { translation } = useI18n();
  const { t } = translation("Diagnostics");
  const { t: r } = translation("Runtime");
  const { t: ui } = translation("ClientUI");
  const { t: set } = translation("Settings");

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
    setSiteTesting((prev) => ({ ...prev, [site.name]: true }));
    try {
      const res = await client.getProxyDelay(targetProxy, site.url, 5000);
      setSiteDelays((prev) => ({ ...prev, [site.name]: res.data.delay }));
    } catch {
      setSiteDelays((prev) => ({ ...prev, [site.name]: -1 }));
    } finally {
      setSiteTesting((prev) => ({ ...prev, [site.name]: false }));
    }
  }

  async function testAllSites() {
    await Promise.all(DEFAULT_SITES.map((site) => testSite(site)));
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

      {/* Card 1: 常用網站連通性測速 */}
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
            常用網站連通性測速
          </h2>
          <div className="diag-header-actions">
            <span className="text-xs text-muted-foreground">
              測試節點: <strong>{targetProxy}</strong>
            </span>
            <Button
              disabled={Object.values(siteTesting).some(Boolean)}
              onClick={() => void testAllSites()}
            >
              全部測速
            </Button>
          </div>
        </div>

        <div className="site-pings-grid">
          {DEFAULT_SITES.map((site) => {
            const isTesting = siteTesting[site.name];
            const delay = siteDelays[site.name];
            let badgeClass = "untested";
            let badgeText = "—";

            if (isTesting) {
              badgeClass = "untested";
              badgeText = "測速中…";
            } else if (delay !== undefined) {
              if (delay < 0) {
                badgeClass = "error";
                badgeText = "逾時 / 失敗";
              } else if (delay < 300) {
                badgeClass = "good";
                badgeText = `${delay} ms`;
              } else if (delay < 700) {
                badgeClass = "medium";
                badgeText = `${delay} ms`;
              } else {
                badgeClass = "slow";
                badgeText = `${delay} ms`;
              }
            }

            return (
              <div key={site.name} className="site-ping-card">
                <div className="site-ping-header">
                  <div>
                    <div className="site-ping-name">{site.name}</div>
                    <div className="site-ping-desc">{site.desc}</div>
                  </div>
                  <span className={`ping-badge ${badgeClass}`}>
                    {badgeText}
                  </span>
                </div>
                <div className="site-ping-footer">
                  <span className="text-xs font-mono text-muted-foreground truncate max-w-[140px]">
                    {site.url.replace(/^https?:\/\//, "")}
                  </span>
                  <Button
                    disabled={isTesting}
                    onClick={() => void testSite(site)}
                  >
                    測速
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Card 2: DNS 查詢與快取刷新 */}
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
            DNS 查詢與快取維護
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
            {pending ? r("loading") : t("query")}
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

      {/* Card 3: XBond Doctor 結構化自檢報告 */}
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
            {set("doctor.title")}
          </h2>
          <div className="diag-header-actions">
            <Button
              disabled={!localClient || doctorRunning}
              onClick={() => void runDoctor()}
            >
              {doctorRunning ? set("doctor.running") : set("doctor.runBtn")}
            </Button>
            <Button
              disabled={!localClient || pending}
              onClick={() => void exportBugReport()}
            >
              {set("doctor.exportBugreport")}
            </Button>
          </div>
        </div>

        {!hasLocalAPI ? (
          <p className="text-sm text-muted-foreground">{ui("readonly")}</p>
        ) : doctorReport ? (
          <div>
            <div className="doctor-grid">
              {/* Box 1: 三層連線狀態 */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>三層連線狀態</span>
                  <span
                    className={`status-pill ${
                      doctorReport.threeTier.coreReachable &&
                      doctorReport.threeTier.trafficIntercepted
                        ? "pass"
                        : "warn"
                    }`}
                  >
                    {doctorReport.threeTier.coreReachable
                      ? "核心正常"
                      : "核心異常"}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>流量接管</span>
                    <strong>
                      {doctorReport.threeTier.trafficIntercepted
                        ? `已接管 (${doctorReport.threeTier.takeoverMode})`
                        : "未接管"}
                    </strong>
                  </li>
                  <li>
                    <span>分流模式</span>
                    <strong>{doctorReport.threeTier.routingMode}</strong>
                  </li>
                  <li>
                    <span>代理出口</span>
                    <strong>
                      {doctorReport.threeTier.egressVerified
                        ? `可達 (${doctorReport.threeTier.egressLatencyMs} ms)`
                        : "未驗證"}
                    </strong>
                  </li>
                  <li>
                    <span>鏈路</span>
                    <strong className="text-right">
                      {doctorReport.threeTier.strategyChain?.join(" → ") || "—"}
                    </strong>
                  </li>
                </ul>
              </div>

              {/* Box 2: DNS 解析檢驗 */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>DNS 解析檢驗</span>
                  <span
                    className={`status-pill ${
                      doctorReport.dns.proxyDnsSuccess ? "pass" : "fail"
                    }`}
                  >
                    {doctorReport.dns.proxyDnsSuccess ? "解析正常" : "解析異常"}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>本機 DNS</span>
                    <strong>
                      {doctorReport.dns.localDnsSuccess ? "正常" : "失敗"}
                    </strong>
                  </li>
                  <li>
                    <span>代理 DNS</span>
                    <strong>
                      {doctorReport.dns.proxyDnsSuccess ? "正常" : "失敗"}
                    </strong>
                  </li>
                  {doctorReport.dns.localIPs && (
                    <li>
                      <span>本地解析 IP</span>
                      <strong className="font-mono text-xs">
                        {doctorReport.dns.localIPs}
                      </strong>
                    </li>
                  )}
                  {doctorReport.dns.proxyIPs && (
                    <li>
                      <span>代理解析 IP</span>
                      <strong className="font-mono text-xs">
                        {doctorReport.dns.proxyIPs}
                      </strong>
                    </li>
                  )}
                </ul>
              </div>

              {/* Box 3: 出口對比檢驗 */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>出口對比檢驗</span>
                  <span
                    className={`status-pill ${
                      doctorReport.egress.proxySuccess ? "pass" : "fail"
                    }`}
                  >
                    {doctorReport.egress.proxySuccess ? "出口暢通" : "出口中斷"}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>直連出口</span>
                    <strong>
                      {doctorReport.egress.directSuccess
                        ? `${doctorReport.egress.directLatencyMs} ms`
                        : "失敗"}
                    </strong>
                  </li>
                  <li>
                    <span>代理出口</span>
                    <strong>
                      {doctorReport.egress.proxySuccess
                        ? `${doctorReport.egress.proxyLatencyMs} ms`
                        : "失敗"}
                    </strong>
                  </li>
                  {doctorReport.egress.error && (
                    <li>
                      <span>異常詳情</span>
                      <strong className="text-destructive">
                        {doctorReport.egress.error}
                      </strong>
                    </li>
                  )}
                </ul>
              </div>

              {/* Box 4: 閘道伺服器健康度 */}
              <div className="doctor-box">
                <div className="doctor-box-title">
                  <span>閘道伺服器健康度</span>
                  <span
                    className={`status-pill ${
                      doctorReport.gateway.primaryHealthy ? "pass" : "warn"
                    }`}
                  >
                    {doctorReport.gateway.primaryHealthy
                      ? "閘道健康"
                      : "連線降級"}
                  </span>
                </div>
                <ul className="doctor-box-list">
                  <li>
                    <span>主要伺服器</span>
                    <strong className="font-mono text-xs truncate max-w-[160px]">
                      {doctorReport.gateway.primaryOrigin || "—"}
                    </strong>
                  </li>
                  <li>
                    <span>備用伺服器</span>
                    <strong>
                      {doctorReport.gateway.fallbackOrigins?.length
                        ? `${doctorReport.gateway.fallbackOrigins.length} 個備用節點`
                        : "無備用節點"}
                    </strong>
                  </li>
                  <li>
                    <span>檢測時間</span>
                    <strong className="text-xs">
                      {new Date(doctorReport.timestamp).toLocaleTimeString()}
                    </strong>
                  </li>
                </ul>
              </div>
            </div>

            <details className="doctor-details-raw">
              <summary>查看完整脫敏自檢資料 (JSON)</summary>
              <pre className="doctor-raw-pre">
                {JSON.stringify(doctorReport, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            點選「一鍵自檢」開始對核心、接管、DNS 及代理出口進行全面體檢。
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
