/**
 * Prisma client = database connection object.
 * We use this to read/write PostgreSQL.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
