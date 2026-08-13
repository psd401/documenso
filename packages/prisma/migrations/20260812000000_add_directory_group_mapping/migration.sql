-- CreateEnum
CREATE TYPE "DirectoryMappingSourceField" AS ENUM ('GROUP', 'DEPARTMENT', 'ORG_UNIT');

-- CreateTable
CREATE TABLE "DirectoryGroupMapping" (
    "id" TEXT NOT NULL,
    "sourceField" "DirectoryMappingSourceField" NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "organisationGroupId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryGroupMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectorySyncAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "userId" INTEGER,
    "name" TEXT,
    "email" TEXT,

    CONSTRAINT "DirectorySyncAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryGroupMapping_sourceField_sourceValue_organisationG_key" ON "DirectoryGroupMapping"("sourceField", "sourceValue", "organisationGroupId");

-- CreateIndex
CREATE INDEX "DirectorySyncAuditLog_createdAt_idx" ON "DirectorySyncAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "DirectorySyncAuditLog_type_idx" ON "DirectorySyncAuditLog"("type");

-- AddForeignKey
ALTER TABLE "DirectoryGroupMapping" ADD CONSTRAINT "DirectoryGroupMapping_organisationGroupId_fkey" FOREIGN KEY ("organisationGroupId") REFERENCES "OrganisationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

