/**
 * app.ts = creates Express app + middlewares + routes.
 * Keep separate from server.ts for clean structure.
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { healthRouter } from "./routes/health.routes";
import { authRouter } from "./routes/auth.routes";
import { usersRouter } from "./routes/users.routes";
import { branchesRouter } from "./routes/branches.routes";
import { categoriesRouter } from "./routes/categories.routes";
import { productsRouter } from "./routes/products.routes";
import { inventoryRouter } from "./routes/inventory.routes";
import { salesRouter } from "./routes/sales.routes";
import { invoicesRouter } from "./routes/invoices.routes";
import { reportsRouter } from "./routes/reports.routes"; // ✅ add this

export const app = express();

app.use(helmet());
app.use(cors({ origin: ["http://localhost:3000"], credentials: false }));
app.use(morgan("dev"));
app.use(express.json());

app.use(healthRouter);
app.use(authRouter);
app.use(usersRouter);
app.use(branchesRouter);
app.use(categoriesRouter);
app.use(productsRouter);
app.use(inventoryRouter);
app.use(salesRouter);
app.use(invoicesRouter);
app.use(reportsRouter); // ✅ add this

// simple error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("❌ Error:", err);
  res.status(500).json({ message: "Server error" });
});
