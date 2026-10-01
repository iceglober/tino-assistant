import type { SubmitTarget } from "react-router";

/**
 * A JSON body for `fetcher.submit(…, { encType: "application/json" })`.
 * react-router types JSON targets as index-signature objects, which our
 * contract interfaces aren't; the value is plain JSON either way.
 */
export const jsonBody = <T extends object>(value: T): SubmitTarget => value as unknown as SubmitTarget;
