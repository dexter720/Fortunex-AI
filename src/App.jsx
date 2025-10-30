import React, { useEffect, useMemo, useState } from "react";

/** ========== CONFIG (edit these when you add Stripe) ========== */
const STRIPE_MONTHLY = "https://buy.stripe.com/your-monthly-link";
const STRIPE_ANNUAL  = "https://buy.stripe.com/your-annual-link";
const STRIPE_LIFE    = "https://buy.stripe.com/your-lifetime-link";
/** ============================================================= */

const TRIAL_DAYS = 3;
const FREE_USES_PER_DAY = 2;

/* Helpers */
const fmt = (n, d = 2) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
};
const todayKey = () => new Date().toISOString().slice(0, 10);
const getParam = (k) => new URLSearchParams(window.location.search).get(k) || "";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* Dex link parsing */
function parseInput(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // If it's a full Dexscreener link
  try {
    const u = new URL(s);
    if (u.hostname.includes("dexscreener.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      // /solana/<pairAddress> OR /<chain>/<pairAddress>
      if (parts.length >= 2) return { chain: parts[0], pair: parts[1] };
    }
  } catch (_) {}

  // If it's a bare address, assume Solana pair (common for your use-case)
  if (/^[A-Za-z0-9]{20,60}$/.test(s)) return { chain: "solana", pair: s };

  return null;
}

export default function App() {
  const [raw, setRaw] = useState("");
  const [freeLeft, setFreeLeft] = useState(FREE_USES_PER_DAY);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // --- Referral code (stable per browser) ---
  const myRef = useMemo(() => {
    let code = localStorage.getItem("fx_ref");
    if (!code) {
      // 5-char base36 code
      code = Math.random().toString(36).slice(2, 7).toUpperCase();
      localStorage.setItem("fx_ref", code);
    }
    return code;
  }, []);

  // --- If user came through a referral, store it ---
  useEffect(() => {
    const ref = getParam("ref");
    if (ref) localStorage.setItem("fx_referredBy", ref);
  }, []);

  // --- Trial state & free uses tally ---
  const trial = useMemo(() => {
    let start = localStorage.getItem("fx_trial_start");
    if (!start) {
      start = Date.now().toString();
      localStorage.setItem("fx_trial_start", start);
    }
    const days = Math.floor((Date.now() - Number(start)) / 86400000);
    return { daysUsed: days, daysLeft: Math.max(0, TRIAL_DAYS - days) };
  }, []);

  useEffect(() => {
    const k = "fx_free_" + todayKey();
    const used = Number(localStorage.getItem(k) || "0");
    setFreeLeft(Math.max(0, FREE_USES_PER_DAY - used));
  }, []);

  function consumeFreeUse() {
    const k = "fx_free_" + todayKey();
    const used = Number(localStorage.getItem(k) || "0") + 1;
    localStorage.setItem(k, String(used));
    setFreeLeft(Math.max(0, FREE_USES_PER_DAY - used));
  }

  // --- Main analyze ---
  async function onAnalyze() {
    setErr("");
    setAnalysis(null);

    const parsed = parseInput(raw);
    if (!parsed) {
      setErr("Please paste a valid Dexscreener pair URL or contract/pair address.");
      return;
    }
    if (freeLeft <= 0) {
      setErr("You’ve used your free analyses for today. Upgrade for unlimited access.");
      return;
    }

    setLoading(true);
    try {
      const url = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(
        parsed.chain
      )}/${encodeURIComponent(parsed.pair)}`;

      const r = await fetch(url);
      if (!r.ok) throw new Error("Dexscreener returned an error.");
      const j = await r.json();

      const p = j?.pairs?.[0];
      if (!p) throw new Error("Pair not found.");

      // Compute a simple score
      const liquidity = Number(p.liquidity?.usd || 0);
      const vol24 = Number(p.volume?.h24 || 0);
      const txBuys = Number(p.txns?.h24?.buys || 0);
      const txSells = Number(p.txns?.h24?.sells || 0);
      const buyers = txBuys + txSells ? (txBuys / (txBuys + txSells)) * 100 : 0;

      const stability = clamp(10 - Math.abs(Number(p.priceChange?.h24 || 0)) / 10, 0, 10);
      const growth = clamp(vol24 / (liquidity ? liquidity / 5 : 1), 0, 10);
      const momentum = clamp((buyers - 50) / 5 + 5, 0, 10);
      const fortune = clamp((stability + growth + momentum) / 3, 0, 10);

      const bias = fortune >= 6.7 ? "Bullish" : fortune <= 3.3 ? "Bearish" : "Neutral";

      const explain = [];
      if (liquidity >= 100000) explain.push("Healthy liquidity supports price stability.");
      else if (liquidity >= 20000) explain.push("Moderate liquidity; can still move quickly.");

      if (vol24 > liquidity / 5) explain.push("Strong 24h volume relative to liquidity.");
      if (buyers > 55) explain.push("Buyers dominate recent transactions.");
      if (Math.abs(Number(p.priceChange?.h24 || 0)) < 5)
        explain.push("Controlled volatility over 24h.");

      if (explain.length === 0)
        explain.push("Mixed signals — requires caution and deeper due diligence.");

      setAnalysis({
        name: p.baseToken?.name || p.baseToken?.symbol || "Token",
        pairAddress: p.pairAddress,
        priceUsd: Number(p.priceUsd || 0),
        liquidity,
        vol24,
        tx24: { buys: txBuys, sells: txSells },
        buyersPct: buyers,
        priceChange: p.priceChange || {},
        pooled: p.liquidity || {},
        createdAt: p.pairCreatedAt || null,
        fortune,
        stability,
        growth,
        momentum,
        bias,
        explain,
        link: p.url,
        chain: parsed.chain
      });

      consumeFreeUse();
    } catch (e) {
      setErr(e.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  // --- Invite link that carries your ref code ---
  const inviteLink = useMemo(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("ref", myRef);
    return u.toString();
  }, [myRef]);

  // --- Pricing links append ref for Stripe client_reference_id ---
  const refSuffix = `?client_reference_id=${myRef}${getParam("ref") ? `&referred_by=${getParam("ref")}` : ""}`;
  const payMonthly = STRIPE_MONTHLY + refSuffix;
  const payAnnual  = STRIPE_ANNUAL  + refSuffix;
  const payLife    = STRIPE_LIFE    + refSuffix;

  return (
    <>
      {/* Sticky top header */}
      <div className="header-bar">
        <div className="container">
          <div className="nav">
            <div className="brand">
              <div className="brand-badge">F</div>
              <div>FORTUNEX&nbsp;AI</div>
            </div>
            <div className="gap-8" style={{flexWrap:"wrap"}}>
              <a href="/" className="badge">Home</a>
              <a href="/terms.html" className="badge">Terms</a>
              <a href="/privacy.html" className="badge">Privacy</a>
              <a href="/#pricing" className="badge">Pricing</a>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        {/* Trial banner */}
        {trial.daysLeft > 0 && (
          <div className="banner card">
            <strong className="badge warn" style={{marginRight:8}}>Trial</strong>
            You have <strong>{trial.daysLeft} {trial.daysLeft === 1 ? "day" : "days"}</strong> left. Full features — no card required.
          </div>
        )}

        {/* Two columns */}
        <div className="grid-2 mt-16">
          {/* LEFT: Input + results */}
          <div className="card">
            <div className="h1">Paste DEX link / address / name</div>
            <div className="gap-8">
              <input
                placeholder="https://dexscreener.com/solana/<pair> or pair address"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
              <button className="btn" onClick={onAnalyze} disabled={loading}>
                {loading ? "Analyzing…" : "Analyze"}
              </button>
              <div className="pill">Free uses today: {freeLeft} / {FREE_USES_PER_DAY}</div>
            </div>

            {err && <div className="badge warn mt-12">{err}</div>}

            {analysis && (
              <div className="mt-16">
                <div className="h2">
                  {analysis.name}{" "}
                  <span className={`badge ${analysis.bias === "Bullish" ? "ok" : analysis.bias === "Bearish" ? "warn" : ""}`}>
                    {analysis.bias}
                  </span>
                </div>

                {/* Bars */}
                <div className="mt-12">
                  <div className="small">Fortune Score: {fmt(analysis.fortune,1)}/10</div>
                  <div className="small">Stability: {fmt(analysis.stability,1)}/10 • Growth: {fmt(analysis.growth,1)}/10 • Momentum: {fmt(analysis.momentum,1)}/10</div>
                </div>

                {/* Key stats */}
                <div className="grid-2 mt-12" style={{gap:12}}>
                  <div className="card"><div className="small">Price</div><div className="price">${fmt(analysis.priceUsd,6)}</div></div>
                  <div className="card"><div className="small">Liquidity</div><div className="price">${fmt(analysis.liquidity,0)}</div></div>
                  <div className="card"><div className="small">Vol 24h</div><div className="price">${fmt(analysis.vol24,0)}</div></div>
                  <div className="card"><div className="small">Tx 24h</div><div className="price">{fmt(analysis.tx24.buys,0)} buys / {fmt(analysis.tx24.sells,0)} sells</div></div>
                </div>

                {/* Explanations */}
                <div className="card mt-12">
                  <div className="h2">AI Insight</div>
                  <ul style={{margin:"8px 0 0 18px"}}>
                    {analysis.explain.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                  <div className="mt-12">
                    <a href={analysis.link} className="btn secondary" target="_blank" rel="noreferrer">View on Dexscreener</a>
                  </div>
                  <div className="note mt-12">Educational insights only — not financial advice.</div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Watchlist + Invite + Pricing */}
          <div className="card">
            <div className="h1">Watchlist</div>
            <div className="note">No saved pairs yet.</div>

            <div className="h1 mt-16">Invite & Earn</div>
            <div className="note">
              Share your link — we append your code to Stripe as <code>client_reference_id</code>.
            </div>
            <input className="mt-8" readOnly value={inviteLink} onFocus={(e)=>e.target.select()} />
            <div className="small mt-8">Your code: <strong>{myRef}</strong> • Referred by: {localStorage.getItem("fx_referredBy") || "—"}</div>

            <div id="pricing" className="h1 mt-16">Upgrade • Unlock unlimited analyses</div>

            <div className="pricing-block">
              <div className="h2">Pro Monthly</div>
              <div className="price">€7.10</div>
              <a className="btn mt-8" href={payMonthly}>Start Monthly</a>
            </div>

            <div className="pricing-block">
              <div className="h2">Pro Annual</div>
              <div className="price">€71.00</div>
              <a className="btn mt-8" href={payAnnual}>Start Annual</a>
            </div>

            <div className="pricing-block">
              <div className="h2">Lifetime</div>
              <div className="price">€107.00</div>
              <a className="btn mt-8" href={payLife}>Buy Lifetime</a>
            </div>

            <div className="note mt-12">Educational tool — not financial advice.</div>
          </div>
        </div>

        <div className="footer center mt-20">
          © {new Date().getFullYear()} Fortunex AI • Educational insights only.
        </div>
      </div>
    </>
  );
}
