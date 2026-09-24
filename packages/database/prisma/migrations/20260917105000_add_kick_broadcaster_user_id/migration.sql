ALTER TABLE "KickChannel"
ADD COLUMN "broadcasterUserId" TEXT;

CREATE UNIQUE INDEX "KickChannel_broadcasterUserId_key"
ON "KickChannel"("broadcasterUserId");
