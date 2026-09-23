import { z } from "zod";

export const questionSchema = z.object({
  id: z.string().min(1), moncode: z.string().regex(/^\d+$/), base: z.number().int(),
  assemblee: z.string(), legislature: z.string(), session: z.string().nullable(),
  type: z.string(), numero: z.number().int().nullable(), langue: z.literal("fr"),
  titre: z.string().min(1), titre_nl: z.string().optional(), auteur: z.string(),
  destinataire: z.string(), date_reception: z.string().date(),
  date_publication: z.string().date().nullable(), date_reponse: z.string().date().nullable(),
  question: z.string().min(1), reponse: z.string().nullable(), url_source: z.string().url(),
});
export const corpusSchema = z.object({
  extrait_le: z.string(), nombre_elements: z.number().int().positive(),
  methode_echantillonnage: z.string(), questions: z.array(questionSchema).min(1),
});
export type Question = z.infer<typeof questionSchema>;
export type Nature = "fond" | "incompetence" | "renvoi" | "absente";
export type Passage = { id: string; questionId: string; section: "question" | "reponse"; text: string; order: number };
export type Hit = { passage: Passage; question: Question; score: number };
export type Source = { id: string; title: string; author: string; recipient: string; date: string | null; url: string; excerpt: string; nature: Nature };
export type ChatResponse = {
  mode: "extraits" | "ia";
  status: "documente" | "insuffisant";
  paragraphs: { text: string; sourceIds: string[] }[];
  sources: Source[]; notice: string; requestId: string;
};
export const chatInput = z.object({
  message: z.string().trim().min(3).max(1500),
  history: z.array(z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(1500) })).max(4).default([]),
}).strict();
export const generatedSchema = z.object({
  status: z.enum(["documente", "insuffisant"]),
  paragraphs: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()) })),
  limits: z.string(),
});
