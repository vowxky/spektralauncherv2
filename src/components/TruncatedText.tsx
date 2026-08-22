import { useEffect, useRef, useState } from "react";
import { cn } from "@heroui/react";

interface TruncatedTextProps {
  text: string;
  as?: "span" | "div";
  className?: string;
  /** Lines before clamping. 1 = single-line truncate, 2/3 = line-clamp. */
  clamp?: number;
  /** Allow clicking to expand clamped content to full text. */
  expandable?: boolean;
  /** Native tooltip text. Defaults to the full text when it overflows. */
  title?: string;
}

const CLAMP_CLASS: Record<number, string> = {
  1: "truncate",
  2: "line-clamp-2",
  3: "line-clamp-3",
};

export default function TruncatedText({
  text,
  as: Tag = "span",
  className,
  clamp = 1,
  expandable = false,
  title,
}: TruncatedTextProps) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (clamp === 1) {
        setOverflowing(el.scrollWidth > el.clientWidth + 1);
      } else {
        setOverflowing(el.scrollHeight > el.clientHeight + 1);
      }
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, clamp, expanded]);

  const clampClass = CLAMP_CLASS[clamp] ?? "truncate";
  const isExpandable = expandable && clamp > 1 && overflowing && !expanded;
  const hasOverflow = overflowing || clamp > 1;

  const sharedProps = {
    className: cn(
      "min-w-0",
      expanded ? "line-clamp-none" : clampClass,
      isExpandable && "cursor-pointer hover:text-[var(--color-accent)]",
      className,
    ),
    title: hasOverflow ? (title ?? text) : undefined,
    onClick: isExpandable ? () => setExpanded((v) => !v) : undefined,
  };

  if (Tag === "div") {
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} {...sharedProps}>
        {text}
      </div>
    );
  }
  return (
    <span ref={ref as React.Ref<HTMLSpanElement>} {...sharedProps}>
      {text}
    </span>
  );
}