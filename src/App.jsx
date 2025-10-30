import React, { useEffect, useMemo, useState } from "react";

/** =========================
 *  CONFIG — replace later with real checkout links
 *  ========================= */
const STRIPE = {
  MONTHLY: "https://buy.stripe.com/your-monthly-link",
  ANNUAL:  "https://buy.stripe.com/your-annual-link",
  LIFE:    "https://buy.stripe.com/your-lifetime-link",
};

const TRIAL_DAYS = 3;
const FREE_USES_PER_DAY = 2;

/** =========================
 *  UTIL
 *  ========================= */
const fmt = (n, d = 2) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const todayKey = () => new Date().toISOString().slice(0, 10);
const getParam = (k) => new URLSearchParams(window.location.search).get(k) || "";

/** =========================
 *  ROBUST INPUT PARSER
 *  Accepts: Dexscreener (all variants), Birdeye links, plain address, or token/name
 *  ========================= */
function parseInput(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Bare address / pair / mint (very loose, covers Solana etc.)
  if (/^[A-Za-z0-9]{20,100}$/.test(s)) {
    return { src: "address", chain: null, pair: s, q: s };
  }

  try {
    const u = new URL(s);

    // Dexscreener variants
    if (u.hostname.includes("dexscreener.com")) {
      const parts = u.pathname.split("/").filter(Boolean).map(x => x.toLowerCase());
      // Examples:
      // /solana/<pairAddress>
      // /pairs/solana/<pairAddress>
      // /solana?pairAddress=<pair>
      // /<chain>/<anything-with-extra>
      const qp = u.searchParams.get("pairAddress") || u.searchParams.get("pair") || "";

      const known = ["solana","bsc","ethereum","base","arbitrum","avalanche","polygon","optimism",
                     "fantom","tron","sui","aptos","ton","blast","linea","scroll","cronos","kava",
                     "era","zksync","metis"];
      let chain = null;
      if (parts[0] && known.includes(parts[0])) chain = parts[0];
      if (!chain && parts[1] && known.includes(parts[1])) chain = parts[1];

      // last path segment can be the pair address in many cases
      let lastSeg = parts.length ? parts[parts.length - 1] : "";
      // If path starts with "pairs", next is chain, then pair
      if (parts[0] === "pairs" && parts.length >= 3) lastSeg = parts[2];

      // choose candidate
      let candidate = qp || lastSeg;
      if (!/^[A-Za-z0-9]{20,100}$/.test(candidate)) candidate = "";

      return { src: "dexscreener", chain, pair: candidate || null, q: candidate || s };
    }

    // Birdeye: https://birdeye.so/token/<mint>?chain=solana
    if (u.hostname.includes("birdeye.so")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("token");
      const mint = i >= 0 ? parts[i + 1] : "";
      const chain = (u.searchParams.get("chain") || "solana").toLowerCase();
      if (mint && /^[A-Za-z0-9]{20,100}$/.test(mint)) {
        return { src: "birdeye", chain, pair: mint, q: mint };
      }
      return { src: "birdeye", chain, pair: null, q: s };
    }

    // Any other URL — pass to search
    return { src: "url", chain: null, pair: null, q: s };
  } catch {
    // Not a URL — treat as token/name query
    return { src: "text", chain: null, pair: null, q: s };
  }
}

/** =========================
 *  PAIR RESOLVER
 *  Tries direct pair endpoint first; falls back to search
 *  ========================= */
async function resolvePair(info) {
  // Try fast pair endpoint if we have a candidate
  if (info?.pair) {
    const chain = (info.chain || "solana").toLowerCase();
    try {
      const r = await fetch(
        `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(info.pair)}`
      );
      if (r.ok) {
        const j = await r.json();
        if (j?.pairs?.[0]) return j.pairs[0];
      }
    } catch { /* fallthrough */ }
  }

  // Fallback to search with whatever we have
  const q = info?.pair || info?.q || "";
  if (!q) return null;
  const rs = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
  if (!rs.ok) throw new Error("Dexscreener search unavailable.");
  const js = await rs.json();
  return (js.pairs && js.pairs[0]) || null;
}

/** =========================
 *  SCORING
 *  ========================= */
