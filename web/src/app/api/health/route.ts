import { NextResponse } from "next/server";
import { SCHEMA_VERSION } from "@/lib/schema-version";
import { aiEnabled, corpusInfo, schemaVersion, semanticSearchEnabled } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const info = await corpusInfo();
    return NextResponse.json(
      {
        status: "ok",
        mode: aiEnabled() ? "ia" : "extraits",
        // Vector search active for questions granted the AI (else lexical only).
        semantic: await semanticSearchEnabled(),
        documents: info.count,
        answers: info.answerCount,
        extractedAt: info.extractedAt,
        // How far the documents go: the collection date does not say.
        latestDocument: info.latestDocument,
        // Last migration applied in the database, and the one the code expects.
        schema: await schemaVersion(),
        schemaExpected: SCHEMA_VERSION,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
