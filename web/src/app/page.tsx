import { Chat } from "@/components/chat";
import { aiEnabled, cachedCorpusInfo } from "@/lib/server";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    const { count, answerCount, extractedAt, latestDocument, method } = await cachedCorpusInfo();
    return <Chat corpus={{ count, answerCount, extractedAt, latestDocument, method, ai: aiEnabled() }} />;
  } catch {
    return (
      <main className="unavailable">
        <h1>Les documents sont momentanément indisponibles.</h1>
        <p>Nous ne pouvons pas vérifier le corpus. Merci de réessayer plus tard.</p>
        <a href="https://www.parlement.brussels/interpellations-et-questions/">Consulter le Parlement bruxellois</a>
      </main>
    );
  }
}
