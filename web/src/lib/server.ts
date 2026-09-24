import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { extractiveAnswer, instructions, validateGenerated } from "./answer";
import { corpus } from "./corpus";
import type { Database } from "./database.types";
import { nature } from "./documents";
import { generatedSchema, type Hit, type QuotaGrant, quotaGrantSchema, searchRowSchema } from "./schema";
import { contextualQuery, filterLexicalHits, lexicalQuery, localSearch } from "./search";

export type { QuotaGrant } from "./schema";
export const aiEnabled = () => process.env.AI_ENABLED === "true" && !!process.env.OPENAI_API_KEY;
// Environment variables are fixed for the lifetime of a server instance.
let db: SupabaseClient<Database> | null | undefined;
export function database() {
  if (db !== undefined) return db;
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
  db =
    url && key ? createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return db;
}
let ai: OpenAI | undefined;
function openai() {
  if (!ai) ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  return ai;
}
const devSecret = randomUUID();
export function signature(value: string) {
  return createHmac("sha256", process.env.QUOTA_SECRET || devSecret)
    .update(value)
    .digest("hex");
}
export function sessionFromCookie(cookie: string | null) {
  const candidate = cookie?.match(/(?:^|;\s*)pc_session=([^;]+)/)?.[1] || "";
  const [id, mac = ""] = candidate.split(".");
  if (id && /^[a-f0-9-]{36}$/.test(id) && /^[a-f0-9]{64}$/.test(mac)) {
    const expected = signature(id);
    if (timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return { id, cookie: `${id}.${mac}` };
  }
  const fresh = randomUUID();
  return { id: fresh, cookie: `${fresh}.${signature(fresh)}` };
}
const buckets = new Map<string, { count: number; expires: number }>();
// All buckets are checked before any is incremented: a refusal consumes nothing.
export function localQuota(entries: [key: string, limit: number, windowMs: number][], now = Date.now()) {
  for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
  if (entries.some(([key, limit]) => (buckets.get(key)?.count || 0) >= limit)) return false;
  for (const [key, , windowMs] of entries) {
    const bucket = buckets.get(key) || { count: 0, expires: now + windowMs };
    bucket.count++;
    buckets.set(key, bucket);
  }
  return true;
}
function integerEnv(key: string, fallback: number, max: number) {
  const parsed = Number(process.env[key] || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}
// An exhausted AI budget downgrades to the free extractive mode instead of refusing.
export async function reserveQuota(sessionId: string, ip: string, paid: boolean): Promise<QuotaGrant> {
  const db = database();
  if (paid && process.env.NODE_ENV === "production" && (!db || (process.env.QUOTA_SECRET?.length || 0) < 32))
    throw new Error("CONFIGURATION");
  const dailyLimit = integerEnv("DAILY_AI_REQUEST_LIMIT", 100, 10000);
  const ipDailyLimit = integerEnv("AI_IP_DAILY_LIMIT", 10, 1000);
  if (db) {
    const { data, error } = await db.rpc("reserve_chat_quota", {
      p_session: signature(sessionId),
      p_ip: signature(ip),
      p_paid: paid,
      p_daily_limit: dailyLimit,
      p_hourly_limit: integerEnv("SESSION_HOURLY_REQUEST_LIMIT", 20, 100),
      p_ai_ip_daily_limit: ipDailyLimit,
    });
    const grant = quotaGrantSchema.safeParse(data);
    if (error || !grant.success) throw new Error("QUOTA_UNAVAILABLE");
    return grant.data;
  }
  // Local demonstration only. Paid production requests never use memory quotas.
  if (
    !localQuota([
      [`session:${sessionId}`, integerEnv("SESSION_HOURLY_REQUEST_LIMIT", 20, 100), 3600000],
      [`ip:${ip}`, 100, 3600000],
    ])
  )
    return "refuse";
  return paid &&
    localQuota([
      ["paid", dailyLimit, 86400000],
      [`paid-ip:${ip}`, ipDailyLimit, 86400000],
    ])
    ? "ia"
    : "extraits";
}
export async function corpusInfo() {
  const db = database();
  if (db) {
    const { data, error } = await db
      .from("corpus_versions")
      .select("id,count,extracted_at,method")
      .eq("active", true)
      .single();
    if (error || !data) throw new Error("CORPUS_UNAVAILABLE");
    const { count: answerCount, error: countError } = await db
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("version_id", data.id)
      .not("document->>reponse", "is", null)
      .neq("document->>reponse", "");
    if (countError || answerCount === null) throw new Error("CORPUS_UNAVAILABLE");
    return {
      count: data.count,
      answerCount,
      extractedAt: data.extracted_at,
      method: data.method,
      origin: "supabase" as const,
    };
  }
  return {
    count: corpus.questions.length,
    answerCount: corpus.questions.filter(q => q.reponse?.trim()).length,
    extractedAt: corpus.extrait_le,
    method: corpus.methode_echantillonnage,
    origin: "local" as const,
  };
}
// A failed embedding call degrades to lexical search instead of failing the request.
async function embed(query: string): Promise<number[] | null> {
  try {
    const result = await openai().embeddings.create(
      { model: process.env.EMBEDDING_MODEL || "text-embedding-3-small", input: query, dimensions: 1536 },
      { timeout: 15000 },
    );
    return result.data[0]?.embedding ?? null;
  } catch {
    console.error(JSON.stringify({ code: "EMBEDDING_UNAVAILABLE" }));
    return null;
  }
}
export async function findHits(query: string, useEmbeddings: boolean): Promise<Hit[]> {
  const db = database();
  if (!db) return localSearch(corpus.questions, query);
  const vector = useEmbeddings ? await embed(query) : null;
  const { data, error } = await db.rpc("search_passages", {
    p_query: lexicalQuery(query),
    p_vector: vector ? JSON.stringify(vector) : null,
    p_limit: 6,
  });
  if (error) throw new Error("SEARCH_UNAVAILABLE");
  const hits = (data ?? []).map(raw => {
    const row = searchRowSchema.parse(raw);
    return {
      passage: {
        id: row.id,
        questionId: row.question_id,
        section: row.section,
        text: row.content,
        order: row.position,
      },
      question: row.document,
      score: row.score,
    };
  });
  return vector ? hits : filterLexicalHits(hits, query);
}
export async function answer(message: string, history: { content: string }[], requestId: string, useAi = aiEnabled()) {
  const query = contextualQuery(message, history);
  const hits = await findHits(query, useAi);
  if (!useAi || !hits.length) {
    const result = extractiveAnswer(hits, requestId);
    if (aiEnabled() && !useAi)
      result.notice =
        "La limite quotidienne de synthèses par IA est atteinte. La recherche continue sans IA, à partir des mots-clés de votre question.";
    return result;
  }
  const model = process.env.CHAT_MODEL || "gpt-5-mini";
  try {
    const response = await openai().responses.parse(
      {
        model,
        store: false,
        ...(model === "gpt-5-mini" ? { reasoning: { effort: "low" as const } } : {}),
        instructions,
        max_output_tokens: 3000,
        input: JSON.stringify({
          question: message,
          contexteUtilisateur: history,
          sources: hits.map(h => ({
            sourceId: h.passage.id,
            titre: h.question.titre,
            auteur: h.question.auteur,
            destinataire: h.question.destinataire,
            dateReponse: h.question.date_reponse,
            nature: nature(h.question),
            section: h.passage.section,
            texte: h.passage.text,
          })),
        }),
        text: { format: zodTextFormat(generatedSchema, "reponse_parlementaire") },
      },
      { timeout: 30000 },
    );
    return validateGenerated(response.output_parsed, hits, requestId);
  } catch (error) {
    // Never expose upstream error payloads, prompt contents or credentials.
    const code =
      error instanceof OpenAI.APIConnectionTimeoutError
        ? "AI_TIMEOUT"
        : error instanceof OpenAI.APIError
          ? "AI_API_ERROR"
          : error instanceof Error && error.message === "Affirmation sans source"
            ? "AI_MISSING_CITATION"
            : error instanceof Error && error.message === "Référence inconnue"
              ? "AI_UNKNOWN_CITATION"
              : "AI_OUTPUT_INVALID";
    console.error(JSON.stringify({ requestId, code }));
    const fallback = extractiveAnswer(filterLexicalHits(hits, query), requestId);
    fallback.notice =
      "La synthèse par IA est indisponible ou n’a pas passé la vérification des références. Voici les extraits officiels disponibles.";
    return fallback;
  }
}
