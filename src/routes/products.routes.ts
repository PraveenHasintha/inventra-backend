import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const productsRouter = Router();

const createProductSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  sku: z.string().min(2),
  barcode: z.string().optional(),
  unit: z.string().min(1).optional(),
  costPrice: z.number().int().nonnegative(),
  sellingPrice: z.number().int().nonnegative(),
  categoryId: z.string().uuid().optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  sku: z.string().min(2).optional(),
  barcode: z.string().optional().nullable(),
  unit: z.string().min(1).optional(),
  costPrice: z.number().int().nonnegative().optional(),
  sellingPrice: z.number().int().nonnegative().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Authenticated: list products (supports search + category filter)
productsRouter.get("/products", requireAuth, async (req, res) => {
  const search = (req.query.search as string | undefined)?.trim();
  const categoryId = (req.query.categoryId as string | undefined)?.trim();
  const isActive = req.query.isActive as string | undefined;

  const where: any = {};

  if (typeof isActive === "string") {
    if (isActive === "true") where.isActive = true;
    if (isActive === "false") where.isActive = false;
  }

  if (categoryId) where.categoryId = categoryId;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search, mode: "insensitive" } },
    ];
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { id: true, name: true, parentId: true } },
    },
  });

  res.json({ products });
});

// Authenticated: get one product
productsRouter.get("/products/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, parentId: true } },
    },
  });

  if (!product) return res.status(404).json({ message: "Product not found" });

  res.json({ product });
});

// Manager: create product
productsRouter.post(
  "/products",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    try {
      const product = await prisma.product.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description,
          sku: parsed.data.sku,
          barcode: parsed.data.barcode,
          unit: parsed.data.unit || "PCS",
          costPrice: parsed.data.costPrice,
          sellingPrice: parsed.data.sellingPrice,
          categoryId: parsed.data.categoryId,
        },
        include: {
          category: { select: { id: true, name: true, parentId: true } },
        },
      });

      res.status(201).json({ product });
    } catch (e: any) {
      return res.status(409).json({ message: "SKU or barcode already exists" });
    }
  }
);

// Manager: update product
productsRouter.put(
  "/products/:id",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const { id } = req.params;

    try {
      const product = await prisma.product.update({
        where: { id },
        data: {
          ...parsed.data,
          // allow clearing barcode or category
          barcode: parsed.data.barcode === null ? null : parsed.data.barcode,
          categoryId: parsed.data.categoryId === null ? null : parsed.data.categoryId,
        },
        include: {
          category: { select: { id: true, name: true, parentId: true } },
        },
      });

      res.json({ product });
    } catch (e: any) {
      return res.status(400).json({ message: "Update failed (check id / duplicates)" });
    }
  }
);

// Manager: "delete" product = soft delete (isActive=false)
productsRouter.delete(
  "/products/:id",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const { id } = req.params;

    const product = await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ message: "Product deactivated", productId: product.id });
  }
);
