import { spawnSync } from "node:child_process";

type Env = Record<string, string | undefined>;

// Thin wrapper around the psql client designated by SQL_CHECK_PSQL, for the
// SQL parity check (scripts/sql-setup.ts, scripts/sql-check.ts). The connection
// comes from the usual libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE):
// nothing is written here, and only a LOCAL throwaway database is accepted,
// never Supabase, because the setup creates roles and activates fictitious versions.
const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

/** The psql to run: SQL_CHECK_PSQL is mandatory, so that nothing runs by accident. */
export function psqlCommand(env: Env = process.env): string {
  const command = env.SQL_CHECK_PSQL?.trim();
  if (!command) {
    throw new Error(
      "SQL_CHECK_PSQL n'est pas défini : indiquez le psql à utiliser (par exemple SQL_CHECK_PSQL=psql) " +
        "et une base LOCALE jetable avec PGHOST, PGUSER, PGPASSWORD et PGDATABASE.",
    );
  }
  return command;
}

/** Refuses any database that is not on this machine (a socket directory counts as local). */
export function assertLocalDatabase(env: Env = process.env): void {
  for (const name of ["PGHOST", "PGHOSTADDR"] as const) {
    const host = (env[name] ?? "").trim().toLowerCase();
    if (!LOCAL_HOSTS.has(host) && !host.startsWith("/")) {
      throw new Error(
        `${name}=${host} : le contrôle SQL n'accepte qu'une base locale jetable, jamais une base distante.`,
      );
    }
  }
  if (env.PGSERVICE || env.PGSERVICEFILE) {
    throw new Error("PGSERVICE est refusé : indiquez PGHOST, PGUSER, PGPASSWORD et PGDATABASE d'une base locale.");
  }
}

/**
 * Runs a SQL script through psql (-At: unaligned, no header, so booleans read
 * "t" and "f", never "true" and "false"; ON_ERROR_STOP: the first error stops
 * the script and reaches the caller; -q: no notices). Returns stdout.
 */
export function psql(sql: string, vars: Record<string, string> = {}, env: Env = process.env): string {
  assertLocalDatabase(env);
  const args = ["-At", "-v", "ON_ERROR_STOP=1", "-q", ...Object.entries(vars).flatMap(([k, v]) => ["-v", `${k}=${v}`])];
  const result = spawnSync(psqlCommand(env), args, {
    input: sql,
    encoding: "utf8",
    env: env as NodeJS.ProcessEnv,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw new Error(`psql impossible à lancer (${result.error.message}).`);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `psql a échoué (code ${result.status}).`);
  return result.stdout;
}

/** One value, e.g. a boolean as psql prints it: "t" or "f". */
export function psqlValue(sql: string, env: Env = process.env): string {
  return psql(sql, {}, env).trim();
}
