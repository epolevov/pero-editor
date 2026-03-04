-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    CONSTRAINT "user_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("id"),
    CONSTRAINT "post_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_authorUserId_fkey"
      FOREIGN KEY ("authorUserId") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_version" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentJson" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    CONSTRAINT "post_version_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suggestion" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "rangeFrom" INTEGER NOT NULL,
    "rangeTo" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id"),
    CONSTRAINT "suggestion_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "post_version_postId_version_key" ON "post_version"("postId", "version");

-- CreateIndex
CREATE INDEX "suggestion_postId_status_idx" ON "suggestion"("postId", "status");
