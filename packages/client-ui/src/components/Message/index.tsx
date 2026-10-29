import { Icon } from "@components";
import { noop } from "@xbond/client/helper";
import classnames from "classnames";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./style.scss";

const TYPE_ICON_MAP = {
  info: "info",
  success: "check",
  warning: "info-o",
  error: "close",
} as const;

type NoticeType = keyof typeof TYPE_ICON_MAP;

interface Notice {
  id: number;
  type: NoticeType;
  content: string;
  duration: number;
  onClose?: typeof noop;
}

// One host element renders every notice as a vertical stack, so messages can
// never overlap each other (previously each toast was its own fixed element at
// the same corner, compounding shadows). Identical messages are de-duplicated
// and the stack is capped, so repeated clicks cannot pile notices up.
const MAX_VISIBLE = 4;
let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let notices: Notice[] = [];
let nextId = 1;

function render() {
  if (!host) {
    host = document.createElement("div");
    host.className = "message-host";
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root?.render(<MessageStack notices={notices} onDismiss={dismiss} />);
}

function dismiss(id: number) {
  const notice = notices.find((item) => item.id === id);
  if (!notice) return;
  notices = notices.filter((item) => item.id !== id);
  render();
  notice.onClose?.();
}

function push(
  type: NoticeType,
  content: string,
  duration = 1500,
  onClose?: typeof noop,
) {
  // The same message arriving again restarts its timer instead of stacking a
  // duplicate.
  notices = notices.filter(
    (item) => !(item.type === type && item.content === content),
  );
  notices = [...notices, { id: nextId++, type, content, duration, onClose }];
  if (notices.length > MAX_VISIBLE)
    notices = notices.slice(notices.length - MAX_VISIBLE);
  render();
}

function MessageItem({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: (id: number) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    let exit: number | undefined;
    const timer = window.setTimeout(() => {
      notice.onClose?.();
      setVisible(false);
      exit = window.setTimeout(() => onDismiss(notice.id), 220);
    }, notice.duration);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      if (exit) window.clearTimeout(exit);
    };
  }, [notice, onDismiss]);

  return (
    <div
      className={classnames("message", `message-${notice.type}`, {
        "message-show": visible,
      })}
      role="status"
    >
      <span className="message-icon">
        <Icon type={TYPE_ICON_MAP[notice.type]} size={16} />
      </span>
      <span className="message-content">{notice.content}</span>
    </div>
  );
}

function MessageStack({
  notices: items,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (id: number) => void;
}) {
  return (
    <>
      {items.map((notice) => (
        <MessageItem key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </>
  );
}

export function showMessage(args: {
  content: string;
  type: NoticeType;
  duration?: number;
  onClose?: typeof noop;
}) {
  push(args.type, args.content, args.duration, args.onClose);
}

export const info = (
  content: string,
  duration?: number,
  onClose?: typeof noop,
) => push("info", content, duration, onClose);

export const success = (
  content: string,
  duration?: number,
  onClose?: typeof noop,
) => push("success", content, duration, onClose);

export const warning = (
  content: string,
  duration?: number,
  onClose?: typeof noop,
) => push("warning", content, duration, onClose);

export const error = (
  content: string,
  duration?: number,
  onClose?: typeof noop,
) => push("error", content, duration, onClose);
