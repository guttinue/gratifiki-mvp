import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext } from '../pilot/types';
import type { AdminCatalog } from './adminTypes';
import { loadAdminCatalog } from './adminApi';
export function useAdminCatalog(client:SupabaseClient,context:CommandContext){
 const [catalog,setCatalog]=useState<AdminCatalog|null>(null),[error,setError]=useState<string|null>(null),[reload,setReload]=useState(0);const generation=useRef(0);
 useEffect(()=>{const request=++generation.current;setCatalog(null);setError(null);void loadAdminCatalog(client,context).then(c=>{if(generation.current===request)setCatalog(c);}).catch(cause=>{if(generation.current===request)setError(cause instanceof Error?cause.message:'Não foi possível consultar os cadastros.');});return()=>{generation.current++;};},[client,context,reload]);
 return{catalog,error,refresh:()=>setReload(n=>n+1)};
}
