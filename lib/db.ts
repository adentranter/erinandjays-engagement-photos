import "server-only";
import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Same pattern as vox-ii: one PrismaClient per process, cached on globalThis
 * in dev so hot reloads don't open a new pool each time. Schema changes go
 * through `prisma/migrations` (`npm run db:migrate`).
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function resolveLogLevels(): Prisma.LogLevel[] {
  const base: Prisma.LogLevel[] = ["error", "warn"];
  return process.env.PRISMA_LOG_QUERIES === "1" ? ["query", ...base] : base;
}

export const db =
  globalForPrisma.prisma ?? new PrismaClient({ log: resolveLogLevels() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
