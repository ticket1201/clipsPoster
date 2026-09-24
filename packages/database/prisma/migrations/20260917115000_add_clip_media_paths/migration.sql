ALTER TABLE "Clip"
ADD COLUMN "rawFilePath" TEXT,
ADD COLUMN "processedFilePath" TEXT,
ADD COLUMN "processingError" TEXT,
ADD COLUMN "processedAt" TIMESTAMP(3);
