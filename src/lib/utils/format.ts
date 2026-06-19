export function formatCurrency(value: unknown): string {
  if (typeof value !== "number") {
    return "-";
  }
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

export function labelForOption(options: Array<{ label: string; value: string }> | undefined, value: unknown): string {
  const match = options?.find((option) => option.value === value);
  return match?.label ?? String(value ?? "-");
}
