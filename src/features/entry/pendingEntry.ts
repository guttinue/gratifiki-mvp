import type { PilotContext } from "../../lib/types";
import type { CommandContext } from '../pilot/types';

export type PendingEntryOperation = {
  operationId: string;
  valueText: string;
};

type PendingEntryScope = Pick<
  PilotContext,
  "actorId" | "competenciaId" | "indicadorId" | "escopoId"
>;

type PendingEntryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredPendingEntry = PendingEntryScope & PendingEntryOperation & { version: 1 };

const STORAGE_PREFIX = "gratifiki:pending-entry:v1:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PendingEntryStorageError extends Error {
  constructor() {
    super("Pending operation state is unavailable in this browser.");
    this.name = "PendingEntryStorageError";
  }
}

export function pendingEntryStorageKey(context: PendingEntryScope): string {
  const scope = [context.actorId, context.competenciaId, context.indicadorId, context.escopoId]
    .map((value) => encodeURIComponent(value))
    .join(":");
  return `${STORAGE_PREFIX}${scope}`;
}

function getStorage(storage?: PendingEntryStorage): PendingEntryStorage {
  if (storage) return storage;

  try {
    if (typeof window === "undefined") throw new PendingEntryStorageError();
    return window.localStorage;
  } catch {
    throw new PendingEntryStorageError();
  }
}

function parseStoredPendingEntry(rawValue: string, context: PendingEntryScope): PendingEntryOperation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new PendingEntryStorageError();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PendingEntryStorageError();
  }

  const record = parsed as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.actorId !== context.actorId ||
    record.competenciaId !== context.competenciaId ||
    record.indicadorId !== context.indicadorId ||
    record.escopoId !== context.escopoId ||
    typeof record.operationId !== "string" ||
    !UUID_PATTERN.test(record.operationId) ||
    typeof record.valueText !== "string"
  ) {
    throw new PendingEntryStorageError();
  }

  return { operationId: record.operationId, valueText: record.valueText };
}

export function loadPendingEntry(
  context: PendingEntryScope,
  storage?: PendingEntryStorage,
): PendingEntryOperation | null {
  const target = getStorage(storage);
  let rawValue: string | null;
  try {
    rawValue = target.getItem(pendingEntryStorageKey(context));
  } catch {
    throw new PendingEntryStorageError();
  }

  return rawValue === null ? null : parseStoredPendingEntry(rawValue, context);
}

export function savePendingEntry(
  context: PendingEntryScope,
  operation: PendingEntryOperation,
  storage?: PendingEntryStorage,
): void {
  const target = getStorage(storage);
  const key = pendingEntryStorageKey(context);
  const record: StoredPendingEntry = { ...context, ...operation, version: 1 };
  let existingValue: string | null;

  try {
    existingValue = target.getItem(key);
  } catch {
    throw new PendingEntryStorageError();
  }

  if (existingValue !== null) {
    const existing = parseStoredPendingEntry(existingValue, context);
    if (existing.operationId !== operation.operationId || existing.valueText !== operation.valueText) {
      throw new PendingEntryStorageError();
    }
    return;
  }

  try {
    target.setItem(key, JSON.stringify(record));
  } catch {
    throw new PendingEntryStorageError();
  }
}

export function clearPendingEntry(
  context: PendingEntryScope,
  operationId: string,
  storage?: PendingEntryStorage,
): void {
  const target = getStorage(storage);
  const key = pendingEntryStorageKey(context);
  let existingValue: string | null;

  try {
    existingValue = target.getItem(key);
  } catch {
    throw new PendingEntryStorageError();
  }

  if (existingValue === null) return;

  const existing = parseStoredPendingEntry(existingValue, context);
  if (existing.operationId !== operationId) throw new PendingEntryStorageError();

  try {
    target.removeItem(key);
  } catch {
    throw new PendingEntryStorageError();
  }
}

// Academic submission is separate from the legacy v1 entry key. No migration
// between them: a position/link cannot inherit another operation's identity.
export type AcademicPendingScope=CommandContext & {actorId:string;positionId:string};
export type AcademicPendingSubmit={operationId:string;expectedVersion:number};
export function academicPendingStorageKey(scope:AcademicPendingScope):string {
 return 'gratifiki:pending-submit:v2:'+ [scope.actorId,scope.vinculoId,scope.competenciaId,scope.indicadorId,scope.positionId].map(encodeURIComponent).join(':');
}
function parseAcademicPending(raw:string,scope:AcademicPendingScope):AcademicPendingSubmit {
 let value:unknown;
 try{value=JSON.parse(raw);}catch{throw new PendingEntryStorageError();}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new PendingEntryStorageError();
 const row=value as Record<string,unknown>;
 if(row.version!==2||Object.entries(scope).some(([key,value])=>row[key]!==value)||
  typeof row.operationId!=='string'||!UUID_PATTERN.test(row.operationId)||typeof row.expectedVersion!=='number'||!Number.isSafeInteger(row.expectedVersion)||row.expectedVersion<1)throw new PendingEntryStorageError();
 return {operationId:row.operationId,expectedVersion:row.expectedVersion};
}
export function loadAcademicPending(scope:AcademicPendingScope,storage?:PendingEntryStorage):AcademicPendingSubmit|null {
 try{const raw=getStorage(storage).getItem(academicPendingStorageKey(scope));return raw===null?null:parseAcademicPending(raw,scope);}catch{throw new PendingEntryStorageError();}
}
export function saveAcademicPending(scope:AcademicPendingScope,operation:AcademicPendingSubmit,storage?:PendingEntryStorage):void {
 try{
  const target=getStorage(storage);const existing=loadAcademicPending(scope,target);
  if(existing){if(existing.operationId!==operation.operationId||existing.expectedVersion!==operation.expectedVersion)throw new PendingEntryStorageError();return;}
  const record=JSON.stringify({...scope,...operation,version:2});parseAcademicPending(record,scope);
  target.setItem(academicPendingStorageKey(scope),record);
  const persisted=loadAcademicPending(scope,target);
  if(!persisted||persisted.operationId!==operation.operationId||persisted.expectedVersion!==operation.expectedVersion)throw new PendingEntryStorageError();
 }catch{throw new PendingEntryStorageError();}
}
export function clearAcademicPending(scope:AcademicPendingScope,operationId:string,storage?:PendingEntryStorage):void {
 try{
  const target=getStorage(storage);const existing=loadAcademicPending(scope,target);
  if(!existing)return;
  if(existing.operationId!==operationId)throw new PendingEntryStorageError();
  target.removeItem(academicPendingStorageKey(scope));
 }catch{throw new PendingEntryStorageError();}
}
