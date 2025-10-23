import React from 'react'

// ---- Stripe Payment Links (replace with your real links) ----
// Set each Payment Link Success URL to your deployed URL with ?pro=1
export const STRIPE_PRO_LINK   = "https://buy.stripe.com/test_XXXXXXXXXXXXpro";
export const STRIPE_ELITE_LINK = "https://buy.stripe.com/test_XXXXXXXXXXXXelite";

// ---- Helpers ----
const DS_API = "https://api.dexscreener.com/latest/dex/";
function parseDexLink(raw){
  try{
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    if (host.includes('dexscreener.com') && parts.length >= 2){
      return { provider: 'dexscreener', chain: parts[0], id: parts[1] };
    }
    return { provider: 'unknown', id: raw };
  }catch{ return null; }
}
async function fetchDexscreener(chain, id){
  const urls = [`${DS_API}pairs/${chain}/${id}`, `${DS_API}tokens/${id}`];
  for (const u of urls){
    try{
      const r = await fetch(u);
      if (!r.ok) continue;
      const d = await r.json();
      if (d?.pairs?.length) return d;
    }catch{}
  }
  return null;
}
function k(n=0,d=2){
  const x = Number(n)||0;
  if (Math.abs(x)>=1e9) return (x/1e9).toFixed(d)+'B';
  if (Math.abs(x)>=1e6) return (x/1e6).toFixed(d)+'M';
  if (Math.abs(x)>=1e3) return (x/1e3).toFixed(d)+'k';
  return x.toFixed(d);
}

