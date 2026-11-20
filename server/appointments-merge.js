// The agenda is one table: the site's `appointments`, which Omnicanal reads and writes too
// (README: Agenda). Omnicanal used to keep an `appointments` table of its own in its schema. This
// brings anything left in it into the shared table and removes it, so Omnicanal's schema update
// (drizzle-kit push) finds nothing to drop. Runs before that update, in one transaction: either
// every row moves and the old table goes, or nothing changes.
import pg from "pg";

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

// `client` is a connected pg client. `site` and `omni` are the schemas of the two applications.
export async function mergeLegacyAppointments(client, { site = "public", omni = "omnicanal" } = {}) {
  const legacy = `${ident(omni)}.appointments`;
  const shared = `${ident(site)}.appointments`;
  const { rows: found } = await client.query("SELECT to_regclass($1) AS t", [legacy]);
  if (!found[0].t) return { merged: 0, linked: 0, dropped: false };
  // Only the old shape: Omnicanal's own table has `contact_id`, the shared one `omni_contact_id`.
  const { rowCount: oldShape } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='appointments' AND column_name='contact_id'",
    [omni],
  );
  if (!oldShape) return { merged: 0, linked: 0, dropped: false };

  await client.query("BEGIN");
  try {
    const { rows: seq } = await client.query("SELECT pg_get_serial_sequence($1, 'omni_appointment_id') AS name", [shared]);
    if (!seq[0].name) throw new Error("La tabla de citas del sitio aún no tiene su numeración.");
    // Their numbers stay free of the ones about to be copied.
    await client.query(
      `SELECT setval($1, greatest((SELECT coalesce(max(id),0) FROM ${legacy}), (SELECT coalesce(max(omni_appointment_id),0) FROM ${shared}), 1))`,
      [seq[0].name],
    );
    // A row of the site that was already sent to Omnicanal is the same appointment as its old
    // row there: it stays, and takes what Omnicanal had added (reminder, place, service).
    const linked = await client.query(
      `UPDATE ${shared} p SET service=CASE WHEN p.service='' THEN o.service ELSE p.service END,
         location=coalesce(p.location,o.location),
         reminder_sent_at=coalesce(p.reminder_sent_at,o.reminder_sent_at AT TIME ZONE 'UTC'),
         source=CASE WHEN p.source='admin' THEN o.source::text ELSE p.source END
       FROM ${legacy} o
       WHERE p.omni_appointment_id=o.id AND p.omni_contact_id IS NOT DISTINCT FROM o.contact_id AND p.starts_at=(o.starts_at AT TIME ZONE 'UTC')`,
    );
    // Every other row is copied in one statement. It keeps its number unless a different
    // appointment of the site already took it. The old times are UTC wall-clock, no zone.
    const copied = await client.query(
      `INSERT INTO ${shared}(kind,starts_at,duration_minutes,customer_name,notes,status,omni_appointment_id,omni_contact_id,omni_conversation_id,agent_id,service,location,source,reminder_sent_at,created_at,updated_at)
       SELECT 'visit',o.starts_at AT TIME ZONE 'UTC',o.duration_minutes,'',o.notes,o.status::text,
         CASE WHEN EXISTS (SELECT 1 FROM ${shared} t WHERE t.omni_appointment_id=o.id) THEN nextval($1::regclass) ELSE o.id END,
         o.contact_id,o.conversation_id,o.agent_id,o.service,o.location,o.source::text,
         o.reminder_sent_at AT TIME ZONE 'UTC',o.created_at AT TIME ZONE 'UTC',o.updated_at AT TIME ZONE 'UTC'
       FROM ${legacy} o
       WHERE NOT EXISTS (
         SELECT 1 FROM ${shared} p WHERE p.omni_appointment_id=o.id AND p.omni_contact_id IS NOT DISTINCT FROM o.contact_id AND p.starts_at=(o.starts_at AT TIME ZONE 'UTC'))
       ORDER BY o.id`,
      [seq[0].name],
    );
    await client.query(`DROP TABLE ${legacy}`);
    await client.query(`DROP TYPE IF EXISTS ${ident(omni)}.appointment_status`);
    await client.query(`DROP TYPE IF EXISTS ${ident(omni)}.appointment_source`);
    await client.query("COMMIT");
    return { merged: copied.rowCount, linked: linked.rowCount, dropped: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

// For the site's start-up: connects, merges, and reports instead of throwing, so a problem here
// is read in the log and never takes the site down.
export async function mergeLegacyAppointmentsFromUrl(connectionString, options) {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const result = await mergeLegacyAppointments(client, options);
    if (result.dropped)
      console.log(`Omnicanal: sus citas ahora son las del sitio (${result.merged} copiadas, ${result.linked} ya estaban).`);
    return true;
  } catch (error) {
    console.error("Omnicanal: no se pudieron unir sus citas con las del sitio:", error.message);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
