ALTER TABLE "ContentAccount"
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "accessTokenEncrypted" TEXT,
ADD COLUMN "refreshTokenEncrypted" TEXT,
ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "authorizedScopes" TEXT,
ADD COLUMN "connectedAt" TIMESTAMP(3);
