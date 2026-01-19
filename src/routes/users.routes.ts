/**
 * inventra-backend/src/routes/users.routes.ts
 * Simple words:
 * - Manager can create staff users
 * - Manager can view user list
 * - Manager can update user (role / active / name)
 * - Manager can reset passwords
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const usersRouter = Router();

/** Create user (manager only) */
const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["MANAGER", "EMPLOYEE"]),
});

usersRouter.post("/users", requireAuth, requireRole("MANAGER"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { name, email, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ message: "Email already exists" });

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });

  res.status(201).json({ user });
});

/** List users (manager only) */
const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

usersRouter.get("/users", requireAuth, requireRole("MANAGER"), async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { search, take } = parsed.data;

  const where: any = {};
  if (search && search.length > 0) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take ?? 100,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json({ users });
});

/** Update user (manager only) */
const updateParamsSchema = z.object({
  id: z.string().uuid(),
});

const updateUserSchema = z
  .object({
    name: z.string().min(2).optional(),
    role: z.enum(["MANAGER", "EMPLOYEE"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "At least one field is required");

usersRouter.put("/users/:id", requireAuth, requireRole("MANAGER"), async (req: any, res) => {
  const p = updateParamsSchema.safeParse(req.params);
  if (!p.success) return res.status(400).json({ message: p.error.message });

  const b = updateUserSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ message: b.error.message });

  const targetId = p.data.id;
  const { name, role, isActive } = b.data;

  // Simple safety: manager cannot deactivate or change their own role by mistake
  if (req.user?.id === targetId) {
    if (isActive === false) return res.status(409).json({ message: "You cannot deactivate your own account" });
    if (role) return res.status(409).json({ message: "You cannot change your own role" });
  }

  const existing = await prisma.user.findUnique({ where: { id: targetId } });
  if (!existing) return res.status(404).json({ message: "User not found" });

  const updated = await prisma.user.update({
    where: { id: targetId },
    data: {
      ...(typeof name === "string" ? { name } : {}),
      ...(role ? { role } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
    },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true },
  });

  res.json({ user: updated });
});

/** Reset password (manager only) */
const resetPwdSchema = z.object({
  newPassword: z.string().min(6),
});

usersRouter.post("/users/:id/reset-password", requireAuth, requireRole("MANAGER"), async (req: any, res) => {
  const p = updateParamsSchema.safeParse(req.params);
  if (!p.success) return res.status(400).json({ message: p.error.message });

  const b = resetPwdSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ message: b.error.message });

  const targetId = p.data.id;

  const existing = await prisma.user.findUnique({ where: { id: targetId } });
  if (!existing) return res.status(404).json({ message: "User not found" });

  const passwordHash = await bcrypt.hash(b.data.newPassword, 10);

  await prisma.user.update({
    where: { id: targetId },
    data: { passwordHash },
  });

  res.json({ message: "Password reset successfully" });
});
