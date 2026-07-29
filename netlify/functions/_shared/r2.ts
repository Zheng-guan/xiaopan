import {
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export function r2Environment() {
  const accountId = Netlify.env.get("R2_ACCOUNT_ID");
  const bucket = Netlify.env.get("R2_BUCKET_NAME");
  const accessKeyId = Netlify.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Netlify.env.get("R2_SECRET_ACCESS_KEY");
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export function r2Client() {
  const environment = r2Environment();
  if (!environment) return null;
  const config: S3ClientConfig = {
    region: "auto",
    endpoint: `https://${environment.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: environment.accessKeyId,
      secretAccessKey: environment.secretAccessKey,
    },
  };
  return { client: new S3Client(config), environment };
}

export function isOwnedR2Key(key: string, userId: string) {
  return key.startsWith(`${userId}/`) && !key.includes("\\") && key.length <= 1024;
}

export function asciiExtension(name: string) {
  const match = name.match(/\.([a-zA-Z0-9]{1,16})$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

export function downloadDisposition(name: string) {
  const fallback =
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .slice(0, 180) || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
