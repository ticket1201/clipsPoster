import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

const deriveKey = (secret: string) => createHash("sha256").update(secret).digest();

export const encryptToken = (token: string, secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
};

export const decryptToken = (payload: string, secret: string): string => {
  const [version, encodedIv, encodedTag, encodedToken] = payload.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedToken) {
    throw new Error("Unsupported encrypted token payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedToken, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
