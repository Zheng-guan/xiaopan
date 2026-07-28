const sizeUnits = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(value: number, digits = 1) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    sizeUnits.length - 1,
  );
  const amount = value / 1024 ** index;
  return `${amount.toFixed(index === 0 ? 0 : digits)} ${sizeUnits[index]}`;
}

export function formatSpeed(value: number) {
  return value > 0 ? `${formatBytes(value)}/s` : "正在计算";
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function initials(email = "") {
  return email.slice(0, 2).toUpperCase() || "ME";
}
