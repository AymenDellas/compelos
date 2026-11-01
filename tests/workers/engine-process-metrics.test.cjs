'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {descendants,createSampler}=require('../../src/lib/engine-process-metrics.cjs');

test('externally managed AliasMode browser trees and app overhead are included once',async()=>{
 const MiB=1048576,rows=[{pid:1,ppid:0,name:'node.exe',rss:10*MiB,cpuMs:0},{pid:10,ppid:0,name:'AliasMode Global.exe',rss:20*MiB,cpuMs:0},{pid:11,ppid:10,name:'sunbrowser.exe',rss:30*MiB,cpuMs:0},{pid:12,ppid:11,name:'sunbrowser.exe',rss:40*MiB,cpuMs:0},{pid:90,ppid:0,name:'unrelated.exe',rss:999*MiB,cpuMs:0}];
 const data=await createSampler({pid:1,read:async()=>rows,externalRoots:async()=>[11,999]})();assert.equal(data.treeRssMB,100);assert.equal(data.aliasmodeRssMB,90);assert.equal(data.chromeRoots.find(r=>r.pid===11).rssMB,70);assert.deepEqual(data.missingBrowserRoots,[999]);
});
const mb=1048576;
test('verified Firefox roots named aliasmode.exe retain separate account memory totals',async()=>{
 const rows=[{pid:1,ppid:0,name:'node.exe',rss:10*mb,cpuMs:0},{pid:10,ppid:0,name:'aliasmode.exe',rss:20*mb,cpuMs:0},{pid:11,ppid:10,name:'aliasmode-sidecar.exe',rss:30*mb,cpuMs:0},
  {pid:20,ppid:11,name:'aliasmode.exe',rss:40*mb,cpuMs:0},{pid:21,ppid:20,name:'aliasmode.exe',rss:50*mb,cpuMs:0},{pid:30,ppid:11,name:'aliasmode.exe',rss:60*mb,cpuMs:0},{pid:31,ppid:30,name:'aliasmode.exe',rss:70*mb,cpuMs:0}];
 const result=await createSampler({pid:1,read:async()=>rows,externalRoots:async()=>[20,30]})();assert.deepEqual(result.missingBrowserRoots,[]);assert.equal(result.treeRssMB,280);assert.equal(result.chromeRssMB,220);assert.deepEqual(result.chromeRoots.map(r=>[r.pid,r.rssMB]),[[20,90],[30,130]]);
});
test('includes every descendant renderer and excludes unrelated Chrome and sampler helper',()=>{
 const rows=[{pid:1,ppid:0,name:'node'},{pid:2,ppid:1,name:'chrome'},{pid:3,ppid:2,name:'chrome'},
  {pid:4,ppid:0,name:'chrome'},{pid:5,ppid:1,name:'powershell.exe'}];
 assert.deepEqual(descendants(rows,1).map(row=>row.pid),[1,2,3]);
});
test('reports whole Chrome RSS and per-core CPU using successive samples',async()=>{
 let at=0,cpu=100;
 const sample=createSampler({pid:1,now:()=>at,read:async()=>[
  {pid:1,ppid:0,name:'node',rss:30*mb,cpuMs:10},
  {pid:2,ppid:1,name:'chrome.exe',rss:150*mb,cpuMs:cpu},
  {pid:3,ppid:2,name:'chrome.exe',rss:100*mb,cpuMs:cpu},
 ]});
 const first=await sample();assert.equal(first.treeRssMB,280);assert.equal(first.chromeRssMB,250);assert.equal(first.cpuPercent,null);
 at=1000;cpu=350;const second=await sample();assert.equal(second.cpuPercent,50);assert.equal(second.peakTreeRssMB,280);
});
