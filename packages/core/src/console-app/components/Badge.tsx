import type { JSX } from "react";

export function Badge({
  variant,
  children,
}: {
  variant: "private" | "shared" | "neutral";
  children: string;
}): JSX.Element {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
