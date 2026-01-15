/**
 * Middleware to protect routes using JWT token.
 * If token is valid -> req.user is available.
 */
import jwt from "jsonwebtoken";
import { ENV } from "../config/env";

export type AuthedUser = {
  id: string;
  role: "MANAGER" | "EMPLOYEE";
  email: string;
  name: string;
};

export function requireAuth(req: any, res: any, next: any) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) return res.status(401).json({ message: "Missing token" });

    const decoded = jwt.verify(token, ENV.JWT_SECRET) as AuthedUser;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid/expired token" });
  }
}

/**
 * Role guard: allow only specific roles (ex: MANAGER).
 */
export function requireRole(...roles: AuthedUser["role"][]) {
  return (req: any, res: any, next: any) => {
    const user = req.user as AuthedUser | undefined;
    if (!user) return res.status(401).json({ message: "Not logged in" });

    if (!roles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden (role not allowed)" });
    }

    next();
  };
}
