'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(file,modules) {
 const output=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',output)(name=>{assert.ok(name in modules,'Unexpected dependency: '+name);return modules[name];},module,module.exports);return module.exports;
}
test('disabled hooks reject before external AI calls, CRM reads or writes, and still authenticate',async()=>{
 let authenticated=0;
 const modules={'@/lib/dashboard-auth':{requireAdmin:async()=>{authenticated++;}},'next/server':{NextResponse:{json:(body,options)=>({body,...options})}}};
 for(const name of ['db','junk-addresses','verification-persist','crm-email-verification'])modules['@/lib/'+name]={};
 modules['@/app/actions/email-verifier-actions']={};
 await assert.rejects(load('src/lib/groqClient.ts',{}).generateHook('Prospect website'),/disabled/);
 await assert.rejects(load('src/app/actions/crm-actions.ts',modules).generateHookAction('existing-lead'),/disabled/);
 const response=await load('src/app/api/generate-hook/route.ts',modules).POST();
 assert.equal(response.status,409);assert.equal(authenticated,2);
 modules['@/lib/dashboard-auth'].requireAdmin=async()=>{throw new Error('Not authenticated');};
 await assert.rejects(load('src/app/api/generate-hook/route.ts',modules).POST(),/Not authenticated/);
});
