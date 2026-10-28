import { noop } from "@lib/helper";
import { type BaseComponentProps } from "@models";
import { useI18n } from "@stores";
import classnames from "classnames";
import { useState, useRef, useLayoutEffect } from "react";

import "./style.scss";

interface TagsProps extends BaseComponentProps {
  data: string[];
  labels?: Map<string, string>;
  onClick: (name: string) => void;
  errSet?: Set<string>;
  select: string;
  rowHeight: number;
  canClick: boolean;
}

export function Tags(props: TagsProps) {
  const {
    className,
    data,
    onClick,
    select,
    canClick,
    errSet,
    rowHeight: rawHeight,
  } = props;

  const { translation } = useI18n();
  const { t } = translation("Proxies");
  const [expand, setExpand] = useState(false);
  const [showExtend, setShowExtend] = useState(false);

  const ulRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    setShowExtend((ulRef?.current?.offsetHeight ?? 0) > 30);
  }, []);

  const rowHeight = expand ? "auto" : rawHeight;
  const handleClick = canClick ? onClick : noop;

  function toggleExtend() {
    setExpand(!expand);
  }

  const tags = data.map((t) => {
    const tagClass = classnames({
      "tags-selected": select === t,
      "cursor-pointer": canClick,
      error: errSet?.has(t),
    });
    return (
      <li
        className={tagClass}
        key={t}
        role={canClick ? "button" : undefined}
        tabIndex={canClick ? 0 : undefined}
        aria-pressed={canClick ? select === t : undefined}
        onKeyDown={(e) => {
          if (canClick && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            handleClick(t);
          }
        }}
        onClick={() => handleClick(t)}
      >
        {props.labels?.get(t) ?? t}
      </li>
    );
  });

  return (
    <div
      className={classnames("flex items-start overflow-y-hidden", className)}
      style={{ height: rowHeight }}
    >
      <ul ref={ulRef} className={classnames("tags", { expand })}>
        {tags}
      </ul>
      {showExtend && (
        <span
          className="h-7 cursor-pointer select-none px-5 leading-7 text-muted-foreground"
          onClick={toggleExtend}
        >
          {expand ? t("collapseText") : t("expandText")}
        </span>
      )}
    </div>
  );
}
