import { readFile, writeFile } from "node:fs/promises";
import { validateCorpus } from "../src/lib/documents";
import { contextualQuery, localSearch } from "../src/lib/search";
import { answer, findHits } from "../src/lib/server";

const cases = [
  { q: "Comment les expatriés sont-ils informés de leur droit de vote ?", id: "167744" },
  { q: "Que fait la STIB en cas de forte chaleur ?", id: "167348" },
  { q: "Que prévoit clean.brussels pour réduire les emballages ?", id: "166346" },
  { q: "Quelle est la fréquentation du tram 55 ?", id: "170245" },
  { q: "Combien de ménages bénéficient de l’allocation loyer ?", id: "170157" },
  { q: "Quelle est la puissance des bornes de recharge publiques ?", id: "170152" },
  { q: "Quel est le délai du premier rendez-vous chez Actiris ?", id: "170155" },
  { q: "Quelles sont les exemptions LEZ pour les bénéficiaires BIM ?", id: "169916" },
  { q: "Quelles sont les mesures concernant les cantines scolaires ?", id: null },
  { q: "Astronautes martiens et fusées interstellaires", id: null },
] as const;
async function main() {
  const corpus=validateCorpus(JSON.parse(await readFile("data/corpus-refreshed.json","utf8")));
  const results: unknown[]=[];
  let failed=0;
  for (const c of cases) {
    const hits=process.argv.includes("--remote") ? await findHits(c.q,false) : localSearch(corpus.questions,c.q);
    const ids=[...new Set(hits.map(h=>h.question.moncode))];
    const pass=c.id ? ids.includes(c.id) : ids.length===0;
    if(!pass) failed++;
    results.push({question:c.q,mode:"lexical",pass,ids});
    console.log(JSON.stringify(results.at(-1)));
  }
  if(process.argv.includes("--ai")) {
    for(const c of [cases[3],cases[8],cases[9]]) {
      const r=await answer(c.q,[],"audit",true);
      const pass=c.id ? r.mode==="ia" && r.status==="documente" && r.sources.some(s=>s.id.includes(c.id!)) : r.status==="insuffisant" && !r.sources.length;
      if(!pass) failed++;
      const result={question:c.q,mode:r.mode,pass,response:r};
      results.push(result); console.log(JSON.stringify(result));
    }
    const history=[{content:cases[0].q}];
    const q="Quelles actions ont effectivement été réalisées, selon la réponse ministérielle, sans reprendre les propositions de la députée ?";
    const r=await answer(q,history,"audit-followup",true);
    const pass=r.mode==="ia" && r.status==="documente" && r.sources.some(s=>s.id.includes("167744"));
    if(!pass) failed++;
    results.push({question:q,query:contextualQuery(q,history),pass,response:r});
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile("data/search-audit.json",JSON.stringify({date:new Date().toISOString(),corpus:corpus.questions.length,failed,results},null,2));
  console.log(`Audit : ${results.length} cas, ${failed} échecs.`);
  if(failed) process.exitCode=1;
}
main().catch(()=>{console.error("Audit interrompu : vérifier les connexions et la configuration.");process.exitCode=1;});
