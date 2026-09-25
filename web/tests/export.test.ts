import assert from "node:assert/strict";
import test from "node:test";
import { answerFileName, answerHtml } from "../src/lib/export";
import { durationLabel } from "../src/lib/format";
import type { ChatResponse } from "../src/lib/schema";

const response: ChatResponse = {
  mode: "ia",
  status: "documente",
  paragraphs: [{ text: "La ministre refuse <b>les</b> tableaux.", sourceIds: ["PRB-1-170245:reponse:0"] }],
  sources: [
    {
      id: "PRB-1-170245:reponse:0",
      title: "Question écrite concernant les chiffres de fréquentation de la ligne de tram 55",
      author: "Sadik Köksal",
      recipient: "Elke Van den Brandt - Ministre",
      date: "2026-09-20",
      url: "https://www.parlement.brussels/weblex-quest-det/?moncode=170245&base=1",
      excerpt: "Il n’est pas possible…\nDeuxième ligne",
      nature: "fond",
    },
  ],
  notice: "Synthèse assistée par IA.",
  requestId: "r",
};

test("durée : secondes avec une décimale, à la française", () => {
  assert.equal(durationLabel(34812), "34,8 s");
  assert.equal(durationLabel(420), "0,4 s");
});
test("export : réponse, citations, sources et durée dans un fichier HTML autonome", () => {
  const html = answerHtml({ question: "Tram 55 & fréquentation ?", response, durationMs: 34812, at: new Date() });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<h1>Tram 55 &amp; fréquentation \?<\/h1>/);
  assert.match(html, /refuse &lt;b&gt;les&lt;\/b&gt; tableaux\. <span class="citation">\[1\]<\/span>/);
  assert.match(html, /\[1\] les chiffres de fréquentation de la ligne de tram 55/);
  assert.match(html, /Il n’est pas possible…<br>Deuxième ligne/);
  assert.match(html, /href="https:\/\/www\.parlement\.brussels\/weblex-quest-det\/\?moncode=170245&amp;base=1"/);
  assert.match(html, /en 34,8 s/);
  assert.doesNotMatch(html, /<script/);
});
test("export : extraits cités sous chaque paragraphe en mode extraits", () => {
  const html = answerHtml({ question: "q", response: { ...response, mode: "extraits" }, at: new Date() });
  assert.match(html, /Dans les documents/);
  assert.doesNotMatch(html, /class="citation"/);
  assert.equal(html.match(/<blockquote>/g)?.length, 2);
  assert.doesNotMatch(html, / en \d/);
});
test("export : nom de fichier daté", () => {
  assert.equal(answerFileName(new Date(2026, 8, 25, 14, 32)), "reponse-parlement-2026-09-25-1432.html");
});
