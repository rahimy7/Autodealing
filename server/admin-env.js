// One administration, one set of credentials. The owner's account can be kept in the environment:
// ADMIN_PASSWORD is the password of the site's administrator (user "admin"), and ADMIN_EMAIL also
// works as the name to sign in with. The same sign-in opens the administration and, inside it,
// Omnicanal (which no longer has a password form of its own when it runs in this service).
//
// Opt-in: without ADMIN_PASSWORD nothing here runs and the stored password is never touched, as
// before. With it, each start makes the account's password the one in the environment, and ends
// that account's open sessions when it changes. Rotating it is changing the variable.
import { query, transaction } from "./db.js";
import { hashPassword, verifyPassword } from "./domain.js";

export const MIN_PASSWORD = 12;

// The e-mail that stands for the "admin" user at the sign-in, only while the password is set.
export const adminAlias = (env = process.env) =>
  env.ADMIN_PASSWORD && env.ADMIN_EMAIL ? String(env.ADMIN_EMAIL).trim().toLowerCase() : "";

// Returns what happened: "unset", "short", "missing", "same" or "updated".
export async function syncAdminFromEnv(env = process.env, log = console) {
  const password = env.ADMIN_PASSWORD;
  if (!password) return "unset";
  if (password.length < MIN_PASSWORD) {
    log.error(`ADMIN_PASSWORD debe tener al menos ${MIN_PASSWORD} caracteres: el sitio no la usa.`);
    return "short";
  }
  const { rows } = await query("SELECT id,password_hash FROM admin_users WHERE username='admin' AND role='admin' AND active");
  if (!rows[0]) {
    log.error('ADMIN_PASSWORD está definida, pero no hay una cuenta de administración activa llamada «admin».');
    return "missing";
  }
  if (await verifyPassword(password, rows[0].password_hash)) return "same";
  const hash = await hashPassword(password);
  await transaction(async (c) => {
    await c.query("UPDATE admin_users SET password_hash=$2 WHERE id=$1", [rows[0].id, hash]);
    await c.query("DELETE FROM sessions WHERE user_id=$1", [rows[0].id]);
    await c.query("INSERT INTO audit_log(user_id,action,entity_id) VALUES(NULL,'password.changed.env',$1)", [rows[0].id]);
  });
  log.log("Administración: la contraseña de «admin» se tomó de ADMIN_PASSWORD.");
  return "updated";
}
