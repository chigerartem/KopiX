/**
 * Shared Prisma client for bot handlers.
 *
 * A single connection pool is reused across all handler modules.
 * Creating one client per handler file would open parallel pools
 * and hit the DB connection limit quickly.
 */

import { createPrismaClient, type PrismaClient } from "@kopix/db";

export const prisma: PrismaClient = createPrismaClient();
