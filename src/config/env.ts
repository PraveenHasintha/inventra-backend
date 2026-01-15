/**
 * Reads env variables safely.
 * If something important is missing, we stop early (prevents hidden errors).
 */
import "dotenv/config";

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const ENV = {
  PORT: Number(process.env.PORT || 5000),
  DATABASE_URL: must("DATABASE_URL"),
  JWT_SECRET: must("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d"
};
