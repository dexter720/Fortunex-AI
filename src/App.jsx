import React, { useEffect, useMemo, useState } from "react";

// =========================
// Stripe checkout (TEST)
// Replace with LIVE later
// =========================
const STRIPE_MONTHLY = "https://buy.stripe.com/test_aFa3cx2oGfeS4Xp49hgjC02";
const STRIPE_ANNUAL  = "https://buy.stripe.com/test_bJe14p7J0aYC89B49hgjC01";
const STRIPE_LIFE    = "https://buy.stripe.com/test_14A5kF6EWd6K2PhcFNgjC00";

// Dexscreener API
const DS_API = "https://api.dexscreener.com/latest/dex";

// --- simple helpers ---
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function pct(n) { return (n == null || isNaN(n)) ? "—" : `${Number(n).toFixed(2)}%`; }
function money(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000) return "$" + (n/1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return "$" + (n/1_000).toFixed(2) + "k";
  return "$" + Number(n).toFixed(2);
}
function shortAddr(a="") { return a.length > 10 ? a.slice(0,4) + "…" + a.slice(-4) : a; }

function parseDexInput(raw) {
  const t = raw.trim();
  try {
    // If full URL from Dexscreener, TradingView, etc.
    const u = new URL(t);
    // Dexscreener: /<chain>/<pairAddress>
    if (u.hostname.includes("dexscreener")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const chain = parts[0];
      const pair  = parts[1];
      if (chain && pair) return { type: "pair", query: `${chain}/${pair}` };
    }
    // If they paste a straight address, treat as search query
    return { type: "search", query: t };
  } catch {
    // Not a URL – could be symbol or address
    return { type: "search", query: t };
  }
}

function scoreFromPair(p) {
  // Dumb-but-useful composite score, 0..100
  const priceChange24h = Number(p.priceChange?.h24 ?? 0);
  const txBuys24 = Number(p.txns?.h24?.buys ?? 0);
  const txSells24 = Number(p.txns?.h24?.sells ?? 0);
  const buyersShare = txBuys24 + txSells24 > 0 ? (txBuys24 / (txBuys24 + txSells24)) : 0;
  const liq = Number(p.liquidity?.usd ?? 0);
  const vol = Number(p.volume?.h24 ?? 0);

  const growth = clamp((priceChange24h + 100) / 2, 0, 100); // (-100..+100) -> 0..100
  const stability = clamp( (liq > 0 ? Math.log10(liq)/6*100 : 0), 0, 100); // ~0..100 as liq grows
  const momentum = clamp( (vol > 0 ? Math.log10(vol)/6*100 : 0), 0, 100);

  const buyerShare100 = Math.round(buyersShare * 100);

  const fortune = clamp(
    0.45*growth + 0.35*stability + 0.20*momentum,
    0, 100
  );

  // Label from score
  let label = "Neutral";
  if (fortune >= 67) label = "Bullish";
  else if (fortune <= 33) label = "Bearish";

  return {
    label,
    fortune: Math.round(fortune),
    subscores: {
      growth: Number((growth/10).toFixed(1)),
      stability: Number((stability/10).toFixed(1)),
      momentum: Number((momentum/10).toFixed(1)),
    },
    buyerShare100
  };
}

function buildAIInsight(p, scored) {
  const lines = [];
  const ch1 = p.priceChange?.h1, ch6 = p.priceChange?.h6, ch24 = p.priceChange?.h24;
  const liq = Number(p.liquidity?.usd ?? 0);
  const vol24 = Number(p.volume?.h24 ?? 0);
  const buys = Number(p.txns?.h24?.buys ?? 0);
  const sells = Number(p.txns?.h24?.sells ?? 0);
  const buyerShare = scored.buyerShare100;

  if (liq < 10_000) lines.push("Low liquidity — price can move fast and slippage is likely.");
  if (vol24 > 50_000) lines.push("Healthy trading activity in the last 24h.");
  if (buyerShare >= 55) lines.push("Buyers dominate recent flow (≥55%).");
  if (ch24 && ch24 > 20) lines.push("Strong 24h growth — watch for continuation or pullback.");
  if (ch1 && ch1 < -5 && ch24 && ch24 > 0) lines.push("Short-term dip within a larger uptrend — potential buy-the-dip zone.");
  if (buys + sells < 50) lines.push("Very low transaction count — consider waiting for more market confirmation.");
  if (lines.length === 0) lines.push("Mixed signals — consider waiting for clearer trend or confirmation levels.");

  return lines;
}

