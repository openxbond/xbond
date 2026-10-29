import { Card } from "@components";
import { type BaseComponentProps } from "@models/BaseProps";
import classnames from "classnames";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

interface DrawerProps extends BaseComponentProps {
  visible?: boolean;
  width?: number | string;
  bodyClassName?: string;
  onClose?: () => void;
  // React 19 types: useRef always carries a null state.
  containerRef?: RefObject<HTMLElement | null>;
}

export function Drawer(props: DrawerProps) {
  const {
    visible,
    onClose,
    className,
    bodyClassName,
    children,
    width,
    containerRef,
  } = props;
  const portalRef = useRef<HTMLElement>(document.createElement("div"));

  useLayoutEffect(() => {
    const current = portalRef.current;
    document.body.appendChild(current);
    return () => {
      document.body.removeChild(current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!visible || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  const cardStyle =
    "fixed top-0 bottom-0 right-0 max-w-full overflow-y-auto transition-transform transform duration-200 pointer-events-auto z-10000 shadow-2xl bg-card border-l border-border";

  const container = (
    <div
      className={classnames(
        className,
        "fixed inset-0 z-9999",
        visible ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      {visible && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200 pointer-events-auto"
          onClick={onClose}
        />
      )}
      <Card
        className={classnames(cardStyle, bodyClassName, {
          "translate-x-0": visible,
          "translate-x-full": !visible,
        })}
        style={{ width: width ?? 400 }}
      >
        {children}
      </Card>
    </div>
  );

  return createPortal(container, containerRef?.current ?? portalRef.current);
}