function buildAnalysis(p) {
  const liquidity = Number(p?.liquidity?.usd || 0);
  const vol24    = Number(p?.volume?.h24 || 0);
  const txBuys   = Number(p?.txns?.h24?.buys || 0);
  const txSells  = Number(p?.txns?.h24?.sells || 0);
  const buyers   = txBuys + txSells ? (txBuys / (txBuys + txSells)) * 100 : 0;

  const pc1  = Number(p?.priceChange?.h1 || 0);
  const pc6  = Number(p?.priceChange?.h6 || 0);
  const pc24 = Number(p?.priceChange?.h24 || 0);

  const stability = clamp(10 - Math.abs(pc24) / 10, 0, 10); // flatter 24h → higher stability
  const growth    = clamp(vol24 / (liquidity ? liquidity / 5 : 1), 0, 10);
  const momentum  = clamp((buyers - 50) / 5 + 5, 0, 10);

  const fortune = clamp((stability + growth + momentum) / 3, 0, 10);
  const bias = fortune >= 6.7 ? "Bullish" : fortune <= 3.3 ? "Bearish" : "Neutral";

  const explain = [];
  if (liquidity >= 100000) explain.push("Healthy liquidity supports price stability.");
  else if (liquidity >= 20000) explain.push("Moderate liquidity; price can move quickly.");
  if (vol24 > liquidity / 5) explain.push("Strong 24h volume relative to liquidity.");
  if (buyers > 55) explain.push("Buyers dominate recent flow.");
  if (Math.abs(pc24) < 5) explain.push("Controlled 24h volatility.");
  if (explain.length === 0) explain.push("Mixed signals — consider waiting for confirmation.");

  return {
    name: p?.baseToken?.name || p?.baseToken?.symbol || "Token",
    pairAddress: p?.pairAddress,
    priceUsd: Number(p?.priceUsd || 0),
    liquidity, vol24,
    tx24: { buys: txBuys, sells: txSells },
    buyersPct: buyers,
    priceChange: p?.priceChange || {},
    pooled: p?.liquidity || {},
    createdAt: p?.pairCreatedAt || null,
    fortune, stability, growth, momentum, bias, explain,
    link: p?.url,
    chain: p?.chainId || null
  };
}

/** =========================
 *  HOOKS — free quota & trial
 *  ========================= */
function useFreeQuota(limitPerDay = FREE_USES_PER_DAY) {
  const [left, setLeft] = useState(limitPerDay);
  useEffect(() => {
    const k = "fx_free_" + todayKey();
    const used = Number(localStorage.getItem(k) || "0");
    setLeft(Math.max(0, limitPerDay - used));
  }, [limitPerDay]);
  const consume = () => {
    const k = "fx_free_" + todayKey();
    const used = Number(localStorage.getItem(k) || "0") + 1;
    localStorage.setItem(k, String(used));
    setLeft(Math.max(0, limitPerDay - used));
  };
  return { left, consume };
}

function useTrial(days = TRIAL_DAYS) {
  const [left, setLeft] = useState(days);
  useEffect(() => {
    let start = localStorage.getItem("fx_trial_start");
    if (!start) { start = String(Date.now()); localStorage.setItem("fx_trial_start", start); }
    const used = Math.floor((Date.now() - Number(start)) / 86400000);
    setLeft(Math.max(0, days - used));
  }, [days]);
  return left;
}

/** =========================
 *  MAIN APP
 *  ========================= */
