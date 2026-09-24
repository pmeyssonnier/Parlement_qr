import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { validateCorpus } from "../src/lib/documents";
import type { Database } from "../src/lib/database.types";
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Supabase non configuré.");
  const db=createClient<Database>(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
  const {data:version,error}=await db.from("corpus_versions").select("id,count,extracted_at,method").eq("active",true).single();
  if(error || !version) throw new Error("Aucun corpus actif exportable.");
  const questions:unknown[]=[];
  for(let offset=0;offset<version.count;offset+=500){
    const {data,error}=await db.from("questions").select("document").eq("version_id",version.id).order("id").range(offset,offset+499);
    if(error) throw new Error("Export interrompu.");
    questions.push(...(data||[]).map(r=>r.document));
  }
  const payload={schema_version:"1.0",extrait_le:version.extracted_at,nombre_elements:version.count,methode_echantillonnage:version.method,questions};
  validateCorpus(payload);
  const output=process.argv.find(a=>a.startsWith("--output="))?.slice(9)||"data/corpus-active.json";
  await writeFile(output,JSON.stringify(payload,null,2),"utf8");
  console.log(`Export validé : ${questions.length} fiches → ${output}`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Export impossible");process.exitCode=1;});
