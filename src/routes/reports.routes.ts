// inventra-backend/src/routes/reports.routes.ts
// Simple words:
// - Manager-only report endpoints.
// - Low Stock Alerts + Stock Valuation for a branch (or all branches).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const reportsRouter = Router();

/**
 * GET /reports/low-stock?branchId=...&threshold=...&take=...
 * Simple words:
 * - Shows stock items where quantity <= threshold
 * - Useful as "low stock alerts"
 */
const lowStockQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  threshold: z.coerce.number().int().min(0).max(100000).optional(),
  take: z.coerce.number().int().min(1).max(500).optional(),
});

reportsRouter.get(
  "/reports/low-stock",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = lowStockQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const { branchId, threshold, take } = parsed.data;
    const th = typeof threshold === "number" ? threshold : 5;

    const items = await prisma.stockItem.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        quantity: { lte: th },
        product: { isActive: true },
        branch: { isActive: true },
      },
      orderBy: [{ quantity: "asc" }, { updatedAt: "desc" }],
      take: take ?? 100,
      select: {
        id: true,
        quantity: true,
        updatedAt: true,
        branch: { select: { id: true, name: true } },
        product: {
          select: { id: true, name: true, sku: true, unit: true, costPrice: true, sellingPrice: true },
        },
      },
    });

    return res.json({
      threshold: th,
      count: items.length,
      items,
    });
  }
);

/**
 * GET /reports/stock-valuation?branchId=...&includeZero=...&take=...
 * Simple words:
 * - Calculates inventory value using costPrice and sellingPrice
 * - Returns totals + per-item breakdown
 */
const valuationQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  includeZero: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  take: z.coerce.number().int().min(1).max(2000).optional(),
});

reportsRouter.get(
  "/reports/stock-valuation",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = valuationQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const { branchId, includeZero, take } = parsed.data;

    const where: any = {
      ...(branchId ? { branchId } : {}),
      product: { isActive: true },
      branch: { isActive: true },
    };

    if (!includeZero) {
      where.quantity = { gt: 0 };
    }

    const rows = await prisma.stockItem.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: take ?? 500,
      select: {
        id: true,
        quantity: true,
        updatedAt: true,
        branch: { select: { id: true, name: true } },
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
            costPrice: true,
            sellingPrice: true,
          },
        },
      },
    });

    // Compute totals in code (works well with SQLite)
    let totalCostValue = 0;
    let totalSellingValue = 0;

    const items = rows.map((r) => {
      const costValue = (r.product.costPrice || 0) * (r.quantity || 0);
      const sellingValue = (r.product.sellingPrice || 0) * (r.quantity || 0);
      totalCostValue += costValue;
      totalSellingValue += sellingValue;

      return {
        id: r.id,
        quantity: r.quantity,
        updatedAt: r.updatedAt,
        branch: r.branch,
        product: r.product,
        costValue,
        sellingValue,
      };
    });

    return res.json({
      count: items.length,
      totals: {
        totalCostValue,
        totalSellingValue,
        estimatedProfitIfSoldAll: totalSellingValue - totalCostValue,
      },
      items,
    });
  }
);
