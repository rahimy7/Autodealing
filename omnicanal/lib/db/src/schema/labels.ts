import { serial, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// What a label is for. Two families share the table because both end up as
// "label" nodes in a workflow graph, but they are decided by different things:
//   - intent:   what the customer wants ("Ventas", "Soporte"). The AI classifier
//               picks exactly one per conversation.
//   - locality: where the customer is ("Sucursal Santiago"). Never classified by
//               the AI — it comes from the zone the customer gave, and it is what
//               decides which store's people receive the handoff.
export const labelKindEnum = pgEnum("label_kind", ["intent", "locality"]);

// Dynamic, user-created intent labels. Created from the Workflow view and used to
// tag the customer's intent on each conversation (e.g. "Saludo", "Soporte Nivel II").
// Replaces the old fixed `conversation_label` enum as the source of intent tagging.
export const labelsTable = pgTable("labels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // url/keyword-safe identifier the AI classifier matches against
  slug: text("slug").notNull(),
  kind: labelKindEnum("kind").notNull().default("intent"),
  // hex color used to render the label chip in the inbox
  color: text("color").notNull().default("#14b8a6"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  // When true, the virtual agent may auto-publish a reply to a public comment
  // classified with this label (e.g. FAQ intents: address, hours, phone). When
  // false, the reply is saved as a DRAFT and a human must approve it before it
  // reaches the post. Public replies are visible to everyone, so unsafe intents
  // (complaints, negotiations, delicate topics) stay behind human review.
  isSafeForAutoReply: boolean("is_safe_for_auto_reply").notNull().default(false),
  // El mismo permiso, pero para el CORREO, y por separado a propósito: una
  // respuesta pública en Facebook la lee cualquiera y un correo lo lee una sola
  // persona, así que lo que se puede contestar solo no es lo mismo en los dos
  // sitios. Con un único campo, autorizar el correo habría puesto a publicar
  // comentarios sin revisión de rebote.
  isSafeForEmailAutoReply: boolean("is_safe_for_email_auto_reply").notNull().default(false),
  // When true and a customer's comment is classified with this label, the
  // workflow will auto-migrate the thread to a DM (Private Reply) instead of
  // answering publicly. Meant for support / complaint intents.
  autoMigrateToDm: boolean("auto_migrate_to_dm").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // The intent classifier considers every ACTIVE label, so two active labels with
  // the same slug would compete and make routing ambiguous. Enforce uniqueness on
  // active labels only (historical/inactive duplicates are harmless and left as-is).
  activeSlugUnique: uniqueIndex("labels_active_slug_unique").on(t.slug).where(sql`${t.isActive}`),
}));

export const insertLabelSchema = createInsertSchema(labelsTable).omit({ id: true, createdAt: true });
export type InsertLabel = z.infer<typeof insertLabelSchema>;
export type Label = typeof labelsTable.$inferSelect;
