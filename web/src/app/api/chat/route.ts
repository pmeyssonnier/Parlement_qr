import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { permittedOrigins } from "@/lib/origins";
import { chatInput } from "@/lib/schema";
import { aiEnabled, answer, reserveQuota, sessionFromCookie } from "@/lib/server";
import { failureCode, type Timings, timed } from "@/lib/timing";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const fail = (message: string, status: number) =>
    NextResponse.json({ error: message, requestId }, { status, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  const permitted = permittedOrigins();
  if (!origin || !permitted.has(origin)) return fail("Origine de la requête non autorisée.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return fail("Format de requête invalide.", 415);
  const session = sessionFromCookie(request.headers.get("cookie"));
  // Step durations of this request, logged with its outcome.
  const timings: Timings = {};
  const started = performance.now();
  const total = () => ({ ...timings, total: Math.round(performance.now() - started) });
  try {
    // Bound streamed input, including requests without a Content-Length header.
    const reader = request.body?.getReader();
    if (!reader) return fail("Message manquant.", 400);
    let size = 0;
    const parts: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16000) {
        await reader.cancel();
        return fail("Message trop long.", 413);
      }
      parts.push(value);
    }
    const input = chatInput.safeParse(JSON.parse(Buffer.concat(parts).toString("utf8")));
    if (!input.success) return fail("Écrivez une question de 3 à 1 500 caractères.", 400);
    // Trust Vercel's platform header only on Vercel; local clients share one bucket.
    const ip = process.env.VERCEL
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      : "local";
    const grant = await timed(timings, "quota", () => reserveQuota(session.id, ip, aiEnabled()));
    if (grant === "refuse")
      return fail(
        "La limite de questions est atteinte. Réessayez plus tard ; les documents restent consultables.",
        429,
      );
    const result = await answer(input.data.message, input.data.history, requestId, grant === "ia", timings);
    console.log(JSON.stringify({ requestId, code: "CHAT_OK", mode: result.mode, status: result.status, ms: total() }));
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("pc_session", session.cookie, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600,
      path: "/",
    });
    return response;
  } catch (error) {
    if (error instanceof SyntaxError) return fail("Le message n’a pas pu être lu.", 400);
    // Only a random request ID, application-owned codes and durations enter
    // operational logs: the cause says which step failed (QUOTA_UNAVAILABLE…).
    console.error(JSON.stringify({ requestId, code: "CHAT_UNAVAILABLE", cause: failureCode(error), ms: total() }));
    return fail(
      "Le service est momentanément indisponible. Vous pouvez consulter les sources et réessayer plus tard.",
      503,
    );
  }
}
