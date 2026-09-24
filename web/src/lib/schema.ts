import { z } from "zod";
import { MAX_HISTORY, MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH } from "./limits";

export const questionSchema = z.object({
  id: z.string().min(1),
  moncode: z.string().regex(/^\d+$/),
  base: z.number().int(),
  assemblee: z.string(),
  legislature: z.string(),
  session: z.string().nullable(),
  type: z.string(),
  numero: z.number().int().nullable(),
  langue: z.literal("fr"),
  titre: z.string().min(1),
  titre_nl: z.string().optional(),
  auteur: z.string(),
  destinataire: z.string(),
  date_reception: z.iso.date(),
  date_publication: z.iso.date().nullable(),
  date_reponse: z.iso.date().nullable(),
  question: z.string().min(1),
  reponse: z.string().nullable(),
  url_source: z.url(),
});
export const corpusSchema = z.object({
  extrait_le: z.string(),
  nombre_elements: z.number().int().positive(),
  methode_echantillonnage: z.string(),
  questions: z.array(questionSchema).min(1),
});
export type Question = z.infer<typeof questionSchema>;

export const sectionSchema = z.enum(["question", "reponse"]);
export type Section = z.infer<typeof sectionSchema>;
export type Passage = { id: string; questionId: string; section: Section; text: string; order: number };
export type Hit = { passage: Passage; question: Question; score: number };

// Single source of truth for the API response shape; the client only imports
// the inferred types, so zod stays out of the browser bundle.
export const natureSchema = z.enum(["fond", "incompetence", "renvoi", "absente"]);
export type Nature = z.infer<typeof natureSchema>;
export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  recipient: z.string(),
  date: z.iso.date().nullable(),
  url: z.url(),
  excerpt: z.string(),
  nature: natureSchema,
});
export type Source = z.infer<typeof sourceSchema>;
const statusSchema = z.enum(["documente", "insuffisant"]);
const paragraphSchema = z.object({ text: z.string(), sourceIds: z.array(z.string()) });
export const chatResponseSchema = z.object({
  mode: z.enum(["extraits", "ia"]),
  status: statusSchema,
  paragraphs: z.array(paragraphSchema),
  sources: z.array(sourceSchema),
  notice: z.string(),
  requestId: z.string(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const chatInput = z.strictObject({
  message: z.string().trim().min(MIN_QUESTION_LENGTH).max(MAX_QUESTION_LENGTH),
  history: z
    .array(z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(MAX_QUESTION_LENGTH) }))
    .max(MAX_HISTORY)
    .default([]),
});
// Sent to OpenAI as the structured output format: keep it free of constraints
// the structured-output JSON Schema subset may not support.
export const generatedSchema = z.object({
  status: statusSchema,
  paragraphs: z.array(paragraphSchema),
  limits: z.string(),
});
// Enforced server-side on a documented answer before anything is displayed.
export const documentedParagraphsSchema = z
  .array(
    z.object({
      text: z
        .string()
        .max(5000)
        .refine(text => text.trim().length > 0, "Texte vide"),
      sourceIds: z.array(z.string()),
    }),
  )
  .min(1)
  .max(8);

export const quotaGrantSchema = z.enum(["ia", "extraits", "refuse"]);
export type QuotaGrant = z.infer<typeof quotaGrantSchema>;
// Row shape returned by the search_passages RPC.
export const searchRowSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  section: sectionSchema,
  content: z.string(),
  position: z.number().int(),
  score: z.number(),
  document: questionSchema,
});
