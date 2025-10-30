// src/App.jsx — Fortunex AI v6.6 (UI polish: pricing note removed + responsive cards)
// Drop-in replacement. Paste, save, deploy.

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------- PRICING ---------- */
const PRICING = {
  monthly: { label: "Pro Monthly", price: "€7.10", cents: 710 },
  annual:  { label: "Pro Annual",  price: "€71.00", cents: 7100 },
  lifetime:{ label: "Lifetime",    price: "€107.00", cents: 10700 },
};

/* ---------- STRIPE (replace with your real Payment Links) ---------- */
export const STRIPE_MONTHLY = "https://buy.stripe.com/test-monthly_710";
export const STRIPE_ANNUAL  = "https://buy.stripe.com/test-annual_7100";
export const STRIPE_LIFE    = "https://buy.stripe.com/test-lifetime_10700";

/* ---------- NEWSLETTER (Formspree endpoint; empty => mailto fallback) ---------- */
const FORM_ENDPOINT = ""; // e.g. "https://formspree.io/f/xxxxxxx"

/* ---------- CONFIG ---------- */
const FREE_DAILY_CAP = 2;
const TRIAL_DAYS = 3;
const LS_KEY   = "fortunex-usage";
const LS_TRIAL = "fortunex-trial-since";
const LS_WATCH = "fortunex-watchlist";
const LS_REF   = "fortunex-ref-code";
const LS_REFSRC= "fortunex-ref-source";

/* ---------- Dexscreener REST ---------- */
const DS_API = "https://api.dexscreener.com/latest/dex/search?q=";

/* ---------- Helpers ---------- */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v ?? 0));
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const fmt = (n) =>
  typeof n === "number"
    ? (n >= 1_000_000
        ? `${(n / 1_000_000).toFixed(2)}M`
        : n >= 1_000
          ? `${(n / 1_000).toFixed(1)}k`
          : `${n.toFixed(2)}`)
    : "—";
