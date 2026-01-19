// inventra-backend/src/routes/reports.routes.ts
// Simple words:
// - Manager-only report endpoints.
// - Low Stock Alerts + Stock Valuation
// - Sales Summary by date range
// - Top Selling Products by date range

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const reportsRouter = Router();

function isDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Parse date input.
 * Accepts:
 * - YYYY-MM-DD (date only)
 * - ISO datetime string
 */
function parseDateInput(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Convert a YYYY-MM-DD to:
 * - fromStart = that day 00:00 (UTC)
 * - toExclusive = next day 00:00 (UTC)
 *
 * Note: JS Date("YYYY-MM-DD") is parsed as UTC midnight.
 */
function dateOnlyRange(from: string, to: string) {
  const fromStart = new Date(from);
  const toStart = new Date(to);
  if (Number.isNaN(fromStart.getTime()) || Number.isNaN(toStart.getTime())) return null;

  // make toExclusive = next day of "to"
  const toExclusive = new Date(toStart);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  return { fromStart, toExclusive };
}

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

reportsRouter.get("/reports/low-stock", requireAuth, requireRole("MANAGER"), async (req, res) => {
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
});

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

reportsRouter.get("/reports/stock-valuation", requireAuth, requireRole("MANAGER"), async (req, res) => {
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
});

/**
 * GET /reports/sales-summary?branchId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Simple words:
 * - Total sales (sum of invoice.total)
 * - Invoice count
 * - Average bill value
 * - Filter by branch (optional)
 * - Filter by date range (optional; default: last 30 days)
 */
const salesSummaryQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  from: z.string().optional(), // YYYY-MM-DD or ISO
  to: z.string().optional(), // YYYY-MM-DD or ISO
});

reportsRouter.get("/reports/sales-summary", requireAuth, requireRole("MANAGER"), async (req, res) => {
  const parsed = salesSummaryQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, from, to } = parsed.data;

  // Defaults: last 30 days
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  let fromStart: Date;
  let toExclusive: Date;

  if (from && to && isDateOnly(from) && isDateOnly(to)) {
    const r = dateOnlyRange(from, to);
    if (!r) return res.status(400).json({ message: "Invalid from/to date" });
    fromStart = r.fromStart;
    toExclusive = r.toExclusive;
  } else {
    // fallback parse (ISO or partially filled)
    const f = from ? parseDateInput(from) : defaultFrom;
    const t = to ? parseDateInput(to) : now;
    if (!f || !t) return res.status(400).json({ message: "Invalid from/to date" });

    fromStart = f;

    // If 'to' is date-only, treat it as end-of-day inclusive -> next day exclusive
    if (to && isDateOnly(to)) {
      const next = new Date(t);
      next.setUTCDate(next.getUTCDate() + 1);
      toExclusive = next;
    } else {
      toExclusive = t;
    }
  }

  const where: any = {
    ...(branchId ? { branchId } : {}),
    createdAt: { gte: fromStart, lt: toExclusive },
  };

  const agg = await prisma.invoice.aggregate({
    where,
    _sum: { total: true },
    _count: { _all: true },
    _avg: { total: true },
  });

  const totalSales = agg._sum.total ?? 0;
  const invoiceCount = agg._count._all ?? 0;
  const avgBill = Math.round((agg._avg.total ?? 0) as number);

  return res.json({
    range: {
      from: fromStart.toISOString(),
      toExclusive: toExclusive.toISOString(),
    },
    branchId: branchId ?? null,
    invoiceCount,
    totalSales,
    avgBill,
  });
});

/**
 * GET /reports/top-selling?branchId=...&from=YYYY-MM-DD&to=YYYY-MM-DD&take=...
 * Simple words:
 * - Aggregates invoice items by product
 * - Returns qty sold + revenue (sum of lineTotal)
 * - Filter by branch and date range (optional; default: last 30 days)
 */
const topSellingQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

reportsRouter.get("/reports/top-selling", requireAuth, requireRole("MANAGER"), async (req, res) => {
  const parsed = topSellingQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, from, to, take } = parsed.data;

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  let fromStart: Date;
  let toExclusive: Date;

  if (from && to && isDateOnly(from) && isDateOnly(to)) {
    const r = dateOnlyRange(from, to);
    if (!r) return res.status(400).json({ message: "Invalid from/to date" });
    fromStart = r.fromStart;
    toExclusive = r.toExclusive;
  } else {
    const f = from ? parseDateInput(from) : defaultFrom;
    const t = to ? parseDateInput(to) : now;
    if (!f || !t) return res.status(400).json({ message: "Invalid from/to date" });

    fromStart = f;

    if (to && isDateOnly(to)) {
      const next = new Date(t);
      next.setUTCDate(next.getUTCDate() + 1);
      toExclusive = next;
    } else {
      toExclusive = t;
    }
  }

  const whereItem: any = {
    invoice: {
      ...(branchId ? { branchId } : {}),
      createdAt: { gte: fromStart, lt: toExclusive },
    },
  };

  const grouped = await prisma.invoiceItem.groupBy({
    by: ["productId"],
    where: whereItem,
    _sum: { qty: true, lineTotal: true },
    orderBy: { _sum: { lineTotal: "desc" } },
    take: take ?? 20,
  });

  const productIds = grouped.map((g) => g.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true, unit: true, isActive: true },
  });

  const pMap = new Map(products.map((p) => [p.id, p]));

  const items = grouped.map((g) => {
    const p = pMap.get(g.productId);
    return {
      product: p
        ? { id: p.id, name: p.name, sku: p.sku, unit: p.unit, isActive: p.isActive }
        : { id: g.productId, name: "Unknown", sku: "—", unit: "PCS", isActive: false },
      qtySold: g._sum.qty ?? 0,
      revenue: g._sum.lineTotal ?? 0,
    };
  });

  return res.json({
    range: {
      from: fromStart.toISOString(),
      toExclusive: toExclusive.toISOString(),
    },
    branchId: branchId ?? null,
    count: items.length,
    items,
  });
});
