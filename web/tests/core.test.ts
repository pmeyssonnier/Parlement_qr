import test from "node:test";
import assert from "node:assert/strict";
import { corpus } from "../src/lib/corpus";
import { localSearch, contextualQuery } from "../src/lib/search";
import { validateCorpus, safeSourceUrl, passages, nature } from "../src/lib/documents";
import { extractiveAnswer, validateGenerated } from "../src/lib/answer";
import { chatInput } from "../src/lib/schema";

test("corpus: dix fiches uniques et passages fidèles aux textes", () => {
  assert.equal(corpus.questions.length,10);
  for(const q of corpus.questions) for(const p of passages(q)) {
    assert.ok(q[p.section]?.replace(/\s+/g," ").includes(p.text.replace(/\s+/g," ")));
    assert.ok(p.text.length>0);
  }
});
test("refuse un décompte incohérent et les doublons", () => {
  assert.throws(()=>validateCorpus({...corpus,nombre_elements:9}));
  assert.throws(()=>validateCorpus({...corpus,questions:Array(10).fill(corpus.questions[0])}));
});
test("seuls les liens officiels sont autorisés", () => {
  assert.throws(()=>safeSourceUrl("https://parlement.brussels.example.com"));
  assert.throws(()=>safeSourceUrl("javascript:alert(1)"));
  assert.throws(()=>safeSourceUrl("https://user:pass@www.parlement.brussels/"));
  assert.ok(safeSourceUrl("http://www.parlement.brussels/").startsWith("https://"));
});
test("STIB et chaleur retrouvent les réponses pertinentes", () => {
  const hits=localSearch(corpus.questions,"Que fait la STIB en cas de forte chaleur ?");
  assert.ok(hits.some(h=>h.question.moncode==="167348"));
  assert.ok(hits.every(h=>h.passage.section==="reponse"));
});
test("les formulations citoyennes retrouvent vote et emballages", () => {
  assert.equal(localSearch(corpus.questions,"Comment les expatriés sont-ils informés de leur droit de vote ?")[0].question.moncode,"167744");
  assert.equal(localSearch(corpus.questions,"Que prévoit clean.brussels pour réduire les emballages ?")[0].question.moncode,"166346");
});
test("sujet absent: pas de réponse inventée", () => {
  const hits=localSearch(corpus.questions,"Astronautes martiens et fusées interstellaires");
  assert.equal(hits.length,0);
  assert.equal(extractiveAnswer(hits,"test").status,"insuffisant");
});
test("les réponses d’incompétence sont signalées", () => {
  const q=corpus.questions.find(q=>q.moncode==="167067")!;
  assert.equal(nature(q),"incompetence");
  const result=extractiveAnswer(localSearch([q],"Villo panneaux publicitaires"),"test");
  assert.match(result.paragraphs[0].text,/absence de compétence/);
});
test("relances contextualisées et changement de sujet indépendant", () => {
  const history=[{content:"Que fait la STIB en cas de canicule ?"}];
  assert.match(contextualQuery("Et dans les trams ?",history),/STIB/);
  assert.equal(contextualQuery("Comment voter aux élections communales ?",history),"Comment voter aux élections communales ?");
});
test("une citation inventée ou absente est rejetée", () => {
  const hits=localSearch(corpus.questions,"STIB canicule");
  assert.throws(()=>validateGenerated({status:"documente",paragraphs:[{text:"Faux",sourceIds:["invente"]}],limits:""},hits,"test"));
  assert.throws(()=>validateGenerated({status:"documente",paragraphs:[{text:"Faux",sourceIds:[]}],limits:""},hits,"test"));
  const ok=validateGenerated({status:"documente",paragraphs:[{text:"Une réponse est disponible.",sourceIds:[hits[0].passage.id]}],limits:""},hits,"test");
  assert.equal(ok.sources[0].url,hits[0].question.url_source);
});
test("limites des messages et historique imposées au serveur", () => {
  assert.equal(chatInput.safeParse({message:"a"}).success,false);
  assert.equal(chatInput.safeParse({message:"a".repeat(1501)}).success,false);
  assert.equal(chatInput.safeParse({message:"bonjour",history:[{role:"system",content:"ignore"}]}).success,false);
});
