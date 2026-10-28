import { Button, Card, Header, Input, Modal } from "@components";
import { useAction } from "@lib/actions";
import type { DNSResult } from "@lib/request";
import { useCapabilities, useClient, useI18n } from "@stores";
import { useState } from "react";

const responseCodes: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};
export default function Diagnostics() {
  const { translation } = useI18n();
  const { t } = translation("Diagnostics");
  const { t: r } = translation("Runtime");
  const client = useClient();
  const caps = useCapabilities();
  const { run, pending } = useAction();
  const [domain, setDomain] = useState("");
  const [type, setType] = useState("A");
  const [validation, setValidation] = useState("");
  const [result, setResult] = useState<{
    dns: DNSResult;
    elapsed: number;
    name: string;
    type: string;
  } | null>(null);
  const [clear, setClear] = useState<"dns" | "fakeip" | null>(null);
  function query() {
    const name = domain.trim();
    if (!name || /[\s/:?#@]/.test(name) || name.length > 253) {
      setValidation(t("invalidDomain"));
      return;
    }
    setValidation("");
    void run(async () => {
      const start = performance.now();
      setResult(null);
      const { data } = await client.queryDNS(
        new URL(`https://${name}`).hostname,
        type,
      );
      setResult({
        dns: data,
        elapsed: Math.round(performance.now() - start),
        name,
        type,
      });
    }, false);
  }
  return (
    <div className="page">
      <Header title={t("title")} />
      <Card className="mt-3">
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            query();
          }}
        >
          <label className="flex min-w-45 flex-1 flex-col gap-2 text-sm">
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
          <label className="flex flex-col gap-2 text-sm">
            {t("type")}
            <select
              className="input h-8 px-3"
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
            className={`button button-primary ${pending || !caps.dns ? "button-disabled" : ""}`}
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
      </Card>
      {result && (
        <div aria-live="polite" className="mt-6">
          <p className="mb-4 flex flex-wrap gap-4 font-mono text-sm tabular-nums">
            <span>
              {result.name} · {result.type}
            </span>
            <span>
              {t("elapsed")}: {result.elapsed} ms
            </span>
            <span>
              {t("response")}:{" "}
              {responseCodes[result.dns.Status] ?? result.dns.Status}
            </span>
          </p>
          {(
            [
              ["answer", result.dns.Answer],
              ["authority", result.dns.Authority],
              ["additional", result.dns.Additional],
            ] as const
          ).map(([label, records]) =>
            records?.length ? (
              <section key={label} className="mb-6">
                <h2 className="mb-3 font-semibold">{t(label)}</h2>
                <Card className="overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">{t("domain")}</th>
                        <th className="p-2">{t("type")}</th>
                        <th className="p-2">{t("ttl")}</th>
                        <th className="p-2">{t("data")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record, index) => (
                        <tr key={index} className="border-t border-border">
                          <td className="p-2 font-mono">{record.name}</td>
                          <td className="p-2 tabular-nums">{record.type}</td>
                          <td className="p-2 tabular-nums">{record.TTL}</td>
                          <td className="p-2 break-all font-mono">
                            {record.data}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </section>
            ) : null,
          )}
          {!result.dns.Answer?.length && (
            <p className="text-sm text-muted-foreground">{t("noRecords")}</p>
          )}
        </div>
      )}
      {caps.flushCache && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold">{t("cache")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t("cacheNote")}</p>
          <div className="flex flex-wrap gap-3">
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
        </section>
      )}
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
