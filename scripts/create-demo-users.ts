import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface DemoUserCredentials {
  technical: { email: string; password: string };
  cam: { email: string; password: string };
}

export interface DemoUserConfig {
  url: string;
  serviceKey: string;
  credentials: DemoUserCredentials;
}

type Environment = Record<string, string | undefined>;

function requiredValue(environment: Environment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function readDemoUserConfig(environment: Environment = process.env): DemoUserConfig {
  const urlValue = requiredValue(environment, "SUPABASE_URL").trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlValue);
  } catch {
    throw new Error("SUPABASE_URL must be a valid local loopback URL");
  }

  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = new Set(["localhost", "127.0.0.1", "::1"]).has(hostname);
  if (parsedUrl.protocol !== "http:" || !isLoopback || parsedUrl.username || parsedUrl.password) {
    throw new Error("SUPABASE_URL must use HTTP on an allowlisted loopback host");
  }

  const serviceKey = requiredValue(environment, "SUPABASE_SERVICE_ROLE_KEY").trim();
  const credentials = {
    technical: {
      email: requiredValue(environment, "DEMO_TECHNICAL_EMAIL").trim(),
      password: requiredValue(environment, "DEMO_TECHNICAL_PASSWORD"),
    },
    cam: {
      email: requiredValue(environment, "DEMO_CAM_EMAIL").trim(),
      password: requiredValue(environment, "DEMO_CAM_PASSWORD"),
    },
  };

  return { url: urlValue, serviceKey, credentials };
}

async function ensureDemoUser(
  localAdminClient: SupabaseClient<Database>,
  credentials: DemoUserCredentials[keyof DemoUserCredentials],
): Promise<string> {
  const { data: userList, error: listError } = await localAdminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw new Error("Unable to inspect local demo identities");

  const existingUser = userList.users.find(
    (user) => user.email?.toLowerCase() === credentials.email.toLowerCase(),
  );
  if (existingUser) return existingUser.id;

  const { data, error } = await localAdminClient.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("Unable to create a local demo identity");
  return data.user.id;
}

export async function createDemoUsers(
  localAdminClient: SupabaseClient<Database>,
  credentials: DemoUserCredentials,
): Promise<{ technicalId: string; camId: string }> {
  if (credentials.technical.email.toLowerCase() === credentials.cam.email.toLowerCase()) {
    throw new Error("Demo identities must use distinct email addresses");
  }

  const { data: scope, error: scopeError } = await localAdminClient
    .from("escopos")
    .select("id")
    .eq("codigo", "DEMO-ESCOPO-01")
    .single();
  if (scopeError || !scope) throw new Error("Synthetic demo scope is missing; reset the local database first");

  const technicalId = await ensureDemoUser(localAdminClient, credentials.technical);
  const camId = await ensureDemoUser(localAdminClient, credentials.cam);

  for (const link of [
    { actor_id: technicalId, papel: "tecnica", escopo_id: scope.id },
    { actor_id: camId, papel: "cam", escopo_id: scope.id },
  ]) {
    const { error } = await localAdminClient
      .from("vinculos")
      .upsert(link, { onConflict: "actor_id,papel,escopo_id" });
    if (error) throw new Error("Unable to link a local demo identity to its synthetic role");
  }

  return { technicalId, camId };
}

async function runFromEnvironment(): Promise<void> {
  const config = readDemoUserConfig();
  const localAdminClient = createClient<Database>(config.url, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await createDemoUsers(localAdminClient, config.credentials);
  process.stdout.write("Local demo identities are ready with distinct roles.\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  void runFromEnvironment().catch(() => {
    process.stderr.write("Could not prepare local demo identities. Check local Supabase and the required environment variables.\n");
    process.exitCode = 1;
  });
}
