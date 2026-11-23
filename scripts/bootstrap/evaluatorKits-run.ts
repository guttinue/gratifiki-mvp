import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { bootstrapEvaluatorKits, type EvaluatorKit } from './evaluatorKits.ts';

// Env: SUPABASE_URL (loopback, checked by the bootstrap), SUPABASE_SERVICE_ROLE_KEY,
// EVALUATOR_KITS_FILE (JSON [{kit,password}]).
const kits = JSON.parse(readFileSync(process.env.EVALUATOR_KITS_FILE ?? '', 'utf8')) as EvaluatorKit[];
const client = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
bootstrapEvaluatorKits(client, kits)
  .then(() => process.stdout.write(`Evaluator kits ready: ${kits.length}\n`))
  .catch((error: unknown) => { process.stderr.write(`Evaluator kits failed: ${(error as Error).message}\n`); process.exitCode = 1; });
