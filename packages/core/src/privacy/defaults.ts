export const PRIVACY_REGEX = /private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i;

export function withDefaults<T extends object>(
  items: T[],
  regexField: keyof T & string,
): Array<T & { preChecked: boolean }> {
  return items.map((item) => ({
    ...item,
    preChecked: PRIVACY_REGEX.test(String(item[regexField] ?? "")),
  }));
}
