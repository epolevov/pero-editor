-- CreateTable
CREATE TABLE "workspace_ai_setting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "openrouterApiKeyEncrypted" TEXT,
    "openrouterModel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("id"),
    CONSTRAINT "workspace_ai_setting_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_ai_setting_workspaceId_key" ON "workspace_ai_setting"("workspaceId");
