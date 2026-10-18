/**
 * Resets a user's password from the command line.
 *
 * There is no SMTP in this deployment, so this is the recovery path. It runs
 * bundled inside the container:
 *
 *   ./scripts/reset-password.sh correo@example.com 'contraseña-nueva'
 *
 * All existing sessions of that user are deleted, so a leaked cookie stops
 * working the moment the password changes.
 */
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { sessions, users } from '../lib/db/schema';

const PASSWORD_MIN_LENGTH = 12;

async function main() {
  const [rawEmail, password] = process.argv.slice(2);

  if (!rawEmail || !password) {
    console.error('Uso: node reset-password.mjs <email> <contraseña>');
    process.exit(1);
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL no está definida.');
    process.exit(1);
  }

  const email = rawEmail.trim().toLowerCase();
  const sql = postgres(connectionString, { max: 1 });

  try {
    const db = drizzle(sql);

    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      console.error(`No existe ningún usuario con el email ${email}.`);
      process.exit(1);
    }

    const passwordHash = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const removed = await db
      .delete(sessions)
      .where(eq(sessions.userId, user.id))
      .returning({ id: sessions.id });

    console.log(`Contraseña actualizada para ${user.name} <${user.email}>.`);
    console.log(`Sesiones cerradas: ${removed.length}.`);
  } finally {
    await sql.end();
  }
}

await main();
