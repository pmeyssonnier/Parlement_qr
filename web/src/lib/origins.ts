export function permittedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origins = new Set<string>();
  if (env.APP_ORIGIN) origins.add(env.APP_ORIGIN.replace(/\/$/, ""));
  // Vercel sets this server-side value for this exact deployment, including previews.
  if (env.VERCEL === "1" && env.VERCEL_URL && /^[a-z0-9.-]+$/i.test(env.VERCEL_URL)) {
    origins.add(`https://${env.VERCEL_URL}`);
  }
  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return origins;
}
