'use strict';
const {isUnsafeContact,isPlatformWebsite}=require('./prospect-qualification.cjs');
const EMAIL=/[a-z\d._%+-]+@(?:[a-z\d-]+\.)+[a-z]{2,24}/gi;
function tokenSafe(token){
 const suffix=token.split(/[./?#]/).filter(Boolean).at(-1)||'';
 // Do not silently repair joined sentences such as .comAre or .coachFor.
 return !/[a-z][A-Z]|[A-Z][a-z]/.test(suffix);
}
function publishedProfileEmails(input){
 if(!input.profileIdentityConfirmed)return [];
 const text=String(input.about||''),out=[];
 for(const match of text.matchAll(EMAIL)){
  const raw=match[0],before=text.slice(Math.max(0,match.index-140),match.index),after=text.slice(match.index+raw.length);
  if(isUnsafeContact(raw)||!tokenSafe(raw)||/^[\w@]|^\.[\w-]|^-(?!-{2})/.test(after)||/[\w@]$/.test(before))continue;
  // A sentence joined onto a local part is ambiguous, not a new email guess.
  if(/\blet[’']?s\s*$/i.test(before)&&/^connect\./i.test(raw))continue;
  const invitation=/(?:\be-?mail(?:ing)?\b|\breach\s+(?:me|out)\b|\bcontact\s+me\b|\blet[’']?s\s+(?:talk|connect|start\s+a\s+conversation)\b|📧|📩|💌|✉)/iu.test(before.normalize('NFKC').replace(/([a-z])([A-Z])/g,'$1 $2'));
  if(!invitation||/\b(?:example|sample|testimonial|client['’]s\s+email)\b/i.test(before.slice(-80)))continue;
  out.push({address:raw.toLowerCase(),source:'linkedin',url:input.linkedinUrl||input.url,ownership:'PUBLISHED',excerpt:(before.slice(-90)+raw).trim()});
 }
 return [...new Map(out.map(c=>[c.address,c])).values()];
}
function publishedProfileWebsites(input){
 const text=String(input.about||''),urls=[];
 const pattern=/(?<![\w@.-])(?:https?:\/\/|www\.)[^\s"'<>\])]+|(?<![\w@.-])(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,24}(?:\/[^\s"'<>\])]+)?/gi;
 for(const match of text.matchAll(pattern)){
  const token=match[0].replace(/[.,;:!?]+$/g,'');
  if(!tokenSafe(token.split('/').find(part=>part.includes('.'))||token))continue;
  try{
   const url=new URL(/^https?:\/\//i.test(token)?token:'https://'+token);
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||isPlatformWebsite(url.href))continue;
   // A domain occurring inside an address is not a published website URL.
   if(text[match.index-1]==='@')continue;
   urls.push(url.href);
  }catch{/* malformed published URL */}
 }
 return [...new Set(urls)].slice(0,8);
}
module.exports={publishedProfileEmails,publishedProfileWebsites};