export default function App() {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [analysis, setAnalysis] = useState(null);

  // quota + trial
  const trialLeft = useTrial(TRIAL_DAYS);
  const quota = useFreeQuota(FREE_USES_PER_DAY);

  // referral code (owner)
  const myRef = useMemo(() => {
    let code = localStorage.getItem("fx_ref");
    if (!code) { code = Math.random().toString(36).slice(2,7).toUpperCase(); localStorage.setItem("fx_ref", code); }
    return code;
  }, []);

  // capture ?ref= on app page as well
  useEffect(() => {
    const ref = getParam("ref");
    if (ref) { try { localStorage.setItem("fx_referredBy", ref); } catch(e){} }
  }, []);

  const inviteLink = useMemo(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("ref", myRef);
    return u.toString();
  }, [myRef]);

  // build Stripe links with metadata
  const refSuffix = `?client_reference_id=${myRef}${getParam("ref") ? `&referred_by=${getParam("ref")}` : ""}`;
  const PAY = {
    MONTHLY: STRIPE.MONTHLY + refSuffix,
    ANNUAL:  STRIPE.ANNUAL  + refSuffix,
    LIFE:    STRIPE.LIFE    + refSuffix
  };

  async function onAnalyze() {
    setErr("");
    setAnalysis(null);

    if (quota.left <= 0) { setErr("Free limit reached for today. Upgrade for unlimited access."); return; }

    const info = parseInput(raw);
    if (!info) { setErr("Paste a Dexscreener/Birdeye link, contract address, or token name."); return; }

    setLoading(true);
    try {
      const pair = await resolvePair(info);
      if (!pair) throw new Error("Couldn’t find that pair. Try another link or paste the address.");

      setAnalysis(buildAnalysis(pair));
      quota.consume();
    } catch (e) {
      setErr(e.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      {/* Top nav */}
      <div className="header-bar card" style={{padding:"10px 14px", marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <div className="brand" style={{display:"flex",alignItems:"center",gap:12,fontWeight:800}}>
            <div className="brand-badge" style={{
              width:36,height:36,borderRadius:11,display:"grid",placeItems:"center",
              background:"linear-gradient(135deg,#69d1ff,#38ef7d)",color:"#0b1728"
            }}>F</div>
            <div>FORTUNEX&nbsp;AI</div>
          </div>
          <div className="gap-8" style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <a className="badge" href="/landing.html">Landing</a>
            <a className="badge" href="/terms.html">Terms</a>
            <a className="badge" href="/privacy.html">Privacy</a>
            <a className="badge" href="#pricing">Pricing</a>
          </div>
        </div>
      </div>

      {/* Trial banner */}
      {trialLeft > 0 && (
        <div className="banner card" style={{marginBottom:14}}>
          <strong className="badge warn" style={{marginRight:8}}>Trial</strong>
          You have <strong>{trialLeft} {trialLeft === 1 ? "day" : "days"}</strong> left. Full features — no card required.
        </div>
      )}

      {/* Main grid */}
      <div className="grid-2">
        {/* LEFT — Input & Result */}
        <div className="card">
          <div className="h1">Paste DEX link / address / name</div>
          <div className="gap-8" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <input
              placeholder="e.g. https://dexscreener.com/solana/<pair> or birdeye.so/token/<mint>?chain=solana"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <button className="btn" onClick={onAnalyze} disabled={loading}>
              {loading ? "Analyzing…" : "Analyze"}
            </button>
            <div className="pill">Free uses today: {quota.left} / {FREE_USES_PER_DAY}</div>
          </div>

          {err && <div className="badge warn" style={{marginTop:12}}>{err}</div>}

          {analysis && (
            <div style={{marginTop:16}}>
              <div className="h2">
                {analysis.name}{" "}
                <span className={`badge ${analysis.bias === "Bullish" ? "ok" : analysis.bias === "Bearish" ? "warn" : ""}`}>
                  {analysis.bias}
                </span>
              </div>

              {/* Score summary */}
              <div className="small" style={{marginTop:6}}>
                Fortune Score: {fmt(analysis.fortune,1)}/10 • Stability {fmt(analysis.stability,1)}/10 • Growth {fmt(analysis.growth,1)}/10 • Momentum {fmt(analysis.momentum,1)}/10
              </div>

              {/* Key stats */}
              <div className="grid-2" style={{gap:12, marginTop:12}}>
                <div className="card">
                  <div className="small">Price</div>
                  <div className="price">${fmt(analysis.priceUsd,6)}</div>
                </div>
                <div className="card">
                  <div className="small">Liquidity</div>
                  <div className="price">${fmt(analysis.liquidity,0)}</div>
                </div>
                <div className="card">
                  <div className="small">Vol 24h</div>
                  <div className="price">${fmt(analysis.vol24,0)}</div>
                </div>
                <div className="card">
                  <div className="small">Tx 24h</div>
                  <div className="price">{fmt(analysis.tx24.buys,0)} buys / {fmt(analysis.tx24.sells,0)} sells</div>
                </div>
              </div>

              {/* Explanations */}
              <div className="card" style={{marginTop:12}}>
                <div className="h2">AI Insight</div>
                <ul style={{margin:"8px 0 0 18px"}}>
                  {analysis.explain.map((x,i)=><li key={i}>{x}</li>)}
                </ul>
                <div className="mt-12">
                  <a className="btn secondary" href={analysis.link} target="_blank" rel="noreferrer">View on Dexscreener</a>
                </div>
                <div className="note mt-12">Educational insights only — not financial advice.</div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Watchlist (placeholder) + Invite + Pricing */}
        <div className="card">
          <div className="h1">Watchlist</div>
          <div className="note">No saved pairs yet.</div>

          <div className="h1" style={{marginTop:16}}>Invite & Earn</div>
          <div className="note">Share your link — we append your code to Stripe as <code>client_reference_id</code>.</div>
          <input className="mt-8" readOnly value={inviteLink} onFocus={(e)=>e.target.select()} />
          <div className="small mt-8">
            Your code: <strong>{myRef}</strong> • Referred by: {localStorage.getItem("fx_referredBy") || "—"}
          </div>

          <div id="pricing" className="h1" style={{marginTop:16}}>Upgrade • Unlock unlimited analyses</div>

          <div className="pricing-block">
            <div className="h2">Pro Monthly</div>
            <div className="price">€7.10</div>
            <a className="btn mt-8" href={STRIPE.MONTHLY ? STRIPE.MONTHLY + `?client_reference_id=${myRef}` : "#"}>Start Monthly</a>
          </div>

          <div className="pricing-block">
            <div className="h2">Pro Annual</div>
            <div className="price">€71.00</div>
            <a className="btn mt-8" href={STRIPE.ANNUAL ? STRIPE.ANNUAL + `?client_reference_id=${myRef}` : "#"}>Start Annual</a>
          </div>

          <div className="pricing-block">
            <div className="h2">Lifetime</div>
            <div className="price">€107.00</div>
            <a className="btn mt-8" href={STRIPE.LIFE ? STRIPE.LIFE + `?client_reference_id=${myRef}` : "#"}>Buy Lifetime</a>
          </div>

          <div className="note mt-12">Educational tool — not financial advice.</div>
        </div>
      </div>

      {/* Footer */}
      <div className="footer center mt-20">
        © {new Date().getFullYear()} Fortunex AI • Educational insights only.
      </div>
    </div>
  );
                                                                                      }
