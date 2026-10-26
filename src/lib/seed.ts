import { eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { initials } from "./format";
import { ensureDefaultGroups } from "./access";
import { hashPassword, isHashedPassword } from "./password";

const EMAIL_MIGRATIONS: Record<string, string> = {
  "admin@soluti.dev": "admin@frxconstruction.ca",
  "marc@soluti.dev": "marc@frxconstruction.ca",
  "lea@soluti.dev": "lea@frxconstruction.ca",
  "noah@soluti.dev": "noah@frxconstruction.ca",
};

async function migrateLegacyBrand() {
  const users = await db.select().from(schema.users);
  for (const user of users) {
    const next = EMAIL_MIGRATIONS[user.email.toLowerCase()];
    if (next) {
      await db.update(schema.users).set({ email: next }).where(eq(schema.users.id, user.id));
    }
    if (user.password === "forge123" || user.password === "frx123" || user.password === "admin123" || user.password === "client123") {
      await db.update(schema.users).set({ password: await hashPassword(user.password === "forge123" ? "frx123" : user.password) }).where(eq(schema.users.id, user.id));
    } else if (user.password && !isHashedPassword(user.password)) {
      await db.update(schema.users).set({ password: await hashPassword(user.password) }).where(eq(schema.users.id, user.id));
    }
  }
}

let seedPromise: Promise<void> | null = null;

export async function seedIfEmpty() {
  if (!seedPromise) {
    seedPromise = seedIfEmptyInner().finally(() => {
      seedPromise = null;
    });
  }
  return seedPromise;
}

export async function hasAnyUsers() {
  await dbReady;
  const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return existing.length > 0;
}

export async function createFirstAdmin(input: { name: string; email: string; password: string }) {
  await dbReady;
  if (await hasAnyUsers()) return "login.setup.exists";
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const password = input.password;
  if (!name || !email || password.length < 8) return "login.setup.invalid";
  await db.insert(schema.users).values({
    name,
    email,
    password: await hashPassword(password),
    user_type: "internal",
    title: "Administrator",
    phone: null,
    is_active: 1,
    is_admin: 1,
    avatar_initials: initials(name),
    locale: "en",
    theme: "light",
    all_clients: 1,
  });
  await ensureDefaultGroups();
  return null;
}

async function upsertUser(values: {
  name: string;
  email: string;
  password: string;
  user_type: "internal" | "external";
  title: string;
  phone: string | null;
  is_admin: number;
  locale: "en" | "fr";
  all_clients?: number;
}) {
  const email = values.email.toLowerCase();
  const found = await db.select().from(schema.users).where(eq(schema.users.email, email));
  const hashed = isHashedPassword(values.password) ? values.password : await hashPassword(values.password);
  if (found[0]) {
    await db
      .update(schema.users)
      .set({
        password: found[0].password && isHashedPassword(found[0].password) ? found[0].password : hashed,
        is_active: 1,
        is_admin: values.is_admin,
        name: values.name,
        user_type: values.user_type,
      })
      .where(eq(schema.users.id, found[0].id));
    return found[0];
  }
  const [row] = await db
    .insert(schema.users)
    .values({
      name: values.name,
      email,
      password: hashed,
      user_type: values.user_type,
      title: values.title,
      phone: values.phone,
      is_active: 1,
      is_admin: values.is_admin,
      avatar_initials: initials(values.name),
      locale: values.locale,
      theme: "light",
      all_clients: values.all_clients ?? (values.user_type === "internal" && values.is_admin ? 1 : 0),
      must_change_password: 0,
      tutorial_done: 0,
    })
    .returning();
  return row;
}

async function seedIfEmptyInner() {
  await dbReady;
  await migrateLegacyBrand();
  await ensureDefaultGroups();

  if (await hasAnyUsers()) return;

  await upsertUser({
    name: "Administrator",
    email: "admin@frxconstruction.ca",
    password: "admin123",
    user_type: "internal",
    title: "Administrator",
    phone: null,
    is_admin: 1,
    locale: "en",
    all_clients: 1,
  });
}
