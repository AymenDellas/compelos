const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/content-create/teleprompter-pip.js'),'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const mod = {exports:{}};
new Function('module','exports',compiled)(mod,mod.exports);
const open = mod.exports.openTeleprompterPictureInPicture;

function fixture() {
  const nodes = [];
  let closes = 0;
  let requested;
  const floating = {
    close(){closes++;},
    document:{
      documentElement:{},body:{style:{}},head:{appendChild(node){nodes.push(node);}},
      createElement(tagName){return {tagName};},
    },
  };
  const source = {
    location:{href:'https://compel.example/dashboard'},
    document:{
      documentElement:{lang:'en'},body:{className:'font-sans'},
      querySelectorAll(){return [
        {tagName:'LINK',href:'https://compel.example/_next/static/studio.css',cloneNode(){return {tagName:'LINK',href:'/studio.css'};}},
        {tagName:'STYLE',cloneNode(){return {tagName:'STYLE',textContent:'.teleprompter{color:white}'};}},
      ];},
    },
    documentPictureInPicture:{async requestWindow(options){requested=options;return floating;}},
  };
  return {source,floating,nodes,get closes(){return closes;},get requested(){return requested;}};
}

async function main() {
  await assert.rejects(open({}),/supported desktop browser/);
  const normal = fixture();
  assert.equal(await open(normal.source),normal.floating);
  assert.deepEqual(normal.requested,{width:480,height:700});
  assert.equal(normal.floating.document.title,'Teleprompter · Compel');
  assert.equal(normal.floating.document.body.className,'font-sans');
  assert.equal(normal.floating.document.body.style.overflow,'hidden');
  assert.equal(normal.nodes[0].href,'https://compel.example/dashboard');
  assert.equal(normal.nodes[1].href,'https://compel.example/_next/static/studio.css');
  assert.equal(normal.nodes[2].textContent,'.teleprompter{color:white}');
  assert.equal(normal.closes,0);
  const denied = fixture();
  denied.source.documentPictureInPicture.requestWindow=async()=>{throw new Error('Permission denied');};
  await assert.rejects(open(denied.source),/Permission denied/);
  assert.equal(denied.nodes.length,0);
  const brokenStyles = fixture();
  brokenStyles.source.document.querySelectorAll=()=>{throw new Error('Style copy failed');};
  await assert.rejects(open(brokenStyles.source),/Style copy failed/);
  assert.equal(brokenStyles.closes,1,'A failed setup must not leave an empty floating window');
  console.log('Teleprompter PiP checks passed: native floating window, styling, unsupported browsers, permission failures, and cleanup.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
