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

export function formatQuotaBytes(value: number, digits = 1) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1000)),
    sizeUnits.length - 1,
  );
  const amount = value / 1000 ** index;
  return `${amount.toFixed(index === 0 ? 0 : digits)} ${sizeUnits[index]}`;
}

export function formatSpeed(value: number) {
  return value > 0 ? `${formatBytes(value)}/s` : "正在计算";
}

export function formatRemainingTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "计算中";
  if (seconds < 1) return "即将完成";

  const roundedSeconds = Math.ceil(seconds);
  if (roundedSeconds < 60) return `约 ${roundedSeconds} 秒`;

  const totalMinutes = Math.ceil(roundedSeconds / 60);
  if (totalMinutes < 60) return `约 ${totalMinutes} 分钟`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `约 ${hours} 小时 ${minutes} 分钟` : `约 ${hours} 小时`;
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