// ---- App ----
export default function FortunexAIApp(){
  const [link, setLink] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [showUpgrade, setShowUpgrade] = React.useState(false);
  const [isPro, setIsPro] = React.useState(()=>{
    try{ return JSON.parse(localStorage.getItem('fx_isPro')||'false'); }catch{ return false; }
  });
  const FREE_LIMIT = 2;

  // auto-upgrade from Stripe
  React.useEffect(()=>{
    const p = new URLSearchParams(window.location.search);
    if (p.get('pro') === '1'){
      localStorage.setItem('fx_isPro','true');
      setIsPro(true);
      const url = window.location.origin + window.location.pathname;
      window.history.replaceState({},'',url);
    }
  },[]);

  function dayKey(){
    const d = new Date();
    return `fx_daily_${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }
  function getCount(){ try{ return parseInt(localStorage.getItem(dayKey())||'0',10)||0; }catch{ return 0; } }
  function incCount(){ const n=getCount()+1; localStorage.setItem(dayKey(), String(n)); }

  async function analyze(){
    if (!isPro && getCount() >= FREE_LIMIT){ setShowUpgrade(true); return; }
    setLoading(true);
    const parsed = parseDexLink(link);
    let data = null;
    if (parsed?.provider === 'dexscreener') data = await fetchDexscreener(parsed.chain, parsed.id);
    const top = data?.pairs?.[0];
    const score = computeScore(top);
    setResult({ parsed, top, score });
    setLoading(false);
    if (!isPro) incCount();
  }

  function computeScore(pair){
    if (!pair) return { total: 50, label: 'Neutral' };
    const liq = pair?.liquidity?.usd ?? 0;
    const vol = pair?.volume?.h24 ?? 0;
    const buys = pair?.txns?.h24?.buys ?? 0;
    const sells = pair?.txns?.h24?.sells ?? 0;
    const ch = pair?.priceChange?.h24 ?? 0;
    const score = Math.min(100, Math.max(0, Math.log10(liq+vol+1)*10 + (buys-sells) + ch));
    const label = score>66?'Bullish':score<33?'Bearish':'Neutral';
    return { total: Math.round(score), label };
  }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(#0A1A2F,#111)',color:'#fff',fontFamily:'Inter,system-ui,Arial',paddingBottom:40}}>
      <header style={{position:'sticky',top:0,backdropFilter:'blur(4px)',borderBottom:'1px solid #D4AF37',background:'#0A1A2Fcc'}}>
        <div style={{maxWidth:800,margin:'0 auto',padding:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,borderRadius:20,background:'linear-gradient(135deg,#D4AF37,#2E86DE)',display:'grid',placeItems:'center',color:'#000',fontWeight:800}}>F</div>
            <div>
              <div style={{fontWeight:700,letterSpacing:1}}>FORTUNEX AI</div>
              <div style={{fontSize:12,color:'#D4AF37'}}>Intelligent • Educational Analysis</div>
            </div>
          </div>
          <a href="#" onClick={e=>{e.preventDefault();setShowUpgrade(true);}} style={{fontSize:12,color:'#D4AF37',textDecoration:'underline'}}>Pricing</a>
        </div>
      </header>

      <main style={{maxWidth:800,margin:'0 auto',padding:16}}>
        <div style={{background:'#0A1A2F',border:'1px solid #D4AF3755',borderRadius:16,padding:16}}>
          <div style={{fontSize:14,marginBottom:8}}>Paste DEX link</div>
          <input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://dexscreener.com/solana/PAIR..." style={{width:'100%',background:'#111',border:'1px solid #D4AF3722',color:'#fff',borderRadius:12,padding:'10px 12px'}}/>
          <div style={{display:'flex',gap:12,alignItems:'center',marginTop:12}}>
            <button onClick={analyze} disabled={loading} style={{background:'linear-gradient(90deg,#D4AF37,#2E86DE)',color:'#000',fontWeight:700,border:'none',padding:'10px 16px',borderRadius:12}}>{loading?'Analyzing...':'Analyze'}</button>
            {!isPro && <div style={{fontSize:12,opacity:.8}}>Free uses today: {Math.min(getCount(),FREE_LIMIT)} / {FREE_LIMIT}</div>}
          </div>
        </div>

        {result && (
          <div style={{background:'#0A1A2F',border:'1px solid #D4AF3755',borderRadius:16,padding:16,marginTop:16}}>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{background:'#D4AF37',color:'#000',fontWeight:700,fontSize:12,borderRadius:8,padding:'2px 8px'}}>{result.score.label}</span>
              <span style={{fontSize:12,color:'#D4AF37cc'}}>Score: {result.score.total}/100</span>
            </div>
            {result.top && (
              <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8,marginTop:12,fontSize:14}}>
                <Stat label="Token" value={result.top?.baseToken?.symbol ?? '?'} />
                <Stat label="Price" value={'$'+Number(result.top?.priceUsd ?? 0).toFixed(6)} />
                <Stat label="Liquidity" value={'$'+k(result.top?.liquidity?.usd)} />
                <Stat label="Vol 24h" value={'$'+k(result.top?.volume?.h24)} />
                <Stat label="Change 24h" value={(result.top?.priceChange?.h24 ?? 0)+'%'} />
              </div>
            )}
            <div style={{marginTop:12,fontSize:12,color:'#D4AF37aa'}}>Educational insights only — Not financial advice.</div>
          </div>
        )}
      </main>

      {showUpgrade && (
        <div style={{position:'fixed',inset:0,display:'grid',placeItems:'center',background:'rgba(0,0,0,.6)',backdropFilter:'blur(2px)'}}>
          <div style={{width:'92%',maxWidth:420,background:'#0A1A2F',border:'1px solid #D4AF37',borderRadius:16,padding:16}}>
            <div style={{textAlign:'center',marginBottom:8}}>
              <div style={{width:48,height:48,margin:'0 auto',borderRadius:24,background:'linear-gradient(135deg,#D4AF37,#2E86DE)',display:'grid',placeItems:'center',color:'#000',fontWeight:800}}>F</div>
            </div>
            <div style={{textAlign:'center',fontWeight:700,fontSize:18}}>You’ve reached your free limit</div>
            <div style={{textAlign:'center',opacity:.85,fontSize:14,marginTop:6}}>You’ve completed {FREE_LIMIT} analyses today. Upgrade to unlock unlimited insights and advanced learning tools.</div>
            <ul style={{marginTop:8,fontSize:14,lineHeight:1.6}}>
              <li>• Unlimited analyses per day</li>
              <li>• Momentum & buyer/seller trends</li>
              <li>• Shareable PDF summaries</li>
            </ul>
            <div style={{display:'grid',gap:8,marginTop:12}}>
              <a href={STRIPE_PRO_LINK} style={{textAlign:'center',borderRadius:12,padding:'10px 12px',fontWeight:700,background:'linear-gradient(90deg,#D4AF37,#2E86DE)',color:'#000'}}>🔓 Upgrade Now — €4.99/mo</a>
              <button onClick={()=>setShowUpgrade(false)} style={{textAlign:'center',borderRadius:12,padding:'10px 12px',fontWeight:700,border:'1px solid #D4AF3788',color:'#D4AF37',background:'transparent'}}>Remind me tomorrow</button>
            </div>
            <div style={{textAlign:'center',marginTop:6,fontSize:12,color:'#D4AF37aa'}}>Educational purpose only — Not financial advice.</div>
          </div>
        </div>
      )}

      <footer style={{textAlign:'center',padding:12,fontSize:12,color:'#D4AF37aa'}}>© {new Date().getFullYear()} Fortunex AI</footer>
    </div>
  )
}

function Stat({label, value}){
  return (
    <div style={{background:'#111',border:'1px solid #D4AF3722',borderRadius:12,padding:10}}>
      <div style={{fontSize:12,color:'#D4AF37cc'}}>{label}</div>
      <div style={{fontWeight:600}}>{value}</div>
    </div>
  )
}
