import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Input({ className, mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input className={["input", mono && "input--mono", className].filter(Boolean).join(" ")} {...rest} />;
}

export interface Option {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: readonly Option[];
  /** A first, empty option (e.g. "choose…"). */
  placeholder?: string;
}

export function Select({ className, options, placeholder, children, ...rest }: SelectProps) {
  return (
    <select className={className ? `select ${className}` : "select"} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={className ? `textarea ${className}` : "textarea"} {...rest} />;
}
