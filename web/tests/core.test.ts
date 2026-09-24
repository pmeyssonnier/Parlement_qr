import test from "node:test";
import assert from "node:assert/strict";
import { corpus } from "../src/lib/corpus";
import { localSearch, contextualQuery, lexicalQuery, filterLexicalHits } from "../src/lib/search";
import { validateCorpus, safeSourceUrl, passages, nature } from "../src/lib/documents";
import { extractiveAnswer, validateGenerated } from "../src/lib/answer";
import { chatInput } from "../src/lib/schema";
import { localQuota } from "../src/lib/server";

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

test("un mot commun ne suffit pas à documenter un sujet absent", () => {
  const q={...corpus.questions[0],titre:"Transports scolaires",question:"Quels transports scolaires ?",reponse:"Des transports scolaires sont organisés."};
  const hit={question:q,passage:passages(q).find(p=>p.section==="reponse")!,score:10};
  assert.deepEqual(filterLexicalHits([hit],"Quelles mesures concernant les cantines scolaires ?"),[]);
  assert.equal(filterLexicalHits([hit],"transports scolaires").length,1);
});

test("une question sans réponse ne devient pas un extrait de réponse", () => {
  const q={...corpus.questions[0],reponse:null};
  assert.deepEqual(localSearch([q],"expatriés droit de vote"),[]);
});

test("recherche lexicale : mots-clés alternatifs sans syntaxe utilisateur ni termes génériques", () => {
  assert.match(lexicalQuery("Comment les expatriés sont-ils informés de leur droit de vote ?"),/expatrie OR/);
  assert.equal(lexicalQuery("Quelles sont les mesures concernant les cantines scolaires ?"),"cantine OR scolaire");
  assert.doesNotMatch(lexicalQuery('vote -"expatriés"'),/["-]/);
});
test("les réponses d’incompétence sont signalées", () => {
  const q=corpus.questions.find(q=>q.moncode==="167067")!;
  assert.equal(nature(q),"incompetence");
  const result=extractiveAnswer(localSearch([q],"Villo panneaux publicitaires"),"test");
  assert.match(result.paragraphs[0].text,/absence de compétence/);
});

test("sujet absent avec voisins sémantiques : aucune citation ni demande de pièces", () => {
  const hits=localSearch(corpus.questions,"emballages");
  assert.ok(hits.length);
  const result=validateGenerated({status:"insuffisant",paragraphs:[{
    text:"Ces documents ne parlent pas des cantines. Fournissez vos pièces.",
    sourceIds:hits.map(h=>h.passage.id),
  }],limits:"Je ne peux utiliser que les pièces que vous me donnez."},hits,"absent");
  assert.equal(result.status,"insuffisant");
  assert.deepEqual(result.sources,[]);
  assert.deepEqual(result.paragraphs[0].sourceIds,[]);
  assert.match(result.paragraphs[0].text,/corpus de l’application/);
  assert.doesNotMatch(JSON.stringify(result),/Fournissez|pièces|emballages/);
  assert.equal(validateGenerated({status:"insuffisant",paragraphs:[],limits:""},hits,"empty").status,"insuffisant");
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

test("relance longue sur la réponse ministérielle conserve le sujet et ses sources", () => {
  const topic="Comment les expatriés sont-ils informés de leur droit de vote ?";
  const followup="Quelles actions ont effectivement été réalisées, selon la réponse ministérielle, sans reprendre les propositions de la députée ?";
  const query=contextualQuery(followup,[{content:topic}]);
  assert.ok(query.includes(topic));
  assert.ok(localSearch(corpus.questions,query).some(h=>h.question.moncode==="167744"));
  assert.ok(contextualQuery("Et quand ?",[{content:topic},{content:followup}]).includes(topic));
  const change="Quelles mesures concernant les cantines scolaires, selon la réponse ministérielle ?";
  assert.equal(contextualQuery(change,[{content:topic}]),change);
  assert.ok(!contextualQuery(followup,[{content:topic},{content:change}]).includes(topic));
});
test("limites des messages et historique imposées au serveur", () => {
  assert.equal(chatInput.safeParse({message:"a"}).success,false);
  assert.equal(chatInput.safeParse({message:"a".repeat(1501)}).success,false);
  assert.equal(chatInput.safeParse({message:"bonjour",history:[{role:"system",content:"ignore"}]}).success,false);
});
test("quota IA épuisé : repli sur les extraits au lieu d’un refus", async () => {
  const { reserveQuota } = await import("../src/lib/server");
  process.env.AI_IP_DAILY_LIMIT="2";
  const grants=[];
  for(let i=0;i<3;i++) grants.push(await reserveQuota(`session-${i}`,"203.0.113.7",true));
  assert.deepEqual(grants,["ia","ia","extraits"]);
  assert.equal(await reserveQuota("autre","198.51.100.9",true),"ia");
  delete process.env.AI_IP_DAILY_LIMIT;
});
test("quota anti-abus : refus sans consommer les autres compteurs", () => {
  const now=Date.now();
  assert.equal(localQuota([["t:a",1,1000],["t:b",5,1000]],now),true);
  assert.equal(localQuota([["t:a",1,1000],["t:b",5,1000]],now),false);
  assert.equal(localQuota([["t:b",2,1000]],now),true);
  assert.equal(localQuota([["t:b",2,1000]],now),false);
});
