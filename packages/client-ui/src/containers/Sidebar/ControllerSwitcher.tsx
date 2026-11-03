import { XBondIcon } from "@components";
import {
  DAEMON_CONTROLLER_ID,
  selectedControllerAtom,
  useControllers,
  useSelectController,
} from "@stores";
import { cn } from "cn";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ControllerSwitcher({
  connected,
  onEdit,
}: {
  connected: boolean;
  onEdit: () => void;
}) {
  const [controllers] = useControllers();
  const selectedID = useAtomValue(selectedControllerAtom);
  const select = useSelectController();
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected =
    controllers.find((controller) => controller.id === selectedID) ??
    controllers[0];
  const isDaemon = selected?.id === DAEMON_CONTROLLER_ID;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      className="relative mt-0.5 flex min-w-0 flex-col max-md:mt-0 max-md:flex-row max-md:items-center max-md:max-w-[210px]"
      ref={rootRef}
    >
      {/* Legacy caption row, kept hidden with its count badge. */}
      <div className="hidden">
        <span>{t("controller")}</span>
        {controllers.length > 1 && (
          <span className="inline-flex h-[15px] min-w-4 items-center justify-center rounded-[7px] bg-inset px-[5px] font-mono text-2xs leading-none tabular-nums text-muted-foreground">
            {controllers.length}
          </span>
        )}
      </div>

      <button
        type="button"
        className="relative flex w-full cursor-pointer items-center gap-[7px] rounded-full border border-border bg-inset px-3 py-1.5 text-left font-[inherit] text-foreground shadow-[0_1px_2px_oklch(0_0_0/4%)] transition-[border-color,background-color,box-shadow] duration-[120ms] hover:border-border-strong hover:bg-card hover:shadow-[0_2px_6px_oklch(0_0_0/6%)] aria-expanded:border-brand aria-expanded:bg-card motion-reduce:transition-none max-md:w-auto max-md:gap-1.5 max-md:py-1.5 max-md:pr-3 max-md:pl-2 max-md:shadow-none"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("controller")}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="relative grid size-[22px] shrink-0 place-content-center rounded-full bg-brand-soft text-brand-text"
          aria-hidden="true"
        >
          {isDaemon ? (
            <XBondIcon className="size-4 text-foreground" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="5" width="16" height="11" rx="2" />
              <path d="M2 19h20" />
            </svg>
          )}
          <span
            className={cn(
              "absolute right-[-1px] bottom-[-1px] size-[7px] rounded-full border-[1.5px] border-card bg-muted-foreground",
              connected && "bg-success",
            )}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-row items-center gap-1">
          <span className="inline-flex min-w-0 flex-1 items-center gap-1 text-label font-medium text-foreground">
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {selected
                ? isDaemon
                  ? "XBond"
                  : selected.name || hostOf(selected.url)
                : "—"}
            </span>
            <svg
              className={cn(
                "shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-180",
              )}
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          {selected?.name && !isDaemon && (
            <span className="hidden">{hostOf(selected.url)}</span>
          )}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-[calc(100%+6px)] left-0 z-40 flex max-h-[260px] flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-border bg-popover p-1 shadow-[0_8px_24px_oklch(0_0_0/12%)] max-md:bottom-auto max-md:left-0 max-md:top-[calc(100%+6px)] max-md:min-w-60"
          role="listbox"
          aria-label={t("controller")}
        >
          {controllers.map((controller) => {
            const active = controller.id === selectedID;
            return (
              <button
                key={controller.id}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-[7px] text-left font-[inherit] text-foreground transition-colors duration-[120ms] hover:bg-inset motion-reduce:transition-none",
                  active && "bg-brand-soft",
                )}
                onClick={() => {
                  select(controller.id);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-label font-semibold text-foreground">
                    {controller.id === DAEMON_CONTROLLER_ID
                      ? "XBond"
                      : controller.name || hostOf(controller.url)}
                  </span>
                  {controller.id !== DAEMON_CONTROLLER_ID && (
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs text-muted-foreground">
                      {hostOf(controller.url)}
                    </span>
                  )}
                </span>
                {active && (
                  <svg
                    className="shrink-0 text-brand-text"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m4.5 12.5 5 5 10-11" />
                  </svg>
                )}
              </button>
            );
          })}

          <div className="mx-0.5 my-[3px] h-px bg-border" aria-hidden="true" />

          <button
            type="button"
            className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-[7px] text-left font-[inherit] text-xs text-muted-foreground transition-colors duration-[120ms] hover:bg-inset hover:text-foreground motion-reduce:transition-none"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <svg
              viewBox="0 0 20 20"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="m13 3 4 4-9 9-5 1 1-5Z" />
            </svg>
            {t("editController")}
          </button>
        </div>
      )}
    </div>
  );
}
