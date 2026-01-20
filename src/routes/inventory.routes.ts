// inventra-backend/src/routes/inventory.routes.ts
// Simple words: inventory APIs for stock list + stock in/out + stock history.
// What this file does:
// - GET /inventory         -> current stock list for a branch (search optional)
// - POST /inventory/receive-> manager adds stock
// - POST /inventory/adjust -> manager sets exact stock quantity
// - POST /inventory/sale   -> manager reduces stock manually (no invoice, just stock txn)
// - POST /inventory/damage -> manager reduces stock for damage
// - GET /inventory/txns    -> audit trail (last 200)

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const inventoryRouter = Router();

/**
 * NOTE ABOUT SEARCH + SQLITE:
 * - Prisma "mode: insensitive" is not supported reliably on SQLite.
 * - So we do "contains" without mode.
 * - In SQLite, LIKE is usually case-insensitive for ASCII by default.
 */

/** Query schema for GET /inventory */
const inventoryQuerySchema = z.object({
  branchId: z.string().uuid(),
  search: z.string().trim().optional(),
});

/**
 * GET /inventory?branchId=...&search=...
 * Simple words:
 * - Shows current stock list for a branch
 * - Works for both MANAGER + EMPLOYEE (any logged-in user)
 */
inventoryRouter.get("/inventory", requireAuth, async (req, res) => {
  const parsed = inventoryQuerySchema.safeParse({
    branchId: req.query.branchId,
    search: req.query.search,
  });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, search } = parsed.data;

  // Validate branch exists + active
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return res.status(404).json({ message: "Branch not found" });
  if (!branch.isActive) return res.status(409).json({ message: "Branch is inactive" });

  const where: any = {
    branchId,
    product: {
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } },
              { barcode: { contains: search } },
            ],
          }
        : {}),
    },
  };

  const items = await prisma.stockItem.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      product: {
        include: {
          category: { select: { id: true, name: true, parentId: true } },
        },
      },
      branch: { select: { id: true, name: true } },
    },
  });

  res.json({ items });
});

const receiveSchema = z.object({
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  note: z.string().optional(),
});

/**
 * POST /inventory/receive
 * Simple words:
 * - Manager receives stock into a branch
 * - Increases quantity
 * - Logs StockTxn(RECEIVE)
 */
inventoryRouter.post("/inventory/receive", requireAuth, requireRole("MANAGER"), async (req: any, res) => {
  const parsed = receiveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, productId, quantity, note } = parsed.data;

  const [branch, product] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);

  if (!branch) return res.status(404).json({ message: "Branch not found" });
  if (!branch.isActive) return res.status(409).json({ message: "Branch is inactive" });

  if (!product) return res.status(404).json({ message: "Product not found" });
  if (!product.isActive) return res.status(409).json({ message: "Product is inactive" });

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, quantity },
      update: { quantity: { increment: quantity } },
      include: { product: true, branch: true },
    });

    const txn = await tx.stockTxn.create({
      data: {
        type: "RECEIVE",
        branchId,
        productId,
        qtyChange: quantity,
        note: note?.trim() ? note.trim() : null,
        createdById: req.user.id,
      },
    });

    return { item, txn };
  });

  res.status(201).json(result);
});

const adjustSchema = z.object({
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  newQuantity: z.number().int().nonnegative(),
  note: z.string().optional(),
});

/**
 * POST /inventory/adjust
 * Simple words:
 * - Manager sets stock to an exact quantity (correction)
 * - Logs StockTxn(ADJUST) with qtyChange = new - old
 */
inventoryRouter.post("/inventory/adjust", requireAuth, requireRole("MANAGER"), async (req: any, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, productId, newQuantity, note } = parsed.data;

  const [branch, product] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);

  if (!branch) return res.status(404).json({ message: "Branch not found" });
  if (!branch.isActive) return res.status(409).json({ message: "Branch is inactive" });

  if (!product) return res.status(404).json({ message: "Product not found" });
  if (!product.isActive) return res.status(409).json({ message: "Product is inactive" });

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.stockItem.findUnique({
      where: { branchId_productId: { branchId, productId } },
    });

    const oldQty = existing?.quantity ?? 0;
    const change = newQuantity - oldQty;

    const item = await tx.stockItem.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, quantity: newQuantity },
      update: { quantity: newQuantity },
      include: { product: true, branch: true },
    });

    const txn = await tx.stockTxn.create({
      data: {
        type: "ADJUST",
        branchId,
        productId,
        qtyChange: change,
        note: note?.trim() ? note.trim() : "Manual adjustment",
        createdById: req.user.id,
      },
    });

    return { item, txn };
  });

  res.json(result);
});

