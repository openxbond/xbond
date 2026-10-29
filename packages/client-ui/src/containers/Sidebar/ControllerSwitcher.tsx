import {
  selectedControllerAtom,
  useControllers,
  useSelectController,
} from "@stores";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./ControllerSwitcher.scss";

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
    <div className="controller-switcher" ref={rootRef}>
      <div className="controller-switch-head">
        <span>{t("controller")}</span>
        {controllers.length > 1 && (
          <span className="controller-switch-count">{controllers.length}</span>
        )}
      </div>

      <button
        type="button"
        className="controller-switch-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("controller")}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="controller-switch-icon" aria-hidden="true">
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
          <span
            className={`controller-switch-status ${connected ? "is-online" : ""}`}
          />
        </span>
        <span className="controller-switch-text">
          <span className="controller-switch-name">
            <span className="controller-switch-name-text">
              {selected ? selected.name || hostOf(selected.url) : "—"}
            </span>
            <svg
              className="controller-switch-chevron"
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
          {selected?.name && (
            <span className="controller-switch-host">
              {hostOf(selected.url)}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          className="controller-menu"
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
                className={`controller-menu-item ${active ? "is-active" : ""}`}
                onClick={() => {
                  select(controller.id);
                  setOpen(false);
                }}
              >
                <span className="controller-menu-text">
                  <span className="controller-menu-name">
                    {controller.name || hostOf(controller.url)}
                  </span>
                  <span className="controller-menu-host">
                    {hostOf(controller.url)}
                  </span>
                </span>
                {active && (
                  <svg
                    className="controller-menu-check"
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

          <div className="controller-menu-divider" aria-hidden="true" />

          <button
            type="button"
            className="controller-menu-item controller-menu-edit"
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
