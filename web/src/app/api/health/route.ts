import { NextResponse } from "next/server";
import { aiEnabled, corpusInfo } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const info = await corpusInfo();
    return NextResponse.json(
      {
        status: "ok",
        mode: aiEnabled() ? "ia" : "extraits",
        documents: info.count,
        answers: info.answerCount,
        extractedAt: info.extractedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
