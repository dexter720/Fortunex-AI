import React from 'react';

/* =============================
   FORTUNEX AI v2 (frontend-only)
   - 2 free analyses/day gating
   - History (local)
   - Favorites (local)
   - Buyer/Seller ratio
   - Liquidity / Volume tiles
   - Mini sparkline (h1/h6/h24)
   - Copy/Share summary
   - Token logo (if provided)
   ============================= */

// ---- Stripe Payment Links (replace with your real links) ----
export const STRIPE_PRO_LINK   = "https://buy.stripe.com/test_XXXXXXXXXXXXpro";
export const STRIPE_ELITE_LINK = "https://buy.stripe.com/test_XXXXXXXXXXXXelite";

// ---- Dexscreener helpers ----
const DS_API = "https://api.dexscreener.com/latest/dex/";
function parseDexLink(raw) {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    // ex: https://dexscreener.com/solana/PAIRADDRESS
    if (host.includes("dexscreener.com") && parts.length >= 2) {
      return { provider: "dexscreener", chain: parts[0], id: parts[1] };
    }
    return { provider: "unknown", id: raw };
  } catch { return null; }
}
async function fetchDexscreener(chain, id) {
  const urls = [`${DS_API}pairs/${chain}/${id}`, `${DS_API}tokens/${id}`];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const d = await r.json();
      if (d?.pairs?.length) return d;
    } catch {}
  }
  return null;
}

// ---- utils ----
const k = (n=0,d=2)=>{const x=Number(n)||0;if(Math.abs(x)>=1e9)return(x/1e9).toFixed(d)+"B";if(Math.abs(x)>=1e6)return(x/1e6).toFixed(d)+"M";if(Math.abs(x)>=1e3)return(x/1e3).toFixed(d)+"k";return x.toFixed(d);};
const fmtDate = (ms)=> (ms ? new Date(ms).toLocaleDateString() : "—");
const clamp = (x,a,b)=> Math.max(a, Math.min(b,x));
const pct = (num)=> (num==null? "—" : `${Number(num).toFixed(2)}%`);

function scoreFrom(pair){
  if(!pair) return { total:50, label:"Neutral" };
  const liq = pair?.liquidity?.usd ?? 0;
  const vol = pair?.volume?.h24 ?? 0;
  const buys = pair?.txns?.h24?.buys ?? 0;
  const sells= pair?.txns?.h24?.sells ?? 0;
  const change = pair?.priceChange?.h24 ?? 0;
  const base = Math.log10(liq+vol+1)*10 + (buys-sells) + change;
  const total = Math.round(clamp(base,0,100));
  const label = total>66 ? "Bullish" : total<33 ? "Bearish" : "Neutral";
  return { total, label };
}

// tiny sparkline from h1/h6/h24 change
function buildSparkPoints(pc={}){
  const seq = [
    {t:0,  v:0},
    {t:1,  v:Number(pc.h1 ?? 0)},
    {t:6,  v:Number(pc.h6 ?? 0)},
    {t:24, v:Number(pc.h24 ?? 0)},
  ];
  const ys = seq.map(p=>p.v);
  const min = Math.min(...ys), max=Math.max(...ys); const range = max-min || 1;
  return seq.map(p=>({ x:(p.t/24)*100, y:100 - ((p.v-min)/range)*100 }));
}

