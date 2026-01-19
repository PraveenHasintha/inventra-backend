// inventra-backend/src/routes/sales.routes.ts
// Simple words: Billing checkout -> creates invoice, reduces stock, logs StockTxn(SALE), returns invoice for printing.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const salesRouter = Router();

/**
 * POST /sales/checkout
 * Creates an invoice (INV-000001), invoice items, reduces stock, and logs StockTxn(SALE).
 * Any logged-in user can do checkout (MANAGER or EMPLOYEE).
 */
const checkoutSchema = z.object({
  branchId: z.string().uuid(),
  note: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().positive(),
        unitPrice: z.number().int().nonnegative().optional(), // optional: server can use product.sellingPrice
      })
    )
    .min(1, "At least one item is required"),
});

salesRouter.post("/sales/checkout", requireAuth, async (req: any, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const { branchId, note, items } = parsed.data;

  // Branch must exist
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return res.status(404).json({ message: "Branch not found" });
  if (!branch.isActive) return res.status(409).json({ message: "Branch is inactive" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Load products in one go
      const productIds = [...new Set(items.map((i) => i.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          sellingPrice: true,
          isActive: true,
        },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));

      // Validate products exist & active
      for (const it of items) {
        const p = productMap.get(it.productId);
        if (!p) throw new Error(`Product not found: ${it.productId}`);
        if (!p.isActive) throw new Error(`Product inactive: ${p.name}`);
      }

      // Check stock availability (before changing anything)
      for (const it of items) {
        const existing = await tx.stockItem.findUnique({
          where: { branchId_productId: { branchId, productId: it.productId } },
        });

        const available = existing?.quantity ?? 0;
        if (available < it.qty) {
          const p = productMap.get(it.productId)!;
          throw new Error(`Not enough stock for ${p.name} (${p.sku}). Available: ${available}`);
        }
      }

      // Create invoice record first (no invoiceNo yet)
      const invoice = await tx.invoice.create({
        data: {
          invoiceNo: null,
          branchId,
          createdById: req.user.id,
          note: note?.trim() ? note.trim() : null,
          total: 0,
        },
        select: { id: true },
      });

      // Invoice number format: INV-000001 (6 digits)
      const invoiceNo = `INV-${String(invoice.id).padStart(6, "0")}`;

      // Reduce stock + create StockTxn + create InvoiceItems
      let total = 0;

      for (const it of items) {
        const p = productMap.get(it.productId)!;
        const unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : p.sellingPrice;

        const lineTotal = unitPrice * it.qty;
        total += lineTotal;

        await tx.stockItem.update({
          where: { branchId_productId: { branchId, productId: it.productId } },
          data: { quantity: { decrement: it.qty } },
        });

        await tx.stockTxn.create({
          data: {
            type: "SALE",
            branchId,
            productId: it.productId,
            qtyChange: -it.qty,
            note: invoiceNo, // store invoiceNo as reference
            createdById: req.user.id,
          },
        });

        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: it.productId,
            qty: it.qty,
            unitPrice,
            lineTotal,
          },
        });
      }

      // Update invoice with final invoiceNo + total and return full invoice
      const finalInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: { invoiceNo, total },
        select: {
          id: true,
          publicId: true,
          invoiceNo: true,
          note: true,
          total: true,
          createdAt: true,
          branch: {
            // include shop info for receipt print
            select: { id: true, name: true, address: true, phone: true },
          },
          createdBy: { select: { id: true, name: true, role: true } },
          items: {
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

      return finalInvoice;
    });

    return res.status(201).json({ invoice: result });
  } catch (e: any) {
    const msg = e?.message || "Checkout failed";
    if (msg.startsWith("Not enough stock") || msg.startsWith("Product ")) {
      return res.status(409).json({ message: msg });
    }
    return res.status(500).json({ message: "Server error" });
  }
});
