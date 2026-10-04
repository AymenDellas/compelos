'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FlipHorizontal2, Pause, Play, RotateCcw, X } from 'lucide-react';

export const teleprompterStoragePrefix = 'compel:teleprompter:';

export default function Teleprompter({title,script,onClose,standalone=false}) {
  const dialog = useRef(null);
  const viewport = useRef(null);
  const text = useRef(null);
  const elapsedRef = useRef(0);
  const handedOff = useRef(false);
  const [popupToken] = useState(()=>crypto.randomUUID());
  const [playing,setPlaying] = useState(false);
  const [speed,setSpeed] = useState(140);
  const [fontSize,setFontSize] = useState(38);
  const [mirrored,setMirrored] = useState(false);
  const [progress,setProgress] = useState(0);
  const [elapsed,setElapsed] = useState(0);
  const [error,setError] = useState('');
  const words = script.split(/\s+/).filter(Boolean).length;
  const paragraphs = script.split(/\n\s*\n/).filter(part=>part.trim());
  const popupStorageKey = teleprompterStoragePrefix+popupToken;
  const popupUrl = `/teleprompter#${popupToken}`;

  useEffect(()=>{
    if (standalone) return;
    try {localStorage.setItem(popupStorageKey,JSON.stringify({title,script}));} catch {}
    return ()=>{if (!handedOff.current) {try {localStorage.removeItem(popupStorageKey);} catch {}}};
  },[standalone,popupStorageKey,title,script]);

  useEffect(()=>{
    if (standalone) {viewport.current.focus({preventScroll:true});return;}
    const modal = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.showModal();
    viewport.current.focus({preventScroll:true});
    return ()=>{modal.close();document.body.style.overflow=previousOverflow;};
  },[standalone]);

  useEffect(()=>{
    const pauseWhenHidden = ()=>{if(document.hidden)setPlaying(false);};
    document.addEventListener('visibilitychange',pauseWhenHidden);
    return ()=>document.removeEventListener('visibilitychange',pauseWhenHidden);
  },[]);

  useEffect(()=>{
    if (!playing || !words) return;
    const reader = viewport.current;
    const pixelsPerSecond = text.current.getBoundingClientRect().height / words * speed / 60;
    let position = reader.scrollTop;
    let previousTime;
    let animation;
    const tick = now=>{
      if (previousTime!==undefined) {
        const seconds = Math.min((now-previousTime)/1000,0.1);
        const limit = reader.scrollHeight-reader.clientHeight;
        position = Math.min(limit,position+pixelsPerSecond*seconds);
        reader.scrollTop = position;
        elapsedRef.current += seconds;
        setElapsed(Math.floor(elapsedRef.current));
        if (position>=limit) {setPlaying(false);return;}
      }
      previousTime = now;
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(animation);
  },[playing,speed,fontSize,script,words]);

  const restart = ()=>{
    setPlaying(false);
    viewport.current.scrollTop = 0;
    elapsedRef.current = 0;
    setElapsed(0);
    setProgress(0);
  };
  const toggle = ()=>{
    const reader = viewport.current;
    if (!playing && reader.scrollTop>=reader.scrollHeight-reader.clientHeight-1) restart();
    setPlaying(value=>!value);
  };
  const keyboard = event=>{
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,button,a,textarea,select')) return;
    if (event.code==='Space') {event.preventDefault();toggle();}
    if (event.key.toLowerCase()==='r') {event.preventDefault();restart();}
    if (event.key==='ArrowUp' || event.key==='ArrowDown') setPlaying(false);
    if (standalone && event.key==='Escape') onClose();
  };
  const popOut = ()=>{
    try {
      localStorage.setItem(popupStorageKey,JSON.stringify({title,script}));
      const popup = window.open(popupUrl,'compel-teleprompter','popup,width=580,height=800,resizable=yes,scrollbars=yes');
      if (!popup) {
        setError('The popup was blocked. Allow popups for this dashboard, or keep reading here.');
        return;
      }
      handedOff.current = true;
      popup.opener = null;
      onClose();
    } catch {
      setError('Could not open a separate window. You can keep reading here.');
    }
  };

  const contents = <>
    <header className="teleprompter-header"><div><span className="label-micro">TELEPROMPTER</span><h2>{title || 'Your video script'}</h2></div><button className="teleprompter-icon" aria-label={standalone?'Close window':'Close teleprompter'} onClick={onClose}><X className="h-5 w-5"/></button></header>
    <div className="teleprompter-controls">
      <button className="teleprompter-play" onClick={toggle} disabled={!words}>{playing?<Pause className="h-4 w-4"/>:<Play className="h-4 w-4"/>}{playing?'Pause scrolling':'Start scrolling'}</button>
      <button className="teleprompter-icon" aria-label="Restart script" onClick={restart}><RotateCcw className="h-4 w-4"/></button>
      <label>Speed <span>{speed} wpm</span><input aria-label="Scrolling speed" type="range" min="60" max="220" step="10" value={speed} onChange={event=>setSpeed(Number(event.target.value))}/></label>
      <label>Text size <span>{fontSize} px</span><input aria-label="Teleprompter text size" type="range" min="24" max="64" step="2" value={fontSize} onChange={event=>setFontSize(Number(event.target.value))}/></label>
      <button className="teleprompter-icon" aria-label="Mirror script" aria-pressed={mirrored} onClick={()=>setMirrored(value=>!value)}><FlipHorizontal2 className="h-4 w-4"/></button>
      {!standalone&&<a role="button" className="teleprompter-popout" href={popupUrl} target="compel-teleprompter" onClick={event=>{event.preventDefault();popOut();}}><ExternalLink className="h-4 w-4"/>Separate window</a>}
    </div>
    {error&&<p className="teleprompter-error" role="alert">{error}</p>}
    <div className="teleprompter-reader" ref={viewport} tabIndex={0} aria-label="Spoken video script" onWheel={()=>setPlaying(false)} onTouchStart={()=>setPlaying(false)} onScroll={()=>{const reader=viewport.current;const limit=reader.scrollHeight-reader.clientHeight;setProgress(limit>0?Math.round(reader.scrollTop/limit*100):0);}} style={{'--teleprompter-font-size':fontSize+'px'}}>
      <div className="teleprompter-copy"><div ref={text} className={mirrored?'is-mirrored':''}>{paragraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div></div>
    </div>
    <footer className="teleprompter-footer"><span>{words} words · {Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')} elapsed</span><span>{progress}%</span><span>Space: play / pause · R: restart</span></footer>
  </>;

  if (standalone) return <main className="teleprompter-shell is-standalone" aria-label="Teleprompter" onKeyDown={keyboard}>{contents}</main>;
  if (typeof document==='undefined') return null;
  return createPortal(<dialog ref={dialog} className="teleprompter-shell" aria-label="Teleprompter" onKeyDown={keyboard} onCancel={event=>{event.preventDefault();onClose();}}>{contents}</dialog>,document.body);
}
