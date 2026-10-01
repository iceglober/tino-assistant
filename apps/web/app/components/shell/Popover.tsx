import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * A button that opens a small menu. Closes on outside click, Escape (focus
 * returns to the button), or when an item is chosen.
 */
export function Popover({
  trigger,
  label,
  children,
  align = "start",
  placement = "below",
  className,
}: {
  trigger: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  placement?: "below" | "above";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={className ? `popover ${className}` : "popover"} ref={root}>
      <button
        ref={button}
        type="button"
        className="popover__trigger"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open ? (
        <div id={menuId} className={`menu menu--${align} menu--${placement}`}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
