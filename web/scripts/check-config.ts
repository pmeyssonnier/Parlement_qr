const checks: [string,boolean][] = [
  ["Clé OpenAI présente", !!process.env.OPENAI_API_KEY],
  ["URL Supabase présente", !!process.env.SUPABASE_URL],
  ["Clé serveur Supabase présente", !!process.env.SUPABASE_SECRET_KEY],
  ["Secret de quota de 32 caractères minimum", (process.env.QUOTA_SECRET?.length || 0)>=32],
  ["Origine de l’application définie", !!process.env.APP_ORIGIN],
];
for (const [label,ok] of checks) console.log(`${ok ? 'OK' : 'À CONFIGURER'} — ${label}`);
console.log(`Synthèse IA : ${process.env.AI_ENABLED === 'true' ? 'activée' : 'désactivée'}`);
console.log("Les valeurs des secrets ne sont jamais affichées.");
if (process.argv.includes("--production") && checks.some(([,ok])=>!ok)) process.exitCode=1;
