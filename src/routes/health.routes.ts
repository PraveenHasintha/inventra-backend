/**
 * Health route = quick test to see backend is running.
 */
import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, app: "inventra-backend" });
});
