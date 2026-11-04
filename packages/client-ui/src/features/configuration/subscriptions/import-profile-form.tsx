import { subscriptionLang } from "@xbond/client/localapi";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ButtonSelect } from "@/components/button-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useLocalAPI } from "@/state/local-runtime";
import { useLanguage } from "@/state/user-preferences";

import UpdateFrequency from "./update-frequency-field";
import { useSubscriptions } from "./use-subscriptions";

export default function ImportConfig({
  onAdded,
}: {
  onAdded: (id: string) => void;
}) {
  const { t } = useTranslation("onboarding");
  const { t: c } = useTranslation("configuration");
  const { t: s } = useTranslation("subscriptions");
  const { lang } = useLanguage();
  const { addSub } = useSubscriptions();
  const { hasDaemon, refresh } = useLocalAPI();
  const [mode, setMode] = useState<"url" | "file" | "paste">("url");
  const [url, setURL] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [updateIntervalHours, setUpdateIntervalHours] = useState(24);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !hasDaemon) return;
    setPending(true);
    setError("");
    try {
      if (mode === "url") {
        let parsed: URL;
        try {
          parsed = new URL(url.trim());
        } catch {
          throw new Error(t("invalidUrl"));
        }
        if (!["http:", "https:"].includes(parsed.protocol))
          throw new Error(t("invalidUrl"));
      }
      const result = await addSub({
        ...(mode === "url"
          ? { urlOrFile: url.trim(), updateIntervalHours }
          : { content: mode === "file" ? await file!.text() : content }),
        name: name.trim() || file?.name || undefined,
        lang: subscriptionLang(lang),
      });
      await refresh();
      if (result.updateError) {
        // 訂閱已寫入，只是首次更新失敗：不能當成整體失敗（重送會產生重複），
        // 直接進入詳情讓更新狀態與重試入口就位。
        if (result.meta) {
          toast.warning(t("addedUpdateFailed"), {
            description: result.updateError,
            duration: 8000,
          });
          onAdded(result.meta.id);
        } else {
          setError(result.updateError);
        }
        return;
      }
      if (result.meta) onAdded(result.meta.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }
  const valid =
    mode === "url" ? !!url.trim() : mode === "file" ? !!file : !!content.trim();
  return (
    <div className="config-detail-stack">
      <form
        className="flex max-w-2xl flex-col gap-5"
        onSubmit={submit}
        aria-busy={pending}
        aria-label={c("addProfile")}
      >
        <FieldGroup className="gap-5">
          <ButtonSelect<"url" | "file" | "paste">
            value={mode}
            options={[
              { value: "url", label: t("modeUrl") },
              { value: "file", label: t("modeFile") },
              { value: "paste", label: t("modePaste") },
            ]}
            onSelect={(value) => {
              setMode(value);
              setError("");
            }}
            disabled={pending}
          />
          <Field className="gap-2" data-disabled={pending}>
            <FieldLabel htmlFor="import-name">
              {s("namePlaceholder")}
            </FieldLabel>
            <Input
              id="import-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </Field>
          {mode === "url" && (
            <Field className="gap-2" data-disabled={pending}>
              <FieldLabel htmlFor="import-url">
                {t("urlPlaceholder")}
              </FieldLabel>
              <Input
                id="import-url"
                type="url"
                required
                value={url}
                onChange={(e) => setURL(e.target.value)}
                placeholder="https://"
                disabled={pending}
              />
            </Field>
          )}
          {mode === "file" && (
            <Field className="gap-2" data-disabled={pending}>
              <FieldLabel htmlFor="import-file">{t("chooseFile")}</FieldLabel>
              <Input
                id="import-file"
                type="file"
                accept=".json,.yaml,.yml,.conf,.txt"
                required
                disabled={pending}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          )}
          {mode === "url" && (
            <UpdateFrequency
              value={updateIntervalHours}
              onChange={setUpdateIntervalHours}
              disabled={pending}
            />
          )}
          {mode === "paste" && (
            <Field className="gap-2" data-disabled={pending}>
              <FieldLabel htmlFor="import-content">{t("modePaste")}</FieldLabel>
              <Textarea
                id="import-content"
                className="font-mono"
                rows={12}
                required
                value={content}
                disabled={pending}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            </Field>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div>
            <Button
              type="submit"
              variant="brand"
              disabled={pending || !valid || !hasDaemon}
            >
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? t("importing") : t("import")}
            </Button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {c("configReady")}
          </p>
        </FieldGroup>
      </form>
    </div>
  );
}
