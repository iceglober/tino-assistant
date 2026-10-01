import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";

/** Save + discard, with an honest "unsaved changes" line and the apply error, if any. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
  error,
  label = "save",
  disabled,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  error?: string | null;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="savebar">
      {error ? (
        <Notice tone="err" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="row">
        <Button variant="primary" onClick={onSave} loading={saving} disabled={!dirty || disabled}>
          {label}
        </Button>
        {dirty && !saving ? (
          <>
            <Button variant="ghost" onClick={onReset}>
              discard
            </Button>
            <span className="small muted" role="status">
              unsaved changes
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
