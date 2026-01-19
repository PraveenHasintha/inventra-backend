/**
 * Prisma client = database connection object.
 * Simple words: We use this prisma object to read/write the SQLite database.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
