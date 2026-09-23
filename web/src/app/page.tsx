import { Chat } from "@/components/chat";
import { aiEnabled, corpusInfo } from "@/lib/server";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    const info = await corpusInfo();
    return <Chat count={info.count} extractedAt={info.extractedAt} method={info.method} ai={aiEnabled()} />;
  } catch {
    return <main className="unavailable"><h1>Les documents sont momentanément indisponibles.</h1><p>Nous ne pouvons pas vérifier le corpus. Merci de réessayer plus tard.</p><a href="https://www.parlement.brussels/interpellations-et-questions/">Consulter le Parlement bruxellois</a></main>;
  }
}
