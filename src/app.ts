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

export const app = express();

app.use(helmet()); // security headers
app.use(cors({ origin: ["http://localhost:3000"], credentials: false })); // allow frontend
app.use(morgan("dev")); // request log
app.use(express.json()); // parse JSON body

app.use(healthRouter);
app.use(authRouter);
app.use(usersRouter);

// simple error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("❌ Error:", err);
  res.status(500).json({ message: "Server error" });
});
