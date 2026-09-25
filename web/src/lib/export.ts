// Export of one answer as a self-contained HTML file: it opens in any browser,
// keeps the links to the official records, prints to PDF and opens in Word.
// Client-side and dependency-free, like format.ts.
import { dateLabel, durationLabel, shortTitle } from "./format";
import type { ChatResponse } from "./schema";

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
// Line breaks of excerpts survive in the file.
const multiline = (text: string) => escapeHtml(text).replace(/\n/g, "<br>");

export type ExportInput = {
  question: string;
  response: ChatResponse;
  durationMs?: number;
  /** Moment the answer was received. */
  at: Date;
};

const exportedAt = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeStyle: "short" });

export function answerHtml({ question, response, durationMs, at }: ExportInput) {
  const { mode, paragraphs, sources, notice } = response;
  const number = (id: string) => sources.findIndex(s => s.id === id) + 1;
  const body = paragraphs
    .map(p => {
      const citations =
        mode === "ia" ? p.sourceIds.map(id => ` <span class="citation">[${number(id)}]</span>`).join("") : "";
      const excerpts =
        mode === "extraits"
          ? p.sourceIds
              .map(id => sources.find(s => s.id === id))
              .map(s => (s ? `<blockquote>${multiline(s.excerpt)}</blockquote>` : ""))
              .join("")
          : "";
      return `<p>${escapeHtml(p.text)}${citations}</p>${excerpts}`;
    })
    .join("\n");
  const sourceList = sources
    .map(
      (s, i) => `<li>
<p class="source-title">[${i + 1}] ${escapeHtml(shortTitle(s.title))}</p>
<p class="meta">${escapeHtml(s.author)} · ${escapeHtml(dateLabel(s.date))}<br>${escapeHtml(s.recipient)}</p>
${s.nature === "incompetence" ? '<p class="warning">Cette réponse indique une absence de compétence du destinataire.</p>' : ""}
<blockquote>${multiline(s.excerpt)}</blockquote>
<p><a href="${escapeHtml(s.url)}">Lire la fiche officielle</a></p>
</li>`,
    )
    .join("\n");
  const footer = [
    `Réponse obtenue le ${exportedAt.format(at)}`,
    durationMs === undefined ? "" : `en ${durationLabel(durationMs)}`,
  ]
    .filter(Boolean)
    .join(" ");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(question)}</title>
<style>
body { font: 15px/1.7 Georgia, serif; color: #233b34; background: #fffef9; max-width: 760px; margin: 40px auto; padding: 0 16px; }
h1 { font-size: 24px; line-height: 1.3; margin: 6px 0 24px; }
h2 { font-size: 17px; margin-top: 32px; border-bottom: 1px solid #e3e5dc; padding-bottom: 6px; }
.label { font: 11px/1.4 system-ui, sans-serif; letter-spacing: 1.2px; color: #71836a; text-transform: uppercase; }
.citation { color: #647f4a; font-size: 13px; }
blockquote { margin: 8px 0; padding: 10px 16px; border-left: 2px solid #c6d2b9; background: #f0f3e9; color: #56634e; font-size: 13px; }
ol { padding-left: 0; list-style: none; }
li { margin-bottom: 22px; }
.source-title { font-weight: bold; margin: 0; }
.meta { font-size: 13px; color: #69745f; margin: 2px 0; }
.warning { font-size: 13px; color: #876231; background: #f7efdd; padding: 8px; }
a { color: #365735; }
.notice, footer { font: 12px/1.6 system-ui, sans-serif; color: #7e8974; }
footer { margin-top: 32px; border-top: 1px solid #e3e5dc; padding-top: 12px; }
@media print { body { margin: 0; background: white; } blockquote { break-inside: avoid; } }
</style>
</head>
<body>
<p class="label">Question</p>
<h1>${escapeHtml(question)}</h1>
<p class="label">${mode === "ia" ? "Synthèse documentée" : "Dans les documents"}</p>
${body}
${sources.length ? `<h2>Sources utilisées</h2>\n<ol>\n${sourceList}\n</ol>` : ""}
<p class="notice">${escapeHtml(notice)}</p>
<footer>
<p>${escapeHtml(footer)}.</p>
<p>Questions écrites et réponses publiées par le Parlement de la Région de Bruxelles-Capitale. Initiative indépendante : ce document ne représente pas le Parlement. Vérifiez les sources et leurs dates.</p>
</footer>
</body>
</html>
`;
}

/** File name such as "reponse-parlement-2026-09-25-1432.html". */
export function answerFileName(at: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `reponse-parlement-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.html`;
}

/** Offers the answer as a file to save (browser only). */
export function downloadAnswer(input: ExportInput) {
  const url = URL.createObjectURL(new Blob([answerHtml(input)], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = answerFileName(input.at);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
