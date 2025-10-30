import React, { useEffect, useMemo, useState } from "react";

/* =============================
   PRICING (replace with Stripe links later)
   ============================= */
const CHECKOUT = {
  MONTHLY: "#monthly", // put your Stripe payment link here
  ANNUAL: "#annual",   // put your Stripe payment link here
  LIFETIME: "#lifetime"// put your Stripe payment link here
};

/* =============================
   UTIL — parse user input
   accepts: dexscreener link, token address, or name
   ============================= */
function parseDexInput(raw) {
  const txt = (raw || "").trim();
  if (!txt) return null;

  // direct dexscreener link -> grab query part after last '/'
  try {
    if (txt.includes("dexscreener.com")) {
      const u = new URL(txt);
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      return last || txt;
    }
  } catch {
    /* fall through */
  }

  // token address or name
  return txt;
}

/* =============================
   API — Dexscreener
   ============================= */
async function fetchDex(query) {
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(
    query
  )}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Dexscreener unavailable");
  const j = await r.json();
  const pair = (j.pairs && j.pairs[0]) || null;
  return pair;
}

/* =============================
   SCORING + EXPLANATION
   ============================= */
function toNum(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function computeScore(pair) {
  if (!pair) return { score: 0, label: "Neutral", bars: { stab: 0, grow: 0, mom: 0 }, bullets: [] };

  const liq = toNum(pair.liquidity?.usd, 0);
  const vol24 = toNum(pair.volume?.h24, 0);
  const buys24 = toNum(pair.txns?.h24?.buys, 0);
  const sells24 = toNum(pair.txns?.h24?.sells, 0);
  const pc1 = toNum(pair.priceChange?.h1, 0);
  const pc6 = toNum(pair.priceChange?.h6, 0);
  const pc24 = toNum(pair.priceChange?.h24, 0);
  const buyerShare = buys24 + sells24 > 0 ? (buys24 / (buys24 + sells24)) * 100 : 0;

  // normalize roughly 0–10
  const stability =
    Math.min(10, (liq / 500000) * 10) * 0.6 + Math.min(10, (vol24 / 250000) * 10) * 0.4;

  const growth =
    Math.min(10, Math.max(0, (pc24 + 25) / 5)) * 0.7 +
    Math.min(10, Math.max(0, (pc6 + 15) / 3)) * 0.3;

  const momentum =
    Math.min(10, Math.max(0, (pc1 + 10) / 2)) * 0.6 +
    Math.min(10, Math.max(0, buyerShare / 10)) * 0.4;

  // weighted fortune score
  const score = Math.round(stability * 3.5 + growth * 4 + momentum * 2.5);

  const label =
    score >= 70 ? "Bullish"
      : score <= 35 ? "Bearish"
      : "Neutral";

  // explanations
  const bullets = [];
  if (liq >= 100000) bullets.push("Healthy liquidity provides better entry/exit.");
  else if (liq > 0) bullets.push("Low liquidity — price can move fast and slip.");
  if (vol24 >= 100000) bullets.push("Good trading activity in the last 24h.");
  if (buyerShare >= 55) bullets.push("Buyers dominate recent flow (>55%).");
  if (pc24 >= 20) bullets.push("Strong 24h growth — watch for continuation or pullback.");
  if (pc24 <= -20) bullets.push("Significant 24h drawdown — risk elevated.");
  if (bullets.length === 0) bullets.push("Mixed signals — consider waiting for confirmation.");

  return {
    score: Math.max(0, Math.min(100, score)),
    label,
    bars: {
      stab: Number(stability.toFixed(1)),
      grow: Number(growth.toFixed(1)),
      mom: Number(momentum.toFixed(1))
    },
    bullets,
    buyerShare: Number(buyerShare.toFixed(1)),
    changes: { pc1, pc6, pc24 }
  };
}

/* =============================
   LOCAL STORAGE helpers
   ============================= */
const LS = {
  dailyKey: () => `fx-free-${new Date().toISOString().slice(0,10)}`
};

function useDailyQuota(freePerDay = 2) {
  const [left, setLeft] = useState(freePerDay);
  useEffect(() => {
    const k = LS.dailyKey();
    const saved = localStorage.getItem(k);
    setLeft(saved == null ? freePerDay : Math.max(0, Number(saved)));
  }, [freePerDay]);

  const consume = () => {
    const k = LS.dailyKey();
    const n = Math.max(0, Number(localStorage.getItem(k) ?? left) - 1);
    localStorage.setItem(k, String(n));
    setLeft(n);
  };
  return { left, consume };
}

/* =============================
   MAIN COMPONENT
   ============================= */
export default function App() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pair, setPair] = useState(null);
  const [error, setError] = useState("");

  const quota = useDailyQuota(2);
  const result = useMemo(() => computeScore(pair), [pair]);

  // simple “trial” banner — 3 days from first visit
  const [trialLeft, setTrialLeft] = useState(3);
  useEffect(() => {
    const k = "fx-trial-start";
    const now = Date.now();
    let start = Number(localStorage.getItem(k));
    if (!start) { start = now; localStorage.setItem(k, String(now)); }
    const days = Math.max(0, 3 - Math.floor((now - start) / (1000*60*60*24)));
    setTrialLeft(days);
  }, []);

  async function handleAnalyze() {
    setError("");
    if (quota.left <= 0) { setError("Free limit reached for today."); return; }

    const q = parseDexInput(input);
    if (!q) { setError("Paste a valid DEX link / address / name."); return; }

    try {
      setLoading(true);
      const p = await fetchDex(q);
      if (!p) throw new Error("No results found.");
      setPair(p);
      quota.consume();
    } catch (e) {
      setError(e.message || "Failed to fetch.");
    } finally {
      setLoading(false);
    }
  }

  // share code for referrals
  const myCode = useMemo(() => {
    let code = localStorage.getItem("fx-ref-code");
    if (!code) {
      code = Math.random().toString(36).slice(2, 7).toUpperCase();
      localStorage.setItem("fx-ref-code", code);
    }
    return code;
  }, []);
  const shareLink = `${location.origin}/?ref=${myCode}`;

  return (
    <div className="container">
      {/* top nav (sticky spacing handled by CSS container) */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <div className="badge" style={{fontWeight:900, background:"#0b1530", color:"#C9E7FF"}}>F</div>
          <div style={{fontWeight:900}}>FORTUNEX AI</div>
        </div>
        <div style={{display:"flex",gap:18,alignItems:"center"}}>
          <a href="./" aria-label="Home">Home</a>
          <a href="./terms.html">Terms</a>
          <a href="./privacy.html">Privacy</a>
          <a href="#pricing" style={{color:"#FDE68A",fontWeight:800}}>Pricing</a>
        </div>
      </div>

      {/* trial banner */}
      {trialLeft > 0 && (
        <div className="card" style={{padding:12, marginBottom:12}}>
          <span className="badge">Trial</span>{" "}
          You have <b>{trialLeft} {trialLeft === 1 ? "day" : "days"}</b> left. Full features — no card required.
        </div>
      )}

      {/* main grid */}
      <div className="grid-2">
        {/* LEFT — input + result */}
        <div className="card" style={{padding:16}}>
          <div className="section" style={{marginBottom:12}}>
            <div style={{fontWeight:800, marginBottom:8}}>Paste DEX link / address / name</div>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://dexscreener.com/..."
            />
            <div style={{display:"flex",alignItems:"center",gap:10, marginTop:10}}>
              <button className="btn" onClick={handleAnalyze} disabled={loading}>
                {loading ? "Analyzing..." : "Analyze"}
              </button>
              <div className="badge">Free uses today: {Math.max(0, quota.left)} / 2</div>
            </div>
            {error && <div style={{color:"#FCA5A5", marginTop:8}}>{error}</div>}
          </div>

          {/* RESULT */}
          {pair && (
            <div className="section">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span className="badge" style={{
                    background: result.label === "Bullish" ? "#0c2b16" : result.label === "Bearish" ? "#2b0c0c" : "#0c162b",
                    color: result.label === "Bullish" ? "#86efac" : result.label === "Bearish" ? "#fca5a5" : "#93c5fd"
                  }}>{result.label}</span>
                  <div style={{fontWeight:900}}>Fortune Score: {result.score}/100</div>
                </div>
                <a href={pair.url} target="_blank" rel="noreferrer">View on Dexscreener</a>
              </div>

              {/* bars */}
              <div className="card" style={{padding:12, marginTop:12}}>
                <div style={{fontWeight:800, marginBottom:8}}>
                  {pair.baseToken?.symbol}/{pair.quoteToken?.symbol} • Buyer Share {result.buyerShare || 0}%
                </div>
                {[
                  ["Stability", result.bars.stab],
                  ["Growth", result.bars.grow],
                  ["Momentum", result.bars.mom]
                ].map(([label, val]) => (
                  <div key={label} style={{margin:"8px 0"}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#9CA3AF"}}>
                      <span>{label}</span><span>{val}/10</span>
                    </div>
                    <div style={{height:10, background:"#0A1326", border:"1px solid #1E2A44", borderRadius:8}}>
                      <div style={{
                        width:`${Math.min(100, (val/10)*100)}%`,
                        height:"100%",
                        borderRadius:8,
                        background:"linear-gradient(90deg, #60A5FA, #22C55E)"
                      }}/>
                    </div>
                  </div>
                ))}
              </div>

              {/* deltas & metrics */}
              <div className="grid-2" style={{marginTop:12}}>
                <div className="card" style={{padding:12}}>
                  <div style={{fontWeight:800, marginBottom:8}}>Changes</div>
                  <div>1h: {result.changes.pc1}% • 6h: {result.changes.pc6}% • 24h: {result.changes.pc24}%</div>
                </div>
                <div className="card" style={{padding:12}}>
                  <div style={{fontWeight:800, marginBottom:8}}>Market</div>
                  <div>Price: {pair.priceUsd ? `$${Number(pair.priceUsd).toFixed(6)}` : "—"}</div>
                  <div>Liquidity: ${toNum(pair.liquidity?.usd).toLocaleString()}</div>
                  <div>Vol 24h: ${toNum(pair.volume?.h24).toLocaleString()}</div>
                  <div>Tx 24h: {toNum(pair.txns?.h24?.buys)} buys / {toNum(pair.txns?.h24?.sells)} sells</div>
                </div>
              </div>

              {/* explanations */}
              <div className="card" style={{padding:12, marginTop:12}}>
                <div style={{fontWeight:900, marginBottom:8}}>AI Insight</div>
                <ul style={{margin:"6px 0 0 16px"}}>
                  {result.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
                <div style={{marginTop:10, color:"#93A3B5", fontSize:13}}>
                  Educational insights only — Not financial advice.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — watchlist + invite + pricing */}
        <div className="card" style={{padding:16}}>
          <div className="section">
            <div style={{fontWeight:900, marginBottom:6}}>Watchlist</div>
            <div style={{color:"#9CA3AF"}}>No saved pairs yet.</div>
          </div>

          <div className="section">
            <div style={{fontWeight:900, marginBottom:6}}>Invite & Earn</div>
            <div style={{color:"#9CA3AF", marginBottom:8}}>
              Share your link — We append your code to Stripe as <code>client_reference_id</code>.
            </div>
            <input value={shareLink} readOnly onFocus={(e)=>e.target.select()} />
            <div style={{marginTop:8, fontSize:13}}>Your code: <b>{myCode}</b></div>
          </div>

          <div id="pricing" className="section">
            <div style={{fontWeight:900, marginBottom:10}}>Upgrade • Unlock unlimited analyses</div>

            <div className="pricing-block" style={{marginBottom:12}}>
              <div style={{fontWeight:900}}>Pro Monthly</div>
              <div className="price">€7.10</div>
              <a className="btn" href={CHECKOUT.MONTHLY}>Start Monthly</a>
            </div>

            <div className="pricing-block" style={{marginBottom:12}}>
              <div style={{fontWeight:900}}>Pro Annual</div>
              <div className="price">€71.00</div>
              <a className="btn" href={CHECKOUT.ANNUAL}>Start Annual</a>
            </div>

            <div className="pricing-block">
              <div style={{fontWeight:900}}>Lifetime</div>
              <div className="price">€107.00</div>
              <a className="btn" href={CHECKOUT.LIFETIME}>Buy Lifetime</a>
            </div>

            <div style={{marginTop:10, color:"#93A3B5", fontSize:12}}>
              Educational tool — not financial advice.
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div style={{textAlign:"center", color:"#9CA3AF", margin:"14px 0 8px"}}>
        © {new Date().getFullYear()} Fortunex AI • Educational insights only.
      </div>
    </div>
  );
}
