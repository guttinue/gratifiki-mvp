export interface VerificationRequest { suite:'db'|'e2e'|'all';file?:string;fixture:'legacy'|'academic' }
export interface VerificationResult {exitCode:number;projectId:string}
export async function runSuiteBatch(request:VerificationRequest,files:string[],run:(request:VerificationRequest)=>Promise<VerificationResult>):Promise<VerificationResult & {projects?:({suite:'db'|'e2e';file?:string;projectId:string})[]}> {
 if(request.file||request.suite==='db')return run(request);
 const projects:({suite:'db'|'e2e';file?:string;projectId:string})[]=[];
 const requests:VerificationRequest[]=[...(request.suite==='all'?[{suite:'db' as const,fixture:request.fixture}]:[]),...files.map(file=>({suite:'e2e' as const,fixture:request.fixture,file}))];
 if(!requests.length)throw Error('Could not find E2E suite files');
 let exitCode=0;
 for(const unit of requests){
  // run resolves only after owned cleanup has been verified. Never overlap ports.
  const result=await run(unit);projects.push({suite:unit.suite as 'db'|'e2e',...(unit.file?{file:unit.file}:{}),projectId:result.projectId});
  exitCode=result.exitCode;if(exitCode)break;
 }
 return {exitCode,projectId:projects[0].projectId,projects};
}
