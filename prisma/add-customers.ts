import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

try {
  process.loadEnvFile("../.env");
} catch {
  // Environment variables may already be supplied by the process.
}

process.env.DATABASE_URL ??= process.env.NEON_DB;
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

const prisma = new PrismaClient();

// ─── Data pools ───────────────────────────────────────────────────────────────

const firstNames = [
  "Aarav", "Aditi", "Arjun", "Diya", "Ishaan", "Kavya", "Mira", "Neel",
  "Priya", "Rohan", "Sara", "Vihaan", "Ananya", "Dev", "Ishita", "Kabir",
  "Meera", "Nikhil", "Pooja", "Rahul", "Sneha", "Vikram", "Aisha", "Bharat",
  "Charu", "Dhruv", "Esha", "Farhan", "Gita", "Harsh", "Jaya", "Kunal",
  "Lakshmi", "Manav", "Nisha", "Om", "Payal", "Riya", "Sahil", "Tanvi",
  "Uday", "Varun", "Yash", "Zara", "Amit", "Bhavana", "Chirag", "Deepa",
  "Gaurav", "Hema"
];

const lastNames = [
  "Sharma", "Patel", "Mehta", "Iyer", "Kapoor", "Reddy", "Gupta", "Nair",
  "Singh", "Kumar", "Joshi", "Desai", "Rao", "Mishra", "Chauhan", "Verma",
  "Agarwal", "Shah", "Bose", "Das"
];

const cities = [
  "Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad",
  "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow",
  "Chandigarh", "Kochi", "Indore", "Bhopal", "Nagpur"
];

const tags = [
  "vip", "inactive", "loyal", "new", "high-value",
  "frequent", "win-back", "engaged", "premium", "wholesale"
];

const categories = [
  "coffee", "fashion", "beauty", "electronics", "home",
  "sports", "books", "grocery", "wellness", "gadgets"
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPhone(): string {
  // Indian mobile numbers: +91 followed by 10 digits starting with 6-9
  const prefix = randomFrom(["6", "7", "8", "9"]);
  const rest = String(randomInt(100000000, 999999999));
  return `+91${prefix}${rest}`;
}

function randomTags(): string[] {
  const count = randomInt(1, 3);
  const shuffled = [...tags].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randomDateInLastNDays(maxDays: number): Date {
  const daysAgo = randomInt(0, maxDays);
  const hoursAgo = randomInt(0, 23);
  const minutesAgo = randomInt(0, 59);
  return new Date(
    Date.now() -
      daysAgo * 24 * 60 * 60 * 1000 -
      hoursAgo * 60 * 60 * 1000 -
      minutesAgo * 60 * 1000
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🚀 Adding 100 customers to the database...\n");

  const customers: Prisma.CustomerCreateManyInput[] = [];

  for (let i = 0; i < 100; i++) {
    const first = firstNames[i % firstNames.length]!;
    const last = lastNames[Math.floor(i / firstNames.length) % lastNames.length]!;
    const name = `${first} ${last}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i + 1}@gmail.com`;
    const phone = randomPhone();
    const customerTags = randomTags();
    const city = randomFrom(cities);
    const emailEngagement = randomInt(10, 95);
    const preferredCategory = randomFrom(categories);
    const createdAt = randomDateInLastNDays(180);

    customers.push({
      id: randomUUID(),
      name,
      email,
      phone,
      tags: customerTags,
      metadata: {
        city,
        emailEngagement,
        preferredCategory,
        source: randomFrom(["website", "shopify", "referral", "social-media", "in-store"]),
       loyaltyTier: randomFrom(["bronze", "silver", "gold", "platinum"])
      },
      createdAt
    });
  }

  // Insert customers in batches
  await prisma.customer.createMany({
    data: customers,
    skipDuplicates: true
  });

  console.log(`✅ Inserted ${customers.length} customers\n`);

  // ─── Create orders for each customer ──────────────────────────────────────────

  const orders: Prisma.OrderCreateManyInput[] = [];

  for (const customer of customers) {
    const orderCount = randomInt(1, 8);
    for (let j = 0; j < orderCount; j++) {
      orders.push({
        id: randomUUID(),
        customerId: customer.id!,
        amount: new Prisma.Decimal(
          (randomInt(100, 15000) + randomInt(0, 99) / 100).toFixed(2)
        ),
        items: [
          {
            sku: `SKU-${String(randomInt(1, 200)).padStart(3, "0")}`,
            quantity: randomInt(1, 5),
            category: randomFrom(categories)
          }
        ],
        createdAt: randomDateInLastNDays(120)
      });
    }
  }

  // Insert orders in batches of 500
  for (let i = 0; i < orders.length; i += 500) {
    const batch = orders.slice(i, i + 500);
    await prisma.order.createMany({ data: batch });
  }

  console.log(`✅ Inserted ${orders.length} orders for 100 customers\n`);

  // ─── Print summary ────────────────────────────────────────────────────────────

  const cityDistribution: Record<string, number> = {};
  const tagDistribution: Record<string, number> = {};

  for (const c of customers) {
    const city = (c.metadata as Record<string, unknown>).city as string;
    cityDistribution[city] = (cityDistribution[city] ?? 0) + 1;
    for (const t of c.tags as string[]) {
      tagDistribution[t] = (tagDistribution[t] ?? 0) + 1;
    }
  }

  console.log("📊 Customer Summary:");
  console.log(`   Total Customers: ${customers.length}`);
  console.log(`   Total Orders: ${orders.length}`);
  console.log(`   Avg Orders/Customer: ${(orders.length / customers.length).toFixed(1)}`);
  console.log();

  console.log("🏙️  City Distribution:");
  for (const [city, count] of Object.entries(cityDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${city}: ${count}`);
  }
  console.log();

  console.log("🏷️  Tag Distribution:");
  for (const [tag, count] of Object.entries(tagDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${tag}: ${count}`);
  }
  console.log();

  console.log("👤 Sample Customers (first 10):");
  console.log("─".repeat(100));
  console.log(
    "Name".padEnd(22),
    "Email".padEnd(38),
    "Phone".padEnd(15),
    "City".padEnd(12),
    "Tags"
  );
  console.log("─".repeat(100));

  for (const c of customers.slice(0, 10)) {
    const meta = c.metadata as Record<string, unknown>;
    console.log(
      c.name.padEnd(22),
      c.email.padEnd(38),
      c.phone.padEnd(15),
      String(meta.city).padEnd(12),
      (c.tags as string[]).join(", ")
    );
  }

  console.log("─".repeat(100));
  console.log("\n🎉 Done! 100 customers added successfully.");
}

main()
  .catch((error: unknown) => {
    console.error("❌ Failed to add customers:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
