import { z } from "zod";

export const noteResponse = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  revision: z.string(),
});
export const createNoteBody = z.strictObject({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10000),
});
export const noteParams = z.object({ id: z.uuid() });
// the last millisecond of year 9999, since later dates don't fit an ISO timestamp
const LAST_CURSOR_TIME = 253402300799999;
export const listNotesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .regex(
      /^\d{1,15}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    .refine((cursor) => Number(cursor.split("_")[0]) <= LAST_CURSOR_TIME, {
      message: "Cursor time is after year 9999",
    })
    .optional(),
});
export const notesPageResponse = z.object({
  items: z.array(noteResponse),
  nextCursor: z.string().nullable(),
});
export const errorResponse = z.object({ error: z.string() });
export const validationErrorResponse = z.object({
  statusCode: z.literal(400),
  code: z.string(),
  error: z.string(),
  message: z.string(),
});
export const listNotesContract = {
  operationId: "listNotes",
  querystring: listNotesQuery,
  response: {
    200: notesPageResponse,
    400: validationErrorResponse,
    401: errorResponse,
    503: errorResponse,
  },
};
export const createNoteContract = {
  operationId: "createNote",
  body: createNoteBody,
  response: {
    201: noteResponse,
    400: validationErrorResponse,
    401: errorResponse,
    409: errorResponse,
    429: errorResponse,
    503: errorResponse,
  },
};
export const getNoteContract = {
  operationId: "getNote",
  params: noteParams,
  response: {
    200: noteResponse,
    400: validationErrorResponse,
    401: errorResponse,
    404: errorResponse,
    503: errorResponse,
  },
};
