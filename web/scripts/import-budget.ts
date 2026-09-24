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

const utf8Bytes = (texts: string[]) => texts.reduce((total, text) => total + Buffer.byteLength(text, "utf8"), 0);

/**
 * Groups whole questions into embedding requests of at most maxInputs texts
 * and maxBytes UTF-8 bytes. A question is never split across requests; one
 * that exceeds the limits on its own gets a request of its own.
 */
export function embeddingBatches<T extends { texts: string[] }>(
  items: T[],
  maxInputs: number,
  maxBytes: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let inputs = 0;
  let bytes = 0;
  for (const item of items) {
    const itemBytes = utf8Bytes(item.texts);
    if (current.length && (inputs + item.texts.length > maxInputs || bytes + itemBytes > maxBytes)) {
      batches.push(current);
      current = [];
      inputs = 0;
      bytes = 0;
    }
    current.push(item);
    inputs += item.texts.length;
    bytes += itemBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Fails before anything is written when the planned requests exceed the budget. */
export function assertBudgetFits(budget: ImportBudget, batches: { texts: string[] }[][]) {
  const bytes = batches.reduce((total, batch) => total + utf8Bytes(batch.flatMap(item => item.texts)), 0);
  if (batches.length > budget.maxCalls || bytes > budget.maxBytes) {
    throw new Error(
      `Import trop volumineux pour le plafond OpenAI : ${batches.length} appels et ${bytes} octets prévus ` +
        `(plafonds : ${budget.maxCalls} appels, ${budget.maxBytes} octets). Réduisez le nombre de fiches ajoutées ; ` +
        "le corpus précédent reste actif.",
    );
  }
}
