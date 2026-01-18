// inventra-backend/src/routes/invoices.routes.ts
// Simple words: lets users view invoice history and open a single invoice for reprint.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const invoicesRouter = Router();

/**
 * GET /invoices?branchId=...&search=...&take=...
 * Simple words:
 * - Lists latest invoices
 * - Optional filter by branch
 * - Optional search by invoice number (INV-000001)
 */
const listQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

invoicesRouter.get("/invoices", requireAuth, async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, search, take } = parsed.data;

  const where: any = {};
  if (branchId) where.branchId = branchId;

  // Search only by invoiceNo for now (client requirement)
  if (search && search.length > 0) {
    where.invoiceNo = { contains: search, mode: "insensitive" };
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take ?? 50,
    select: {
      publicId: true,
      invoiceNo: true,
      total: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, role: true } },
    },
  });

  res.json({ invoices });
});

/**
 * GET /invoices/:publicId
 * Simple words:
 * - Opens a single invoice fully (with items)
 * - Used for invoice view + print
 */
const paramsSchema = z.object({
  publicId: z.string().uuid(),
});

invoicesRouter.get("/invoices/:publicId", requireAuth, async (req, res) => {
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { publicId } = parsed.data;

  const invoice = await prisma.invoice.findUnique({
    where: { publicId },
    select: {
      publicId: true,
      invoiceNo: true,
      note: true,
      total: true,
      createdAt: true,
      branch: { select: { id: true, name: true, address: true, phone: true } },
      createdBy: { select: { id: true, name: true, role: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          qty: true,
          unitPrice: true,
          lineTotal: true,
          product: { select: { id: true, name: true, sku: true, unit: true } },
        },
      },
    },
  });

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  res.json({ invoice });
});