const reduceSchema = z.object({
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  note: z.string().optional(),
});

/**
 * Helper: reduce stock safely
 * Simple words:
 * - Prevents negative stock
 * - Creates StockTxn (SALE or DAMAGE)
 * - Throws special error code when stock not enough
 */
async function reduceStockOr409(args: {
  branchId: string;
  productId: string;
  quantity: number;
  note?: string;
  type: "SALE" | "DAMAGE";
  createdById: string;
}) {
  const { branchId, productId, quantity, note, type, createdById } = args;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.stockItem.findUnique({
      where: { branchId_productId: { branchId, productId } },
    });

    const oldQty = existing?.quantity ?? 0;
    if (!existing || oldQty < quantity) {
      const err: any = new Error(`Not enough stock. Available: ${oldQty}`);
      err.code = "INSUFFICIENT_STOCK";
      throw err;
    }

    const item = await tx.stockItem.update({
      where: { branchId_productId: { branchId, productId } },
      data: { quantity: { decrement: quantity } },
      include: { product: true, branch: true },
    });

    const txn = await tx.stockTxn.create({
      data: {
        type,
        branchId,
        productId,
        qtyChange: -quantity,
        note: note?.trim() ? note.trim() : type === "SALE" ? "Sale" : "Damaged",
        createdById,
      },
    });

    return { item, txn };
  });
}

/**
 * POST /inventory/sale
 * Simple words:
 * - Manager reduces stock as "sale adjustment"
 * - (Billing checkout is handled in /sales/checkout; this is manual)
 */
inventoryRouter.post("/inventory/sale", requireAuth, requireRole("MANAGER"), async (req: any, res) => {
  const parsed = reduceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, productId, quantity, note } = parsed.data;

  const [branch, product] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);

  if (!branch) return res.status(404).json({ message: "Branch not found" });
  if (!branch.isActive) return res.status(409).json({ message: "Branch is inactive" });

  if (!product) return res.status(404).json({ message: "Product not found" });
  if (!product.isActive) return res.status(409).json({ message: "Product is inactive" });

  try {
    const result = await reduceStockOr409({
      branchId,
      productId,
      quantity,
      note,
      type: "SALE",
      createdById: req.user.id,
    });
    return res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === "INSUFFICIENT_STOCK") return res.status(409).json({ message: e.message });
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /inventory/damage
 * Simple words:
 * - Manager reduces stock as "damaged"
 */
inventoryRouter.post("/inventory/damage", requireAuth, requireRole("MANAGER"), async (req: any, res) => {
  const parsed = reduceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, productId, quantity, note } = parsed.data;

  const [branch, product] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);

  if (!branch) return res.status(404).json({ message: "Branch not found" });
  if (!branch.isActive) return res.status(409).json({ message: "Branch is inactive" });

  if (!product) return res.status(404).json({ message: "Product not found" });
  if (!product.isActive) return res.status(409).json({ message: "Product is inactive" });

  try {
    const result = await reduceStockOr409({
      branchId,
      productId,
      quantity,
      note,
      type: "DAMAGE",
      createdById: req.user.id,
    });
    return res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === "INSUFFICIENT_STOCK") return res.status(409).json({ message: e.message });
    return res.status(500).json({ message: "Server error" });
  }
});

const txnsQuerySchema = z.object({
  branchId: z.string().uuid(),
  productId: z.string().uuid().optional(),
});

/**
 * GET /inventory/txns?branchId=...&productId=...
 * Simple words:
 * - View stock history (audit)
 * - Returns last 200 txns for branch (optionally for one product)
 */
inventoryRouter.get("/inventory/txns", requireAuth, async (req, res) => {
  const parsed = txnsQuerySchema.safeParse({
    branchId: req.query.branchId,
    productId: req.query.productId,
  });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, productId } = parsed.data;

  // Validate branch exists + active
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return res.status(404).json({ message: "Branch not found" });
  if (!branch.isActive) return res.status(409).json({ message: "Branch is inactive" });

  const txns = await prisma.stockTxn.findMany({
    where: { branchId, ...(productId ? { productId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, role: true } },
    },
  });

  res.json({ txns });
});
