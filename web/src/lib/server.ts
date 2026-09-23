import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { corpus } from "./corpus";
import { contextualQuery, localSearch } from "./search";
import { extractiveAnswer, instructions, validateGenerated } from "./answer";
import { generatedSchema, questionSchema, type Hit } from "./schema";
import { nature } from "./documents";

export const aiEnabled = () => process.env.AI_ENABLED === "true" && !!process.env.OPENAI_API_KEY;
export const database = () => process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const devSecret = randomUUID();
export function signature(value: string) { return createHmac("sha256", process.env.QUOTA_SECRET || devSecret).update(value).digest("hex"); }
export function sessionFromCookie(cookie: string | null) {
  const candidate = cookie?.match(/(?:^|;\s*)pc_session=([^;]+)/)?.[1] || "";
  const [id, mac] = candidate.split(".");
  if (id && /^[a-f0-9-]{36}$/.test(id) && /^[a-f0-9]{64}$/.test(mac || "")) {
    const expected = signature(id);
    if (timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return { id, cookie: `${id}.${mac}` };
  }
  const fresh = randomUUID();
  return { id: fresh, cookie: `${fresh}.${signature(fresh)}` };
}
const buckets = new Map<string, { count: number; expires: number }>();
export function localQuota(key: string, limit = 20, windowMs = 3600000, now = Date.now()) {
  for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
  const bucket = buckets.get(key) || { count: 0, expires: now + windowMs };
  if (bucket.count >= limit) return false;
  bucket.count++; buckets.set(key, bucket); return true;
}
function integerEnv(key: string, fallback: number, max: number) {
  const parsed = Number(process.env[key] || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}
export async function reserveQuota(sessionId: string, ip: string, paid: boolean) {
  const db = database();
  if (paid && process.env.NODE_ENV === "production" && (!db || (process.env.QUOTA_SECRET?.length || 0) < 32)) throw new Error("CONFIGURATION");
  if (db) {
    const { data, error } = await db.rpc("reserve_chat_quota", { p_session: signature(sessionId), p_ip: signature(ip), p_paid: paid, p_daily_limit: integerEnv("DAILY_AI_REQUEST_LIMIT", 100, 10000), p_hourly_limit: integerEnv("SESSION_HOURLY_REQUEST_LIMIT", 20, 100) });
    if (error) throw new Error("QUOTA_UNAVAILABLE");
    return data === true;
  }
  // Local demonstration only. Paid production requests never use memory quotas.
  return localQuota(`session:${sessionId}`) && localQuota(`ip:${ip}`, 100) && (!paid || localQuota("paid", integerEnv("DAILY_AI_REQUEST_LIMIT", 100, 10000), 86400000));
}
export async function corpusInfo() {
  const db = database();
  if (db) {
    const { data, error } = await db.from("corpus_versions").select("count,extracted_at,method").eq("active", true).single();
    if (error || !data) throw new Error("CORPUS_UNAVAILABLE");
    return { count: data.count as number, extractedAt: data.extracted_at as string, method: data.method as string, origin: "supabase" as const };
  }
  return { count: corpus.questions.length, extractedAt: corpus.extrait_le, method: corpus.methode_echantillonnage, origin: "local" as const };
}
export async function findHits(query: string, useEmbeddings: boolean): Promise<Hit[]> {
  const db = database();
  if (!db) return localSearch(corpus.questions, query);
  let vector: number[] | null = null;
  if (useEmbeddings) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 15000, maxRetries: 0 });
    const result = await client.embeddings.create({ model: process.env.EMBEDDING_MODEL || "text-embedding-3-small", input: query, dimensions: 1536 });
    vector = result.data[0].embedding;
  }
  const { data, error } = await db.rpc("search_passages", { p_query: query, p_vector: vector ? JSON.stringify(vector) : null, p_limit: 6 });
  if (error) throw new Error("SEARCH_UNAVAILABLE");
  return (data || []).map((row: { id: string; question_id: string; section: "question" | "reponse"; content: string; position: number; score: number; document: unknown }) => ({ passage: { id: row.id, questionId: row.question_id, section: row.section, text: row.content, order: row.position }, question: questionSchema.parse(row.document), score: row.score }));
}
export async function answer(message: string, history: { content: string }[], requestId: string) {
  const query = contextualQuery(message, history);
  const hits = await findHits(query, aiEnabled());
  if (!aiEnabled() || !hits.length) return extractiveAnswer(hits, requestId);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 });
  try {
    const response = await client.responses.parse({
      model: process.env.CHAT_MODEL || "gpt-5-mini", store: false,
      instructions, max_output_tokens: 3000,
      input: JSON.stringify({ question: message, contexteUtilisateur: history, sources: hits.map(h => ({ sourceId: h.passage.id, titre: h.question.titre, auteur: h.question.auteur, destinataire: h.question.destinataire, dateReponse: h.question.date_reponse, nature: nature(h.question), section: h.passage.section, texte: h.passage.text })) }),
      text: { format: zodTextFormat(generatedSchema, "reponse_parlementaire") },
    });
    return validateGenerated(response.output_parsed, hits, requestId);
  } catch {
    // Never expose upstream error payloads, prompt contents or credentials.
    const fallback = extractiveAnswer(hits, requestId);
    fallback.notice = "La synthèse par IA est indisponible ou n’a pas passé la vérification des références. Voici les extraits officiels disponibles.";
    return fallback;
  }
}