const euro = (n) => (typeof n === "number" ? `€${fmt(n)}`.replace("€-", "-€") : "—");
const todayKey = () => { const d=new Date(); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`; };
const getUsage = () => { try { const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); return raw[todayKey()] ?? 0; } catch { return 0; } };
const addUsage = () => { const k=todayKey(); const raw=JSON.parse(localStorage.getItem(LS_KEY)||"{}"); raw[k]=(raw[k]??0)+1; localStorage.setItem(LS_KEY, JSON.stringify(raw)); };
const daysSince = (ts) => Math.floor((Date.now()-ts)/(1000*60*60*24));
const ensureTrialStart = () => { if(!localStorage.getItem(LS_TRIAL)) localStorage.setItem(LS_TRIAL, String(Date.now())); };
const trialRemainingDays = () => { const ts=Number(localStorage.getItem(LS_TRIAL)||0); if(!ts) return TRIAL_DAYS; const left=TRIAL_DAYS-daysSince(ts); return left>0?left:0; };
const classifyBias = (score) => score>=70?{t:"Bullish",color:"#16a34a"}:score>=45?{t:"Neutral",color:"#f59e0b"}:{t:"Bearish",color:"#dc2626"};
const readWatch = () => { try { return JSON.parse(localStorage.getItem(LS_WATCH) || "[]"); } catch { return []; } };
const writeWatch = (list) => localStorage.setItem(LS_WATCH, JSON.stringify(list.slice(0, 12)));
const getParam = (k) => new URLSearchParams(window.location.search).get(k) || "";

/* ---------- Referrals (no backend) ---------- */
function ensureRefCode() {
  let code = localStorage.getItem(LS_REF);
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase(); // 6 chars
    localStorage.setItem(LS_REF, code);
  }
  return code;
}
function captureRefSource() {
  const src = getParam("ref");
  if (src && !localStorage.getItem(LS_REFSRC)) {
    localStorage.setItem(LS_REFSRC, src);
  }
}
function buildCheckoutURL(base, planName) {
  const url = new URL(base);
  const refSrc  = localStorage.getItem(LS_REFSRC) || "";
  const myRef   = localStorage.getItem(LS_REF) || "";
  const cid = `plan=${encodeURIComponent(planName)}|ref=${refSrc || "none"}|my=${myRef}`;
  url.searchParams.set("client_reference_id", cid);
  // Optional Stripe promotion code:
  // url.searchParams.set("prefilled_promo_code", "REF8");
  return url.toString();
}

/* ---------- WHY + SCORE + CONFIDENCE ---------- */
function buildAnalysis(ds) {
  const pros=[], cons=[], flags=[];
  const ch = { h1:Number(ds?.priceChange?.h1??0), h6:Number(ds?.priceChange?.h6??0), h24:Number(ds?.priceChange?.h24??0) };
  const buyRatio = Number(ds?.buyerVsSeller?.buyRatio ?? 0);
  const tx24 = Number(ds?.txns24h?.buys ?? 0) + Number(ds?.txns24h?.sells ?? 0);
  const vol24 = Number(ds?.volume?.h24 ?? 0);
  const liq   = Number(ds?.liquidity?.usd ?? 0) || Number(ds?.liquidity?.base ?? 0);
  const mcap  = Number(ds?.fdv ?? ds?.marketCap ?? 0);
  const url   = ds?.url;
  const ageDays = ds?.pairCreatedAt ? Math.floor((Date.now()-new Date(ds.pairCreatedAt).getTime())/(1000*60*60*24)) : null;
  const renounced = !!ds?.info?.isOwnershipRenounced;
  const mintDisabled = !!ds?.info?.mintAuthorityDisabled || !!ds?.info?.isMintable === false;

  if (liq >= 150_000) pros.push("Strong liquidity pool supports smoother execution.");
  else if (liq >= 40_000) pros.push("Adequate liquidity for typical retail entries.");
  else { cons.push("Low liquidity may cause slippage and exit risk."); flags.push("Slippage/exit risk"); }

  if (vol24 >= 1_000_000) pros.push("High 24h volume indicating active interest.");
  else if (vol24 < 50_000) cons.push("Thin 24h volume; may be illiquid outside peak hours.");

  if (tx24 >= 2000) pros.push("Heavy transaction count; strong market participation.");
  else if (tx24 < 100) cons.push("Low transaction count; weak participation.");

  if (ch.h24 >= 20) pros.push("Strong 24h price momentum.");
  if (ch.h6 >= 10)  pros.push("Short-term uptrend visible in last 6h.");
  if (ch.h24 <= -15) { cons.push("Down 24h significantly; momentum risk."); flags.push("Momentum dump risk"); }
  if (ch.h1 <= -7 && ch.h24 > 0) cons.push("Sharp 1h pullback; watch for continuation or reversal.");

  if (buyRatio >= 0.55) pros.push(`Buyer share ${Math.round(buyRatio*100)}% (demand bias).`);
  if (buyRatio <= 0.45) cons.push(`Buyer share only ${Math.round(buyRatio*100)}% (supply pressure).`);

  if (ageDays!=null) {
    if (ageDays >= 60) pros.push("Mature pair age (trust/price discovery).");
    else if (ageDays <= 2) { cons.push("Very new pair; heightened rug/scam risk."); flags.push("New pair risk"); }
  }
  if (renounced) pros.push("Ownership renounced (reduced admin risk).");
  else cons.push("Ownership not renounced.");
  if (mintDisabled) pros.push("Mint authority disabled (limited supply inflation).");

  if (mcap > 0 && mcap < 10_000_000) pros.push("Low cap with room for upside if traction holds.");
  if (mcap >= 100_000_000) cons.push("Large market cap; upside may be slower.");

  let raw=50;
  raw += liq>=150_000?12: liq>=40_000?6:-8;
  raw += vol24>=1_000_000?10: vol24>=100_000?5:-6;
  raw += tx24>=2000?8: tx24>=300?3:-5;
  raw += ch.h24>=20?7: ch.h24<=-15?-8:0;
  raw += buyRatio>=0.55?5: buyRatio<=0.45?-4:0;
  raw += ageDays!=null?(ageDays>=60?5: ageDays<=2?-6:0):0;
  raw += renounced?4:-2;
  raw += mintDisabled?3:0;
  raw = clamp(raw,0,100);

  let inputs=0,present=0;
  [liq,vol24,tx24,ch.h1,ch.h6,ch.h24,buyRatio,mcap,ageDays??0].forEach(v=>{inputs++; if(Number.isFinite(v)) present++;});
  const completeness = present/inputs;
  const volPenalty = Math.max(0, Math.abs(ch.h1)-5)/30;
  let confidence = clamp(raw * (0.6 + 0.4*completeness) * (1 - volPenalty), 0, 100);

  const bias = classifyBias(raw);
  let rationale = bias.t==="Bullish"
    ? "Setup leans favorable: liquidity & participation are solid with positive momentum. Consider staged entries and strict risk caps."
    : bias.t==="Neutral"
      ? "Mixed signals: watch liquidity and near-term momentum. Consider waiting for confirmation or tighter stops."
      : "Risk-heavy profile: weak participation/liquidity or negative momentum. Best skipped unless a clear catalyst emerges.";

  let action = { title:"Wait for retest", detail:"Neutral read. Let price confirm with sustained buys and volume." };
  if (bias.t==="Bullish" && ch.h1<=-3 && ch.h24>10) action = { title:"Buy the dip (laddered)", detail:"24h uptrend with healthy pullback. Scale in across 2–3 entries." };
  else if (bias.t==="Bullish" && ch.h1>6)          action = { title:"Wait for cooldown", detail:"1h overheated. Look for consolidation or a 5–10% pullback." };
  else if (bias.t==="Bearish" && ch.h24<-15)       action = { title:"Avoid / Protect capital", detail:"Momentum down and participation weak. Preserve cash for better setups." };
  else if (bias.t!=="Bearish" && ch.h24>30)        action = { title:"Trail profits / Reduce risk", detail:"Large 24h gain. Consider trailing stops or partial take-profit." };

  return { pros, cons, flags, bias, raw, confidence, rationale, action, url };
}

/* ---------- UI ---------- */
export default function App() {
  const [q,setQ]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [pair,setPair]=useState(null);
  const [used,setUsed]=useState(0);
  const [showUpgrade,setShowUpgrade]=useState(false);
  const [watch,setWatch]=useState(readWatch());
  const [showNL,setShowNL]=useState(false);
  const [email,setEmail]=useState("");
  const [nlMsg,setNlMsg]=useState("");
  const [installEvt,setInstallEvt]=useState(null);
  const [route,setRoute]=useState((window.location.hash||"#/").replace(/^#/, ""));

  const [myRef, setMyRef] = useState(ensureRefCode());
  const refLink = useMemo(()=>{
    const u = new URL(window.location.href);
    u.searchParams.set("ref", myRef);
    return u.toString();
  }, [myRef]);

  const printRef = useRef(null);

  useEffect(()=>{ ensureTrialStart(); setUsed(getUsage()); captureRefSource(); },[]);
  const trialLeft = trialRemainingDays();

  useEffect(()=>{
    const onPrompt=(e)=>{ e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return ()=>window.removeEventListener("beforeinstallprompt", onPrompt);
  },[]);
  useEffect(()=>{
    const onHash=()=>setRoute((window.location.hash||"#/").replace(/^#/, ""));
    window.addEventListener("hashchange", onHash);
    return ()=>window.removeEventListener("hashchange", onHash);
  },[]);

  function parseQuery(raw){
    try{ const t=raw.trim(); if(!t) return ""; if(/^https?:\/\//i.test(t)) return t; return encodeURIComponent(t); }
    catch{ return ""; }
  }

  async function analyze(){
    setErr("");
    const key=parseQuery(q);
    if(!key){ setErr("Paste a valid DEX link, token address or name."); return; }
    if (trialLeft===0 && getUsage()>=FREE_DAILY_CAP) { setShowUpgrade(true); return; }
    setBusy(true);
    try{
      const res = await fetch(DS_API + key);
      const data = await res.json();
      const best = (data?.pairs || [])[0];
      if(!best) throw new Error("No matching pair found.");
      const an = buildAnalysis(best);
      setPair({ ds: best, an });
      addUsage(); setUsed(getUsage());
    }catch(e){ setErr(e.message || "Failed to analyze."); setPair(null); }
    finally{ setBusy(false); }
  }

  function addToWatch(){
    if(!pair) return;
    const symbol = `${pair.ds?.baseToken?.symbol}/${pair.ds?.quoteToken?.symbol}`;
    const url = pair.an.url;
    const list = readWatch().filter(x=>x.url!==url);
    list.unshift({symbol,url});
    writeWatch(list); setWatch(list);
  }
  function removeFromWatch(url){ const list=readWatch().filter(x=>x.url!==url); writeWatch(list); setWatch(list); }

  function copySummary(){
    if(!pair) return;
    const ds=pair.ds, an=pair.an;
    const text =
`FORTUNEX AI — Quick Read
Pair: ${ds?.baseToken?.symbol}/${ds?.quoteToken?.symbol}
Bias: ${an.bias.t} • Score ${Math.round(an.raw)}/100 • Confidence ${Math.round(an.confidence)}%
Liquidity: ${euro(Number(ds?.liquidity?.usd ?? 0))} • Vol24: ${euro(Number(ds?.volume?.h24 ?? 0))}
Tx24: ${ds?.txns24h?.buys ?? 0} buys / ${ds?.txns24h?.sells ?? 0} sells • Buyer Share: ${ds?.buyerVsSeller?.buyRatio!=null ? pct(ds.buyerVsSeller.buyRatio):"—"}
Action: ${an.action.title} — ${an.action.detail}
(Ed. only — not financial advice)`;
    navigator.clipboard?.writeText(text);
  }

  function exportPDF(){
    if(!pair) return;
    const win = window.open("", "_blank");
    const html = printRef.current?.innerHTML || "";
    win.document.write(`<html><head><title>Fortunex Report</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',sans-serif;background:#0b1220;color:#e5e7eb;margin:0;padding:24px;}
        .card{background:#0c162a;border:1px solid #1f2a44;border-radius:12px;padding:16px;margin-bottom:12px;}
        .h{font-weight:800}
        .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
        .pill{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid #334155}
      </style></head><body>${html}</body></html>`);
    win.document.close(); win.focus(); win.print();
  }

  async function submitNewsletter(e){
    e.preventDefault();
    setNlMsg("");
    if(!email || !/.+@.+\..+/.test(email)) { setNlMsg("Enter a valid email."); return; }
    try{
      if (FORM_ENDPOINT) {
        const r = await fetch(FORM_ENDPOINT, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ email }) });
        if(!r.ok) throw new Error("Submit failed");
        setNlMsg("Thanks! You're on the list.");
      } else {
        window.location.href = `mailto:newsletter@fortunex.ai?subject=Subscribe&body=${encodeURIComponent(email)}`;
        setNlMsg("Opening mail app… If nothing opens, email newsletter@fortunex.ai");
      }
      setEmail("");
    }catch{ setNlMsg("Could not submit right now."); }
  }

  function triggerInstall(){ if(installEvt){ installEvt.prompt(); installEvt.userChoice?.then(()=>setInstallEvt(null)); } }

  const badge = useMemo(()=> pair ? classifyBias(pair.an.raw) : null, [pair]);

  /* ---------- Shared UI bits ---------- */
  const Label = ({children}) => (
    <span style={{background:"#0c111b",border:"1px solid #1f2937",color:"#cbd5e1",fontSize:12,padding:"3px 8px",borderRadius:999}}>{children}</span>
  );
  const btnLink = { display:"grid", placeItems:"center", background:"#0a1a2f", border:"1px solid #1f2a44", borderRadius:12, textDecoration:"none", color:"#cbd5e1", fontWeight:700 };
  const btnSm    = { background:"#0b1220", color:"#e5e7eb", border:"1px solid #1f2937", borderRadius:10, padding:"6px 10px", fontWeight:700, cursor:"pointer" };
  const btnGhost = { background:"transparent", color:"#e5e7eb", border:"1px solid #334155", borderRadius:10, padding:"6px 10px", cursor:"pointer" };
  const btnGrad  = { background:"linear-gradient(135deg,#60a5fa,#22c55e)", color:"#0b1220", border:"none", borderRadius:12, padding:"10px 16px", fontWeight:800, cursor:"pointer" };

  /* ---------- Screens ---------- */
  const routeHome = route === "/" || route === "";

  return (
    <div style={{minHeight:"100vh", background:"#0b1220", color:"#e5e7eb"}}>
      {/* Top Bar */}
      <div style={{maxWidth:1100, margin:"0 auto", padding:"18px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
        <div style={{display:"flex", gap:12, alignItems:"center"}}>
          <div style={{width:38,height:38,borderRadius:999,background:"linear-gradient(135deg,#0EA5E9,#22C55E)",display:"grid",placeItems:"center",fontWeight:800}}>F</div>
          <div>
            <div style={{fontWeight:800, letterSpacing:0.5}}>FORTUNEX AI</div>
            <div style={{fontSize:12, color:"#9ca3af"}}>Token Intelligence Dashboard</div>
          </div>
        </div>
        <div style={{display:"flex", gap:10, alignItems:"center"}}>
          {installEvt && <button onClick={triggerInstall} style={{ background:"#0b1220", color:"#e5e7eb", border:"1px solid #1f2937", borderRadius:10, padding:"6px 10px", fontWeight:700, cursor:"pointer" }}>Install App</button>}
          <button onClick={()=>setShowNL(true)} style={{ background:"#0b1220", color:"#e5e7eb", border:"1px solid #1f2937", borderRadius:10, padding:"6px 10px", fontWeight:700, cursor:"pointer" }}>Newsletter</button>
          <a href="#/" style={{color:"#e5e7eb", textDecoration:"none", fontWeight:700}}>Home</a>
          <a href="#/terms" style={{color:"#e5e7eb", textDecoration:"none", fontWeight:700}}>Terms</a>
          <a href="#/privacy" style={{color:"#e5e7eb", textDecoration:"none", fontWeight:700}}>Privacy</a>
          <a href="#pricing" style={{color:"#facc15", textDecoration:"none", fontWeight:700}}>Pricing</a>
        </div>
      </div>

      {/* Trial Banner */}
      {routeHome && trialLeft>0 && (
        <div style={{maxWidth:1100, margin:"0 auto 10px", padding:"10px 12px", border:"1px solid #f59e0b55", borderRadius:10, background:"#0a1a2f"}}>
          <strong style={{color:"#fbbf24"}}>Trial:</strong> You have <strong>{trialLeft} day{trialLeft>1?"s":""}</strong> left. Full features—no card required.
        </div>
      )}

      {/* Home */}
      {routeHome && (
        <>
          {/* Input + Watchlist */}
          <div style={{maxWidth:1100, margin:"0 auto", padding:"0 16px 16px"}}>
            <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:16}}>
              {/* Input */}
              <div style={{background:"#0c162a", border:"1px solid #1f2a44", borderRadius:14, padding:18}}>
                <div style={{fontWeight:700, marginBottom:8}}>Paste DEX link / address / name</div>
                <input
                  placeholder="https://dexscreener.com/solana/xxxx or CA/name"
                  value={q} onChange={(e)=>setQ(e.target.value)}
                  style={{width:"100%", background:"#0a1220", color:"#e5e7eb", border:"1px solid #1f2a44", borderRadius:12, padding:"12px 14px", outline:"none"}}
                />
                <div style={{display:"flex", alignItems:"center", gap:12, marginTop:12}}>
                  <button onClick={analyze} disabled={busy} style={btnGrad}>{busy?"Analyzing…":"Analyze"}</button>
                  <Label>Free uses today: {Math.max(0, FREE_DAILY_CAP - used)} / {FREE_DAILY_CAP}</Label>
                </div>
                {err && <div style={{marginTop:10, color:"#f87171"}}>{err}</div>}
              </div>

              {/* Watchlist + Referrals */}
              <div style={{background:"#0c162a", border:"1px solid #1f2a44", borderRadius:14, padding:18}}>
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                  <div style={{fontWeight:800}}>Watchlist</div>
                  {pair && <button onClick={addToWatch} style={btnSm}>+ Add current</button>}
                </div>
                <div style={{marginTop:10, display:"grid", gap:8}}>
                  {watch.length===0 && <div style={{color:"#94a3b8"}}>No saved pairs yet.</div>}
                  {watch.map((w,i)=>(
                    <div key={w.url+i} style={{display:"flex", justifyContent:"space-between", alignItems:"center", background:"#0a1220", border:"1px solid #1f2a44", borderRadius:10, padding:"8px 10px"}}>
                      <a href={w.url} target="_blank" rel="noreferrer" style={{textDecoration:"none", color:"#e5e7eb"}}>{w.symbol}</a>
                      <button onClick={()=>removeFromWatch(w.url)} style={btnGhost}>Remove</button>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:14, borderTop:"1px solid #1f2a44", paddingTop:12}}>
                  <div style={{fontWeight:800, marginBottom:6}}>Invite & Earn</div>
                  <div style={{fontSize:12, color:"#94a3b8"}}>Share your link — we append your code to Stripe as <code>client_reference_id</code>. Enable promo <b>REF8</b> in Stripe to auto-discount.</div>
                  <div style={{display:"grid", gridTemplateColumns:"1fr auto", gap:8, marginTop:8}}>
                    <input value={refLink} readOnly style={{background:"#0a1220", color:"#e5e7eb", border:"1px solid #1f2a44", borderRadius:10, padding:"8px 10px"}}/>
                    <button onClick={()=>navigator.clipboard?.writeText(refLink)} style={btnSm}>Copy</button>
                  </div>
                  <div style={{fontSize:12, color:"#94a3b8", marginTop:6}}>
                    Your code: <b>{myRef}</b> • Referred by: <b>{localStorage.getItem(LS_REFSRC) || "—"}</b>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RESULT + PRINT AREA */}
          <div ref={printRef}>
          {pair && (
            <div style={{maxWidth:1100, margin:"0 auto", padding:"0 16px 24px"}}>
              <div style={{background:"#0c162a", border:"1px solid #1f2a44", borderRadius:14, padding:18}}>
                {/* Header */}
                <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:10, flexWrap:"wrap"}}>
                  <div style={{width:28,height:28,borderRadius:999,background:"#1d4ed833",display:"grid",placeItems:"center"}}>👀</div>
                  <div style={{fontWeight:800}}>{pair.ds?.baseToken?.symbol}/{pair.ds?.quoteToken?.symbol}</div>
                  {pair && (
                    <span style={{marginLeft:"auto",background:classifyBias(pair.an.raw).color+"22",color:classifyBias(pair.an.raw).color,border:`1px solid ${classifyBias(pair.an.raw).color}66`,padding:"3px 10px",borderRadius:999,fontWeight:700}}>
                      {classifyBias(pair.an.raw).t} • Score: {Math.round(pair.an.raw)}/100
                    </span>
                  )}
                  <span style={{background:"#0b1220",border:"1px solid #1f2937",borderRadius:999,padding:"3px 10px",fontWeight:700}}>
                    Confidence: {Math.round(pair.an.confidence)}%
                  </span>
                </div>

                {/* Bars */}
                <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12}}>
                  <MetricBar title="Stability" value={stabilityFrom(pair.ds)} />
                  <MetricBar title="Growth" value={growthFrom(pair.ds)} />
                  <MetricBar title="Momentum" value={momentumFrom(pair.ds)} />
                </div>

                {/* Why + Action + Flags */}
                <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:14, marginTop:16}}>
                  <div style={{background:"#0a1a2f", border:"1px solid #1f2a44", borderRadius:12, padding:14}}>
                    <div style={{fontWeight:800, marginBottom:6}}>Why this verdict?</div>
                    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
                      <ListCard title="Pros" color="#86efac" items={pair.an.pros} empty="No strong positives detected." />
                      <ListCard title="Cons" color="#fca5a5" items={pair.an.cons} empty="No major red flags detected." />
                    </div>
                    <div style={{marginTop:10, padding:10, borderRadius:10, background:"#0b1220", border:"1px solid #1f2937", color:"#cbd5e1"}}>
                      <strong>AI Insight:</strong> {pair.an.rationale}
                      <div style={{fontSize:12, color:"#94a3b8", marginTop:6}}>Educational insights only — Not financial advice.</div>
                    </div>
                  </div>

                  <div style={{display:"grid", gap:12}}>
                    <div style={{background:"#0a1a2f", border:"1px solid #1f2a44", borderRadius:12, padding:14}}>
                      <div style={{fontWeight:800, marginBottom:6}}>Next Action</div>
                      <div style={{fontWeight:900}}>{pair.an.action.title}</div>
                      <div style={{color:"#cbd5e1", marginTop:4}}>{pair.an.action.detail}</div>
                      <div style={{display:"flex", gap:8, marginTop:10, flexWrap:"wrap"}}>
                        <button onClick={copySummary} style={btnSm}>Copy summary</button>
                        <a className="clean" href={pair.an.url} target="_blank" rel="noreferrer" style={{...btnSm, textDecoration:"none"}}>Open on DEX</a>
                        <button onClick={exportPDF} style={btnSm}>Export PDF</button>
                      </div>
                    </div>
                    <div style={{background:"#0a1a2f", border:"1px solid #1f2a44", borderRadius:12, padding:14}}>
                      <div style={{fontWeight:800, marginBottom:6}}>Risk Flags</div>
                      {pair.an.flags.length
                        ? <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>{pair.an.flags.map((f,i)=>(
                            <span key={i} style={{background:"#3f1d1d", color:"#fca5a5", border:"1px solid #7f1d1d", padding:"4px 8px", borderRadius:999, fontSize:12}}>{f}</span>
                          ))}</div>
                        : <div style={{color:"#94a3b8"}}>No critical flags detected.</div>}
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginTop:16}}>
                  <Stat title="Price (USD)" value={pair.ds?.priceUsd ? `$${Number(pair.ds.priceUsd).toFixed(6)}` : "—"} />
                  <Stat title="Liquidity" value={euro(Number(pair.ds?.liquidity?.usd ?? 0))} />
                  <Stat title="Vol 24h" value={euro(Number(pair.ds?.volume?.h24 ?? 0))} />
                  <Stat title="Tx 24h" value={`${pair.ds?.txns24h?.buys ?? 0} buys / ${pair.ds?.txns24h?.sells ?? 0} sells`} />
                  <Stat title="Buyer Share" value={pair.ds?.buyerVsSeller?.buyRatio!=null ? pct(pair.ds.buyerVsSeller.buyRatio) : "—"} />
                  <Stat title="Pair Age" value={pair.ds?.pairCreatedAt ? new Date(pair.ds.pairCreatedAt).toLocaleDateString() : "—"} />
                  <Stat title="FDV/MC" value={euro(Number(pair.ds?.fdv ?? pair.ds?.marketCap ?? 0))} />
                  <a className="clean" style={btnLink} href={pair.ds?.url} target="_blank" rel="noreferrer">View on DEX</a>
                </div>
              </div>
            </div>
          )}
          </div>

          {/* Pricing */}
          <div id="pricing" style={{maxWidth:1100, margin:"0 auto", padding:"16px"}}>
            <div style={{background:"#0c162a", border:"1px solid #1f2a44", borderRadius:14, padding:18}}>
              <div style={{fontWeight:800, marginBottom:8}}>Upgrade • Unlock unlimited analyses</div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:12}}>
                <PlanCard
                  name={PRICING.monthly.label} price={PRICING.monthly.price}
                  cta="Start Monthly"
                  href={buildCheckoutURL(STRIPE_MONTHLY, "monthly")}
                  note={`Your ref: ${myRef}`}
                />
                <PlanCard
                  name={PRICING.annual.label}  price={PRICING.annual.price}
                  cta="Start Annual"
                  href={buildCheckoutURL(STRIPE_ANNUAL, "annual")}
                  note={`Your ref: ${myRef}`}
                />
                <PlanCard
                  name={PRICING.lifetime.label} price={PRICING.lifetime.price}
                  cta="Buy Lifetime"
                  href={buildCheckoutURL(STRIPE_LIFE, "lifetime")}
                  note={`Your ref: ${myRef}`}
                />
              </div>
              <div style={{fontSize:12, color:"#94a3b8", marginTop:8}}>
                Educational tool — not financial advice.
              </div>
            </div>
          </div>
        </>
      )}

      {/* Terms / Privacy simple pages */}
      {route==="/terms" && (
        <LegalShell title="Terms of Use">
          <p><b>Educational Only.</b> Fortunex AI summarizes publicly available market data for learning purposes. It is <b>not</b> financial advice. You are responsible for your decisions.</p>
          <p><b>No Warranties.</b> Data may be delayed, incomplete, or inaccurate. The service is provided “as is”.</p>
          <p><b>Acceptable Use.</b> Don’t scrape, spam, abuse, or reverse-engineer the service. Don’t use outputs to mislead others.</p>
          <p><b>Subscriptions.</b> Managed by our payment provider (e.g., Stripe). You can cancel anytime through that provider.</p>
          <p><b>Refunds.</b> If a refund policy is offered, it will appear on the checkout page. Otherwise, purchases are final except where required by law.</p>
          <p><b>Liability.</b> To the fullest extent permitted by law, we are not liable for any losses or damages arising from your use of the product.</p>
          <p><b>Contact.</b> newsletter@fortunex.ai</p>
        </LegalShell>
      )}
      {route==="/privacy" && (
        <LegalShell title="Privacy Policy">
          <p><b>Data We Handle.</b> We process inputs you paste (links/addresses) to fetch public on-chain data. Settings and watchlist are stored in your browser (localStorage).</p>
          <p><b>Accounts.</b> Our MVP does not require sign-in. Payment and subscription data are handled by our payment provider.</p>
          <p><b>Analytics.</b> We may use privacy-friendly analytics to improve performance and stability.</p>
          <p><b>Emails.</b> If you subscribe to our newsletter, your email is stored with our email provider and used only for updates and promotions. You can unsubscribe anytime.</p>
          <p><b>Security.</b> We use modern hosting and HTTPS, but no system is perfectly secure.</p>
          <p><b>Contact.</b> newsletter@fortunex.ai</p>
        </LegalShell>
      )}

      {/* Upgrade Modal */}
      {showUpgrade && (
        <div style={{position:"fixed", inset:0, background:"#0008", display:"grid", placeItems:"center", zIndex:50}}>
          <div style={{width:"min(92vw,680px)", background:"#0c162a", border:"1px solid #1f2a44", borderRadius:14, padding:18}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <div style={{fontWeight:800}}>Daily limit reached</div>
              <button onClick={()=>setShowUpgrade(false)} style={{background:"transparent", color:"#e5e7eb", border:"none", fontSize:18}}>✕</button>
            </div>
            <div style={{marginTop:8, color:"#cbd5e1"}}>
              You’ve used the free {FREE_DAILY_CAP} analyses for today{trialLeft>0 ? ` (trial ${trialLeft} day${trialLeft>1?"s":""} left).` : "."} Upgrade to continue:
            </div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:12, marginTop:12}}>
              <PlanCard name={PRICING.monthly.label} price={PRICING.monthly.price} cta="Start Monthly" href={buildCheckoutURL(STRIPE_MONTHLY, "monthly")}/>
              <PlanCard name={PRICING.annual.label}  price={PRICING.annual.price}  cta="Start Annual"  href={buildCheckoutURL(STRIPE_ANNUAL, "annual")}/>
              <PlanCard name={PRICING.lifetime.label}price={PRICING.lifetime.price}cta="Buy Lifetime" href={buildCheckoutURL(STRIPE_LIFE, "lifetime")}/>
            </div>
            <div style={{fontSize:12, color:"#94a3b8", marginTop:8}}>
              Educational tool — not financial advice.
            </div>
          </div>
        </div>
      )}

      {/* Newsletter Modal */}
      {showNL && (
        <div style={{position:"fixed", inset:0, background:"#0008", display:"grid", placeItems:"center", zIndex:60}}>
          <div style={{width:"min(92vw,520px)", background:"#0c162a", border:"1px solid #1f2a44", borderRadius:14, padding:18}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <div style={{fontWeight:800}}>Join the Fortunex Newsletter</div>
              <button onClick={()=>setShowNL(false)} style={{background:"transparent", color:"#e5e7eb", border:"none", fontSize:18}}>✕</button>
            </div>
            <div style={{color:"#cbd5e1", marginTop:6}}>Alpha drops, feature updates, and promos. No spam.</div>
            <form onSubmit={submitNewsletter} style={{display:"flex", gap:8, marginTop:12}}>
              <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@email.com"
                     style={{flex:1, background:"#0a1220", color:"#e5e7eb", border:"1px solid #1f2a44", borderRadius:10, padding:"10px 12px"}}/>
              <button type="submit" style={{ background:"linear-gradient(135deg,#60a5fa,#22c55e)", color:"#0b1220", border:"none", borderRadius:12, padding:"10px 16px", fontWeight:800, cursor:"pointer" }}>
                Subscribe
              </button>
            </form>
            {nlMsg && <div style={{marginTop:8, color:"#fbbf24"}}>{nlMsg}</div>}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{textAlign:"center", color:"#94a3b8", padding:"20px 0 40px"}}>
        <div style={{display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap", marginBottom:8}}>
          <a href="#/terms" style={{color:"#D4AF37"}}>Terms</a>
          <a href="#/privacy" style={{color:"#D4AF37"}}>Privacy</a>
          <a href="#/" style={{color:"#2E86DE"}}>Home</a>
        </div>
        © {new Date().getFullYear()} Fortunex AI • Educational insights only.
      </div>
    </div>
  );
}

/* ---------- Components ---------- */
function MetricBar({title, value}) {
  const v = clamp(value, 0, 10);
  return (
    <div style={{background:"#0a1a2f", border:"1px solid #1f2a44", borderRadius:12, padding:12}}>
      <div style={{fontSize:12, color:"#9ca3af", marginBottom:6}}>{title}</div>
      <div style={{height:10, background:"#091425", borderRadius:8, overflow:"hidden"}}>
        <div style={{height:"100%", width:`${(v/10)*100}%`, background:"linear-gradient(90deg,#60a5fa,#22c55e)"}}/>
      </div>
      <div style={{fontSize:12, color:"#94a3b8", marginTop:4}}>{v.toFixed(1)}/10</div>
    </div>
  );
}
function Stat({title, value}) {
  return (
    <div style={{background:"#0a1a2f", border:"1px solid #1f2a44", borderRadius:12, padding:12}}>
      <div style={{fontSize:12, color:"#9ca3af"}}>{title}</div>
      <div style={{fontWeight:800, marginTop:4}}>{value}</div>
    </div>
  );
}
function PlanCard({name, price, cta, href, note}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>
      <div style={{height:"100%", background:"#0a1a2f", border:"1px solid #1f2a44", borderRadius:12, padding:14, color:"#e5e7eb"}}>
        <div style={{fontWeight:800}}>{name}</div>
        <div style={{fontSize:24, fontWeight:900, margin:"6px 0"}}>{price}</div>
        {note && <div style={{fontSize:12, color:"#9ca3af"}}>{note}</div>}
        <div style={{marginTop:10, background:"linear-gradient(135deg,#60a5fa,#22c55e)", color:"#0b1220", borderRadius:10, padding:"8px 10px", textAlign:"center", fontWeight:900}}>{cta}</div>
      </div>
    </a>
  );
}
function ListCard({title, color, items, empty}) {
  return (
    <div>
      <div style={{fontWeight:700, color, marginBottom:6}}>{title}</div>
      <ul style={{margin:"0 0 0 18px", padding:0}}>
        {items.length ? items.map((p,i)=>(<li key={i} style={{marginBottom:4}}>{p}</li>)) : <li>{empty}</li>}
      </ul>
    </div>
  );
}
function LegalShell({title, children}) {
  return (
    <div style={{maxWidth:900, margin:"0 auto", padding:"0 16px 32px"}}>
      <div style={{background:"#0c162a", border:"1px solid #1f2a44", borderRadius:14, padding:18}}>
        <div style={{fontWeight:900, fontSize:20, marginBottom:10}}>{title}</div>
        <div style={{color:"#e5e7eb", lineHeight:1.7, fontSize:14}}>
          {children}
        </div>
        <div style={{marginTop:16}}>
          <a href="#/" style={{color:"#2E86DE"}}>← Back to app</a>
        </div>
      </div>
    </div>
  );
}

/* ---------- Derived metrics for bars ---------- */
function stabilityFrom(ds) {
  const liq = Number(ds?.liquidity?.usd ?? 0);
  const tx24 = Number(ds?.txns24h?.buys ?? 0) + Number(ds?.txns24h?.sells ?? 0);
  let s = 0;
  s += liq >= 150_000 ? 6 : liq >= 40_000 ? 4 : 2;
  s += tx24 >= 2000 ? 4 : tx24 >= 300 ? 2 : 0;
  return clamp(s, 0, 10);
}
function growthFrom(ds) {
  const vol24 = Number(ds?.volume?.h24 ?? 0);
  const mcap = Number(ds?.fdv ?? ds?.marketCap ?? 0);
  let g = 0;
  g += vol24 >= 1_000_000 ? 6 : vol24 >= 100_000 ? 4 : 2;
  g += mcap > 0 && mcap < 10_000_000 ? 4 : 2;
  return clamp(g, 0, 10);
}
function momentumFrom(ds) {
  const h6 = Number(ds?.priceChange?.h6 ?? 0);
  const h24 = Number(ds?.priceChange?.h24 ?? 0);
  let m = 5 + (h6/20) + (h24/20);
  return clamp(m, 0, 10);
    }
