import { type RefObject, useEffect, useRef } from "react";
import type { ChatResponse } from "@/lib/schema";
import { Answer } from "./answer";

export type Turn = { id: string; question: string; response?: ChatResponse; error?: string };

export function Conversation({ turns, busy }: { turns: Turn[]; busy: boolean }) {
  const bottom = useRef<HTMLDivElement>(null);
  useScrollToEnd(bottom, turns, busy);
  return (
    <div className="turns">
      {turns.map(turn => (
        <article key={turn.id} className="turn">
          <div className="user-question">
            <span>VOUS</span>
            <h2>{turn.question}</h2>
          </div>
          {turn.response && <Answer response={turn.response} />}
          {turn.error && (
            <p className="error" role="alert">
              {turn.error}
            </p>
          )}
        </article>
      ))}
      {busy && (
        <div className="loading" role="status">
          <span className="loading-dot" /> Recherche dans les documents…
        </div>
      )}
      <div ref={bottom} />
    </div>
  );
}

function useScrollToEnd(bottom: RefObject<HTMLDivElement | null>, turns: Turn[], busy: boolean) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever a turn or the loading indicator appears
  useEffect(() => {
    if (turns.length) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);
}
