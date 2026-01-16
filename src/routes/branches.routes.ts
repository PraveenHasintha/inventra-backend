import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const branchesRouter = Router();

const createBranchSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  phone: z.string().optional(),
});

const updateBranchSchema = z.object({
  name: z.string().min(2).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Public: List branches (useful for selection later)
branchesRouter.get("/branches", async (_req, res) => {
  const branches = await prisma.branch.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json({ branches });
});

// Manager: Create a branch
branchesRouter.post(
  "/branches",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = createBranchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const branch = await prisma.branch.create({
      data: parsed.data,
    });

    res.status(201).json({ branch });
  }
);

// Manager: Update a branch
branchesRouter.put(
  "/branches/:id",
  requireAuth,
  requireRole("MANAGER"),
  async (req, res) => {
    const parsed = updateBranchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const { id } = req.params;

    const branch = await prisma.branch.update({
      where: { id },
      data: parsed.data,
    });

    res.json({ branch });
  }
);
