import type { SettingSpec } from "@tino/contracts";
import type { ReactNode } from "react";
import { Field } from "../ui/Field";
import { Input, Select } from "../ui/Input";
import { SecretInput } from "../ui/SecretInput";

/** One catalogue setting rendered by its spec: select, secret, number or text. */
export function SettingField({
  spec,
  value,
  isSet,
  onChange,
  error,
  label,
  hint,
  optional,
}: {
  spec: SettingSpec;
  /** Text for plain fields; for secrets undefined/string/null (keep/replace/clear). */
  value: string | null | undefined;
  /** Secrets only: whether one is saved. */
  isSet?: boolean;
  onChange: (v: string | null | undefined) => void;
  error?: string | null;
  label?: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
}) {
  const h = hint ?? spec.help;
  if (spec.secret) {
    return (
      <Field label={label ?? spec.label} hint={h} error={error} optional={optional}>
        <SecretInput isSet={!!isSet} value={value} onChange={onChange} placeholder={spec.placeholder} />
      </Field>
    );
  }
  if (spec.options) {
    return (
      <Field label={label ?? spec.label} hint={h} error={error} optional={optional}>
        <Select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          options={spec.options}
          placeholder="default"
        />
      </Field>
    );
  }
  return (
    <Field label={label ?? spec.label} hint={h} error={error} optional={optional}>
      <Input
        type={spec.kind === "number" ? "number" : "text"}
        step={spec.kind === "number" ? "any" : undefined}
        inputMode={spec.kind === "number" ? "decimal" : undefined}
        value={value ?? ""}
        placeholder={spec.placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
}