// localStorage keys
const LSK_PRO = "fx_isPro";
const LSK_DAILY = (d=new Date())=>`fx_daily_${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
const LSK_HISTORY = "fx_history";
const LSK_FAVS = "fx_favorites";

export default function FortunexAIApp(){
  const [link,setLink] = React.useState("");
  const [result,setResult] = React.useState(null);
  const [loading,setLoading] = React.useState(false);
  const [showUpgrade,setShowUpgrade] = React.useState(false);
  const [isPro,setIsPro] = React.useState(()=>{ try{return JSON.parse(localStorage.getItem(LSK_PRO)||"false");}catch{return false;} });
  const [history,setHistory] = React.useState(()=>{ try{return JSON.parse(localStorage.getItem(LSK_HISTORY)||"[]");}catch{return [];} });
  const [favs,setFavs] = React.useState(()=>{ try{return JSON.parse(localStorage.getItem(LSK_FAVS)||"[]");}catch{return [];} });

  const FREE_LIMIT = 2;

  // auto-upgrade from Stripe
  React.useEffect(()=>{
    const p = new URLSearchParams(window.location.search);
    if(p.get("pro")==="1"){
      localStorage.setItem(LSK_PRO,"true"); setIsPro(true);
      const url = window.location.origin + window.location.pathname;
      window.history.replaceState({}, "", url);
    }
  },[]);

  const getCount = ()=>{ try{return parseInt(localStorage.getItem(LSK_DAILY())||"0",10)||0;}catch{return 0;} };
  const incCount = ()=>{ const n=getCount()+1; localStorage.setItem(LSK_DAILY(), String(n)); };

  function toggleFav(id){
    const next = favs.includes(id) ? favs.filter(x=>x!==id) : [...favs,id];
    setFavs(next); localStorage.setItem(LSK_FAVS, JSON.stringify(next));
  }
  function pushHistory(entry){
    const max = isPro ? 1000 : 10;
    const next = [entry, ...history].slice(0,max);
    setHistory(next); localStorage.setItem(LSK_HISTORY, JSON.stringify(next));
  }

  async function analyze(){
    if(!isPro && getCount()>=FREE_LIMIT){ setShowUpgrade(true); return; }
    setLoading(true); setResult(null);

    const parsed = parseDexLink(link);
    let data=null;
    if(parsed?.provider==="dexscreener") data = await fetchDexscreener(parsed.chain, parsed.id);

    const top = data?.pairs?.[0] ?? null;
    const score = scoreFrom(top);
    const res = { parsed, top, score };
    setResult(res); setLoading(false);
    if(!isPro) incCount();

    if(top){
      pushHistory({
        id: top.pairAddress ?? parsed?.id ?? link,
        symbol: `${top?.baseToken?.symbol ?? "?"}/${top?.quoteToken?.symbol ?? "?"}`,
        price: Number(top?.priceUsd ?? 0),
        score: score.total, label: score.label, ts: Date.now(),
        link: `https://dexscreener.com/${top.chainId ?? parsed?.chain}/${top.pairAddress ?? parsed?.id ?? ""}`,
      });
    }
  }

  function copySummary(){
    if(!result?.top) return;
    const p = result.top;
    const s = [
      `Fortunex AI — Analysis`,
      `${p.baseToken?.symbol}/${p.quoteToken?.symbol} • Price $${Number(p.priceUsd ?? 0).toFixed(6)}`,
      `Score: ${result.score.total}/100 (${result.score.label})`,
      `24h Change: ${pct(p.priceChange?.h24)} | Vol24h: $${k(p.volume?.h24)} | Liq: $${k(p.liquidity?.usd)}`,
      `Tx 24h: Buys ${p.txns?.h24?.buys ?? 0} / Sells ${p.txns?.h24?.sells ?? 0}`,
      `Pair: ${p.pairAddress ?? "—"} on ${p.chainId ?? "—"}`,
      `Note: Educational only — not financial advice.`,
    ].join("\n");
    navigator.clipboard?.writeText(s);
    alert("Summary copied to clipboard.");
  }

  const p = result?.top;
  const spark = buildSparkPoints(p?.priceChange);
  const buys = p?.txns?.h24?.buys ?? 0;
  const sells= p?.txns?.h24?.sells ?? 0;
  const totalTx = buys + sells || 1;
  const buyerShare = (buys/totalTx)*100;

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(#0A1A2F,#111)',color:'#fff',fontFamily:'Inter,system-ui,Arial',paddingBottom:40}}>
      {/* Header */}
      <header style={{position:'sticky',top:0,backdropFilter:'blur(4px)',borderBottom:'1px solid #D4AF37',background:'#0A1A2Fcc',zIndex:10}}>
        <div style={{maxWidth:900,margin:'0 auto',padding:12,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,borderRadius:20,background:'linear-gradient(135deg,#D4AF37,#2E86DE)',display:'grid',placeItems:'center',color:'#000',fontWeight:800}}>F</div>
            <div>
              <div style={{fontWeight:700,letterSpacing:1}}>FORTUNEX AI</div>
              <div style={{fontSize:12,color:'#D4AF37'}}>Intelligent • Educational Analysis</div>
            </div>
          </div>
          <a href="#" onClick={(e)=>{e.preventDefault();setShowUpgrade(true);}} style={{fontSize:12,color:'#D4AF37',textDecoration:'underline'}}>Pricing</a>
        </div>
      </header>

      {/* Main */}
      <main style={{maxWidth:900,margin:'0 auto',padding:12,display:'grid',gap:12}}>
        {/* Input Card */}
        <div style={{background:'#0A1A2F',border:'1px solid #D4AF3755',borderRadius:16,padding:16}}>
