import { ArrowUpRight, BookOpen, ChevronDown, Landmark } from "lucide-react";
import { dateLabel, shortTitle } from "@/lib/format";
import type { ChatResponse, Source } from "@/lib/schema";

function SourceCard({ source, index }: { source: Source; index: number }) {
  return (
    <details className="source-card">
      <summary>
        <span className="source-number">{index + 1}</span>
        <span>
          <strong>{shortTitle(source.title)}</strong>
          <small>
            {source.author} · {dateLabel(source.date)}
          </small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="source-expanded">
        <p className="recipient">{source.recipient}</p>
        {source.nature === "incompetence" && (
          <p className="warning">Cette réponse indique une absence de compétence du destinataire.</p>
        )}
        <blockquote>{source.excerpt}</blockquote>
        <a href={source.url} target="_blank" rel="noreferrer">
          Lire la fiche officielle <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </details>
  );
}

export function Answer({ response }: { response: ChatResponse }) {
  const { mode, paragraphs, sources, notice } = response;
  return (
    <div className="answer">
      <div className="answer-label">
        <span className="mini-brand">
          <Landmark size={15} />
        </span>
        {mode === "ia" ? "SYNTHÈSE DOCUMENTÉE" : "DANS LES DOCUMENTS"}
      </div>
      {paragraphs.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of a response are immutable and never reordered
        <div key={i} className="answer-paragraph">
          <p>
            {p.text}
            {mode === "ia" &&
              p.sourceIds.map(id => (
                <span className="citation" key={id}>
                  [{sources.findIndex(s => s.id === id) + 1}]
                </span>
              ))}
          </p>
          {mode === "extraits" &&
            p.sourceIds.map(id => <blockquote key={id}>{sources.find(s => s.id === id)?.excerpt}</blockquote>)}
        </div>
      ))}
      {sources.length > 0 && (
        <div className="sources">
          <h3>
            <BookOpen size={15} /> Sources utilisées
          </h3>
          {sources.map((s, i) => (
            <SourceCard key={s.id} source={s} index={i} />
          ))}
        </div>
      )}
      <p className="answer-notice">{notice}</p>
    </div>
  );
}