export default function App() {
  // ---- UI state
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pair, setPair] = useState(null);
  const [error, setError] = useState("");
  const [freeLeft, setFreeLeft] = useState(2);
  const [watch, setWatch] = useState([]);

  // restore watchlist & freeLeft from localStorage
  useEffect(() => {
    try {
      const w = JSON.parse(localStorage.getItem("fx_watch") || "[]");
      setWatch(Array.isArray(w) ? w : []);
      const d = new Date().toDateString();
      const rec = JSON.parse(localStorage.getItem("fx_quota") || "{}");
      if (rec.date !== d) {
        localStorage.setItem("fx_quota", JSON.stringify({ date: d, left: 2 }));
        setFreeLeft(2);
      } else {
        setFreeLeft(Number(rec.left ?? 2));
      }
    } catch (e) {}
  }, []);

  const saveQuota = (n) => {
    setFreeLeft(n);
    localStorage.setItem("fx_quota", JSON.stringify({ date: new Date().toDateString(), left: n }));
  };

  const analyze = async () => {
    setError("");
    setPair(null);

    // simple free gate
    if (freeLeft <= 0) {
      setError("Free limit reached. Upgrade to unlock unlimited daily analyses.");
      return;
    }

    const parsed = parseDexInput(input);
    if (!parsed.query) {
      setError("Paste a DEX link, address or token name.");
      return;
    }

    setLoading(true);
    try {
      let url;
      if (parsed.type === "pair" || parsed.query.includes("/")) {
        // Direct pair
        url = `${DS_API}/pairs/${parsed.query}`;
      } else {
        // Search
        url = `${DS_API}/search?q=${encodeURIComponent(parsed.query)}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("API error");
      const data = await res.json();

      let found = null;
      if (data.pairs && data.pairs.length) found = data.pairs[0];
      if (data.pair) found = data.pair;

      if (!found) throw new Error("No data found. Try a specific pair URL from Dexscreener.");

      setPair(found);
      saveQuota(freeLeft - 1);
    } catch (e) {
      setError(e.message || "Could not fetch pair.");
    } finally {
      setLoading(false);
    }
  };

  const scored = useMemo(() => pair ? scoreFromPair(pair) : null, [pair]);
  const insights = useMemo(() => pair && scored ? buildAIInsight(pair, scored) : [], [pair, scored]);

  // referral snippet (Invite & Earn)
  const refCode = useMemo(() => {
    // quick 5-char code
    return (Math.random().toString(36).slice(2,7)).toUpperCase();
  }, []);
  const referLink = useMemo(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("ref", refCode);
    return u.toString();
  }, [refCode]);

  const addWatch = () => {
    if (!pair) return;
    const item = {
      addr: pair.pairAddress || pair.baseToken?.address || "",
      name: pair.baseToken?.name || pair.baseToken?.symbol || "Token",
      chain: pair.chainId || pair.chain || "",
    };
    const next = [item, ...watch.filter(x => x.addr !== item.addr)].slice(0, 20);
    setWatch(next);
    localStorage.setItem("fx_watch", JSON.stringify(next));
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="topbar">
        <div className="logo">
          <div className="badge">F</div>
          <div>
            <div className="title">FORTUNEX AI</div>
            <div className="subtitle">Token Intelligence Dashboard</div>
          </div>
        </div>
        <nav className="nav">
          <a href="#" onClick={(e)=>{e.preventDefault(); window.location.href="/";}}>Home</a>
          <a href="/terms" onClick={(e)=>{e.preventDefault(); window.location.href="/terms";}}>Terms</a>
          <a href="/privacy" onClick={(e)=>{e.preventDefault(); window.location.href="/privacy";}}>Privacy</a>
          <a href="#pricing" className="highlight">Pricing</a>
        </nav>
      </header>

      {/* NO trial banner — we rely on free 2/day gate */}

      {/* Main grid */}
      <div className="grid-2">
        {/* Left: Input & Result */}
        <div className="card">
          <div className="card-title">Paste DEX link / address / name</div>
          <div className="inputRow">
            <input
              value={input}
              onChange={(e)=>setInput(e.target.value)}
              placeholder="https://dexscreener.com/solana/<pair>  or  0x...  or  TOKEN"
            />
            <button onClick={analyze} disabled={loading}>{loading ? "Analyzing…" : "Analyze"}</button>
            <span className="pill">Free uses today: {freeLeft} / 2</span>
          </div>

          {error && <div className="error">{error}</div>}

          {pair && scored && (
            <div className="result">
              <div className="row">
                <span className={`badge-${scored.label.toLowerCase()}`}>{scored.label}</span>
                <span className="muted">Fortune Score:</span>
                <b>{scored.fortune}/100</b>
                <a
                  href={`https://dexscreener.com/${pair.chainId || "solana"}/${pair.pairAddress || ""}`}
                  target="_blank" rel="noreferrer"
                  className="ext"
                >
                  View on Dexscreener
                </a>
              </div>

              <div className="bars">
                <Bar label="Stability" value={scored.subscores.stability}/>
                <Bar label="Growth" value={scored.subscores.growth}/>
                <Bar label="Momentum" value={scored.subscores.momentum}/>
              </div>

              <div className="stats">
                <Stat label="1h / 6h / 24h">
                  {pct(pair.priceChange?.h1)} • {pct(pair.priceChange?.h6)} • {pct(pair.priceChange?.h24)}
                </Stat>
                <Stat label="Price">{pair.priceUsd ? "$"+Number(pair.priceUsd).toFixed(6) : "—"}</Stat>
                <Stat label="Liquidity">{money(pair.liquidity?.usd)}</Stat>
                <Stat label="Vol 24h">{money(pair.volume?.h24)}</Stat>
                <Stat label="Tx 24h">
                  {Number(pair.txns?.h24?.buys ?? 0)} buys / {Number(pair.txns?.h24?.sells ?? 0)} sells
                </Stat>
                <Stat label="Buyer Share">{scored.buyerShare100}%</Stat>
                <Stat label="Pair Age">
                  {pair.info?.createdAt ? new Date(pair.info.createdAt).toLocaleDateString() : "—"}
                </Stat>
              </div>

              <div className="ai">
                <div className="aiTitle">AI Insight</div>
                <ul className="aiList">
                  {insights.map((t,i)=><li key={i}>{t}</li>)}
                </ul>
                <div className="disclaimer">Educational insights only — Not financial advice.</div>
              </div>

              <div className="actionsRow">
                <button onClick={addWatch}>Save to Watchlist</button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Watchlist + Invite + Pricing */}
        <div className="stack">
          <div className="card">
            <div className="card-title">Watchlist</div>
            {watch.length === 0 ? (
              <div className="muted">No saved pairs yet.</div>
            ) : (
              <ul className="watch">
                {watch.map((w)=>(
                  <li key={w.addr}>
                    <span className="mono">{shortAddr(w.addr)}</span>
                    <span className="muted">{w.name}</span>
                    <span className="chip">{w.chain}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="card-title">Invite & Earn</div>
            <div className="muted">Share your link — we append your code to Stripe as <code>client_reference_id</code>.</div>
            <div className="copyRow">
              <input value={referLink} readOnly onFocus={(e)=>e.target.select()} />
              <button onClick={()=>{navigator.clipboard.writeText(referLink)}}>Copy</button>
            </div>
            <div className="muted small">Your code: <b>{refCode}</b> • Referred by: —</div>
          </div>

          <div id="pricing" className="card">
            <div className="card-title">Upgrade • Unlock unlimited analyses</div>

            <div className="priceBlock">
              <div className="planTitle">Pro Monthly</div>
              <div className="price">€7.10</div>
              <ul className="feat">
                <li>Unlimited daily analyses</li>
                <li>Full AI explanations</li>
                <li>Save watchlist & notes</li>
              </ul>
              <a className="cta" href={`${STRIPE_MONTHLY}?client_reference_id=${refCode}`} target="_blank" rel="noreferrer">
                Start Monthly
              </a>
            </div>

            <div className="priceBlock">
              <div className="planTitle">Pro Annual</div>
              <div className="price">€71.00</div>
              <ul className="feat">
                <li>All Pro Monthly features</li>
                <li>2 months free vs monthly</li>
                <li>Priority email support</li>
              </ul>
              <a className="cta" href={`${STRIPE_ANNUAL}?client_reference_id=${refCode}`} target="_blank" rel="noreferrer">
                Start Annual
              </a>
            </div>

            <div className="priceBlock">
              <div className="planTitle">Lifetime</div>
              <div className="price">€107.00</div>
              <ul className="feat">
                <li>One-time payment</li>
                <li>All future features</li>
                <li>VIP badge</li>
              </ul>
              <a className="cta" href={`${STRIPE_LIFE}?client_reference_id=${refCode}`} target="_blank" rel="noreferrer">
                Buy Lifetime
              </a>
            </div>

            <div className="muted small">Educational tool — not financial advice.</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="footer">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/">Home</a>
        <span className="muted">© 2025 Fortunex AI</span>
      </footer>
    </div>
  );
}

// ====== small presentational bits ======
function Bar({label, value}) {
  const pct = clamp(value*10, 0, 100);
  return (
    <div className="bar">
      <div className="barTop">
        <span>{label}</span>
        <b>{value}/10</b>
      </div>
      <div className="track"><div className="fill" style={{width: pct + "%"}}/></div>
    </div>
  );
}
function Stat({label, children}) {
  return (
    <div className="stat">
      <div className="muted">{label}</div>
      <div>{children}</div>
    </div>
  );
    }
