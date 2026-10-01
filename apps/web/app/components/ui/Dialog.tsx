import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** Buttons along the bottom. */
  actions?: ReactNode;
  /** Wrap the body in a form; Enter submits. */
  onSubmit?: () => void;
}

/**
 * A modal on the native <dialog>: focus is trapped and restored by the
 * browser, Escape closes, the backdrop click closes.
 */
export function Dialog({ open, onClose, title, children, actions, onSubmit }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const body = (
    <div className="dialog__inner">
      <h2 className="dialog__title" id={titleId}>
        {title}
      </h2>
      {children}
      {actions ? <div className="dialog__actions">{actions}</div> : null}
    </div>
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click mirrors Escape, which the native dialog handles
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        onSubmit ? (
          <form
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )
      ) : null}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Are you sure?" with the consequence spelled out and a specific verb on the button. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "cancel",
  destructive,
  busy,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger-solid" : "primary"} onClick={onConfirm} loading={busy} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ? <div className="prose">{children}</div> : null}
    </Dialog>
  );
}
