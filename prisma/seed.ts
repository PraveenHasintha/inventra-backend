/**
 * Seed = create the first Manager account automatically.
 * Because manager should NOT be public signup.
 *
 * ALSO seeds:
 * - default Branch
 * - default Categories (Stationery, Electronics, etc.)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db";

async function main() {
  const email = process.env.SEED_MANAGER_EMAIL;
  const password = process.env.SEED_MANAGER_PASSWORD;
  const name = process.env.SEED_MANAGER_NAME || "Main Manager";

  if (!email || !password) {
    throw new Error("Missing SEED_MANAGER_EMAIL or SEED_MANAGER_PASSWORD in .env");
  }

  // 1) Seed MANAGER (do not return early)
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    console.log("✅ Manager already exists:", email);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "MANAGER",
      },
    });

    console.log("✅ Seeded MANAGER:", email);
  }

  // 2) Seed default Branch
  const existingBranch = await prisma.branch.findFirst();

  if (existingBranch) {
    console.log("✅ Branch already exists:", existingBranch.name);
  } else {
    await prisma.branch.create({
      data: {
        name: "Main Branch",
        address: "Default address",
        phone: "0000000000",
      },
    });

    console.log("✅ Seeded default Branch: Main Branch");
  }

  // 3) Seed default Categories (if none exist)
  const existingCategory = await prisma.category.findFirst();

  if (existingCategory) {
    console.log("✅ Categories already exist (skipping category seed)");
  } else {
    const stationery = await prisma.category.create({
      data: { name: "Stationery" },
    });

    const electronics = await prisma.category.create({
      data: { name: "Electronics" },
    });

    await prisma.category.createMany({
      data: [
        { name: "Pens", parentId: stationery.id },
        { name: "Notebooks", parentId: stationery.id },
        { name: "Chargers", parentId: electronics.id },
        { name: "Headphones", parentId: electronics.id },
      ],
    });

    console.log("✅ Seeded default Categories: Stationery, Electronics + subcategories");
  }
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
