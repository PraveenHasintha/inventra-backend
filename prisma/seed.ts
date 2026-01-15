/**
 * Seed = create the first Manager account automatically.
 * Because manager should NOT be public signup.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db";

async function main() {
  const email = process.env.SEED_MANAGER_EMAIL!;
  const password = process.env.SEED_MANAGER_PASSWORD!;
  const name = process.env.SEED_MANAGER_NAME || "Main Manager";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("✅ Manager already exists:", email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: "MANAGER"
    }
  });

  console.log("✅ Seeded MANAGER:", email);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
