import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/dev/seed-data";

try {
  process.loadEnvFile("../.env");
} catch {
  // Environment variables may already be supplied by the process.
}

process.env.DATABASE_URL ??= process.env.NEON_DB;
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

const prisma = new PrismaClient();

const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error("SEED_ADMIN_PASSWORD environment variable is required");
  process.exit(1);
}

seedDatabase(prisma, {
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? "admin@xeno.local",
  adminPassword
})
  .then((result) => {
    console.log("Seed completed", result);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
