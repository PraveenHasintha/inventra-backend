import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const categoriesRouter = Router();

const createCategorySchema = z.object({
  name: z.string().min(2),
  parentId: z.string().uuid().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(2).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Authenticated: list categories
categoriesRouter.get("/categories", requireAuth, async (_req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: [{ parentId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      parentId: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json({ categories });
});

// Manager: create category
categoriesRouter.post(
  "/categories",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    try {
      const category = await prisma.category.create({
        data: {
          name: parsed.data.name,
          parentId: parsed.data.parentId,
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.status(201).json({ category });
    } catch (e: any) {
      // Prisma unique constraint (duplicate under same parent)
      return res.status(409).json({ message: "Category already exists under this parent" });
    }
  }
);

// Manager: update category
categoriesRouter.put(
  "/categories/:id",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const { id } = req.params;

    try {
      const category = await prisma.category.update({
        where: { id },
        data: {
          ...parsed.data,
          // If parentId is explicitly null, set it to null (make top-level)
          parentId: parsed.data.parentId === null ? null : parsed.data.parentId,
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.json({ category });
    } catch (e: any) {
      return res.status(400).json({ message: "Update failed (check id or duplicates)" });
    }
  }
);

// Manager: delete category (only if no children & no products)
categoriesRouter.delete(
  "/categories/:id",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const { id } = req.params;

    const childCount = await prisma.category.count({ where: { parentId: id } });
    if (childCount > 0) {
      return res.status(409).json({ message: "Cannot delete: category has sub-categories" });
    }

    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      return res.status(409).json({ message: "Cannot delete: category has products" });
    }

    await prisma.category.delete({ where: { id } });
    res.json({ message: "Category deleted" });
  }
);
