import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Auth } from "../auth.js";
import type { Database } from "../db/client.js";
import { notes, user } from "../db/schema.js";
import {
  createNoteContract,
  getNoteContract,
  listNotesContract,
} from "../contracts/notes.js";
import { createRateLimit } from "../plugins/rate-limit.js";
import { requireSession } from "../plugins/session.js";

export const MAX_NOTES_PER_USER = 1000;
export const CREATES_PER_MINUTE = 30;

const toNote = (note: typeof notes.$inferSelect) => ({
  id: note.id,
  title: note.title,
  body: note.body,
  createdAt: note.createdAt.toISOString(),
});
const toCursor = (note: typeof notes.$inferSelect) =>
  note.createdAt.getTime() + "_" + note.id;
// fastify 5.12 also aborts request.signal once a request body is read, so only the deadline's own reason counts
const pastDeadline = (request: FastifyRequest) =>
  request.signal.reason?.code === "FST_ERR_HANDLER_TIMEOUT";

export const notesRoutes: FastifyPluginAsync<{
  auth: Auth;
  db: Database;
}> = async (app, { auth, db }) => {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const createLimit = createRateLimit(CREATES_PER_MINUTE, 60000);
  routes.get(
    "/api/notes",
    { schema: listNotesContract },
    async (request, reply) => {
      const session = await requireSession(auth, request, reply);
      if (!session) return;
      const { limit, cursor } = request.query;
      let after;
      if (cursor) {
        const [time, id] = cursor.split("_");
        const createdAt = new Date(Number(time)).toISOString();
        // a row comparison lets Postgres seek the (owner_id, created_at, id) index
        after = sql`(${notes.createdAt}, ${notes.id}) < (${createdAt}::timestamptz, ${id}::uuid)`;
      }
      const rows = await db
        .select()
        .from(notes)
        .where(and(eq(notes.ownerId, session.user.id), after))
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(limit + 1);
      const items = rows.slice(0, limit);
      return reply.send({
        items: items.map(toNote),
        nextCursor:
          rows.length > limit ? toCursor(items[items.length - 1]) : null,
      });
    },
  );
  routes.post(
    "/api/notes",
    { schema: createNoteContract },
    async (request, reply) => {
      const session = await requireSession(auth, request, reply);
      if (!session) return;
      const retryAfter = createLimit.take(session.user.id);
      if (retryAfter > 0) {
        return reply
          .code(429)
          .header("retry-after", retryAfter)
          .send({ error: "Too many requests" });
      }
      const result = await db.transaction(async (tx) => {
        // locking the owner row makes concurrent creates count one at a time
        const [owner] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, session.user.id))
          .for("no key update");
        if (!owner) return { status: 401 as const };
        const [{ total }] = await tx
          .select({ total: count() })
          .from(notes)
          .where(eq(notes.ownerId, session.user.id));
        if (total >= MAX_NOTES_PER_USER) return { status: 409 as const };
        // the deadline already answered 503, so roll back instead of saving a note the client was told failed
        if (pastDeadline(request)) throw request.signal.reason;
        const [created] = await tx
          .insert(notes)
          .values({
            title: request.body.title,
            body: request.body.body,
            ownerId: session.user.id,
          })
          .returning();
        if (pastDeadline(request)) throw request.signal.reason;
        return { status: 201 as const, note: created };
      });
      if (result.status === 401) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      if (result.status === 409) {
        return reply.code(409).send({ error: "Note limit reached" });
      }
      return reply.code(200).send(toNote(result.note));
    },
  );
  routes.get(
    "/api/notes/:id",
    { schema: getNoteContract },
    async (request, reply) => {
      const session = await requireSession(auth, request, reply);
      if (!session) return;
      const [note] = await db
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.id, request.params.id),
            eq(notes.ownerId, session.user.id),
          ),
        );
      if (!note) return reply.code(404).send({ error: "Not found" });
      return reply.send(toNote(note));
    },
  );
};
