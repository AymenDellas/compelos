// Use the same AgentRouter transport identity for Create and Copy Studio.
export function agentRouterHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'codex_cli_rs/0.149.1',
    originator: 'codex_cli_rs',
    version: '0.149.1',
  };
}

// AgentRouter's GPT routes stream Responses events. Only a terminal response
// is a completed generation; text deltas and billing frames are not drafts.
/** @param {Response} response @param {AbortSignal} [signal] */
export async function readResponsesPayload(response, signal) {
  signal?.throwIfAborted();
  if(!/text\/event-stream/i.test(response.headers.get('content-type')||''))return response.json();
  if(!response.body)throw new Error('Empty Responses stream');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',bytes=0,terminal;
  function frame(value){
    const data=value.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||data.trim()==='[DONE]')return;
    const event=JSON.parse(data);
    if(!event||event.object==='billing.summary')return;
    if(event.type==='error'||event.error){terminal={status:'failed',error:event.error||{message:event.message||'The provider stream failed.'}};return;}
    if(['response.completed','response.failed','response.incomplete'].includes(event.type)){
      if(!event.response||typeof event.response!=='object')throw new Error('Missing terminal response');
      // Do not replace a genuine provider error with a later completion frame.
      if(!terminal?.error)terminal=event.response;
    }
  }
  const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    for(;;){
      const {done,value}=await reader.read();
      signal?.throwIfAborted();
      if(value){bytes+=value.byteLength;if(bytes>2_000_000)throw new Error('Oversized Responses stream');}
      buffer=(buffer+decoder.decode(value||new Uint8Array(),{stream:!done})).replace(/\r\n/g,'\n');
      let end;
      while((end=buffer.indexOf('\n\n'))!==-1){frame(buffer.slice(0,end));buffer=buffer.slice(end+2);}
      if(terminal)return terminal;
      if(done){if(buffer.trim())frame(buffer);if(terminal)return terminal;throw new Error('Responses stream ended without completion');}
    }
  }finally{
    signal?.removeEventListener('abort',abort);
    // A relay can keep its stream open after sending a terminal response.
    // Release the reader without waiting for the relay to acknowledge cancellation.
    void reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
