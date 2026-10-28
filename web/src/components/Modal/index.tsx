import { Button } from "@components";
import { noop } from "@lib/helper";
import { type BaseComponentProps } from "@models";
import { useI18n } from "@stores";
import classnames from "classnames";
import { useId, useRef, useLayoutEffect, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import "./style.scss";

interface ModalProps extends BaseComponentProps {
  // show modal
  show?: boolean;

  // modal title
  title: string;

  // size
  size?: "small" | "big";

  // body className
  bodyClassName?: string;

  // body style
  bodyStyle?: React.CSSProperties;

  // show footer
  footer?: boolean;

  // footer extra
  footerExtra?: React.ReactNode;
  pending?: boolean;
  okDisabled?: boolean;

  // on click ok
  onOk?: typeof noop;

  // on click close
  onClose?: typeof noop;
}

export function Modal(props: ModalProps) {
  const {
    show = true,
    title = "Modal",
    size = "small",
    footer = true,
    onOk = noop,
    onClose = noop,
    bodyClassName,
    bodyStyle,
    className,
    footerExtra,
    style,
    children,
  } = props;

  const { translation } = useI18n();
  const { t } = translation("Modal");

  const portalRef = useRef<HTMLDivElement>(document.createElement("div"));
  const maskRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const pendingRef = useRef(props.pending);
  closeRef.current = onClose;
  pendingRef.current = props.pending;

  useLayoutEffect(() => {
    const current = portalRef.current;
    document.body.appendChild(current);
    return () => {
      document.body.removeChild(current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!show) return;
    const previous = document.activeElement;
    const app = document.querySelector<HTMLElement>(".app");
    const wasInert = app?.inert ?? false;
    if (app) app.inert = true;
    const dialog = dialogRef.current;
    const targets = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
        ) ?? [],
      );
    (targets()[0] ?? dialog)?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = targets();
      const first = items[0];
      const last = items.at(-1);
      if (!first) {
        event.preventDefault();
        dialog?.focus();
      } else if (!dialog?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (app) app.inert = wasInert;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [show]);

  function handleMaskMouseDown(e: MouseEvent) {
    if (e.target === maskRef.current && !props.pending) {
      onClose();
    }
  }

  const modal = (
    <div
      className={classnames("modal-mask", { "modal-show": show })}
      ref={maskRef}
      onMouseDown={handleMaskMouseDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        className={classnames("modal", `modal-${size}`, className)}
        style={style}
      >
        <div className="modal-title" id={titleId}>
          {title}
        </div>
        <div
          className={classnames("modal-body", bodyClassName)}
          style={bodyStyle}
        >
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-between">
            {footerExtra}
            <div className="flex flex-1 justify-end space-x-3">
              <Button disabled={props.pending} onClick={() => onClose()}>
                {t("cancel")}
              </Button>
              <Button
                type="primary"
                disabled={props.pending || props.okDisabled}
                onClick={() => onOk()}
              >
                {t("ok")}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );

  return show ? createPortal(modal, portalRef.current) : null;
}
