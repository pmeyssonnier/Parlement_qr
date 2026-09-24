export function positiveLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Plafond d’import invalide.");
  return parsed;
}

// UTF-8 bytes provide a conservative input bound without relying on an
// approximate words-to-tokens conversion. Reserve before dispatch; no refunds.
export class ImportBudget {
  calls = 0;
  bytes = 0;
  constructor(
    readonly maxCalls: number,
    readonly maxBytes: number,
  ) {}
  reserve(texts: string[]) {
    const bytes = texts.reduce((total, text) => total + Buffer.byteLength(text, "utf8"), 0);
    if (this.calls + 1 > this.maxCalls || this.bytes + bytes > this.maxBytes) {
      throw new Error("Plafond OpenAI de cet import atteint ; le corpus précédent reste actif.");
    }
    this.calls++;
    this.bytes += bytes;
  }
}
