import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const inventoryRouter = Router();

/**
 * GET /inventory?branchId=...&search=...
 * - Shows current stock list for a branch
 * - Works for both MANAGER + EMPLOYEE (any logged-in user)
 */
inventoryRouter.get("/inventory", requireAuth, async (req, res) => {
  const branchId = (req.query.branchId as string | undefined)?.trim();
  const search = (req.query.search as string | undefined)?.trim();

  if (!branchId) return res.status(400).json({ message: "branchId is required" });

  const where: any = { branchId };

  if (search) {
    where.product = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ],
    };
  }

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
 * - Manager receives stock into a branch
 */
inventoryRouter.post(
  "/inventory/receive",
  requireAuth,
  requireRole("MANAGER"),
  async (req: any, res) => {
    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const { branchId, productId, quantity, note } = parsed.data;

    // Ensure branch/product exist
    const [branch, product] = await Promise.all([
      prisma.branch.findUnique({ where: { id: branchId } }),
      prisma.product.findUnique({ where: { id: productId } }),
    ]);

    if (!branch) return res.status(404).json({ message: "Branch not found" });
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Upsert StockItem (create if not exists)
    const item = await prisma.stockItem.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, quantity },
      update: { quantity: { increment: quantity } },
      include: { product: true, branch: true },
    });

    // Create txn record
    const txn = await prisma.stockTxn.create({
      data: {
        type: "RECEIVE",
        branchId,
        productId,
        qtyChange: quantity,
        note,
        createdById: req.user.id,
      },
    });

    res.status(201).json({ item, txn });
  }
);

const adjustSchema = z.object({
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  newQuantity: z.number().int().nonnegative(),
  note: z.string().optional(),
});

/**
 * POST /inventory/adjust
 * - Manager sets stock to a new quantity (correction)
 */
inventoryRouter.post(
  "/inventory/adjust",
  requireAuth,
  requireRole("MANAGER"),
  async (req: any, res) => {
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const { branchId, productId, newQuantity, note } = parsed.data;

    const existing = await prisma.stockItem.findUnique({
      where: { branchId_productId: { branchId, productId } },
    });

    const oldQty = existing?.quantity ?? 0;
    const change = newQuantity - oldQty;

    const item = await prisma.stockItem.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, quantity: newQuantity },
      update: { quantity: newQuantity },
      include: { product: true, branch: true },
    });

    const txn = await prisma.stockTxn.create({
      data: {
        type: "ADJUST",
        branchId,
        productId,
        qtyChange: change,
        note: note || "Manual adjustment",
        createdById: req.user.id,
      },
    });

    res.json({ item, txn });
  }
);

const txnsQuerySchema = z.object({
  branchId: z.string().uuid(),
  productId: z.string().uuid().optional(),
});

/**
 * GET /inventory/txns?branchId=...&productId=...
 * - View stock history (audit)
 */
inventoryRouter.get("/inventory/txns", requireAuth, async (req, res) => {
  const parsed = txnsQuerySchema.safeParse({
    branchId: req.query.branchId,
    productId: req.query.productId,
  });

  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, productId } = parsed.data;

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
