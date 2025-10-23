import React from "react";

/* =============================
   FORTUNEX AI v3a.1 (Unified Mood)
   - Robust fetch: link / raw address / search
   - AI Insight + Fortune Score (0–100)
   - Sub-scores: Stability / Growth / Momentum (0–10)
   - Buyer/Seller, Liquidity, Volume, Pair Age, Sparkline
   - Mood badge & Raw Score color aligned with AI mood
   - History, Favorites, Copy Summary
   - Free gate (2/day) + Stripe upgrade modal
============================= */

// ---- Stripe Payment Links (replace with your real links) ----
export const STRIPE_PRO_LINK   = "https://buy.stripe.com/test_PRO_LINK";
export const STRIPE_ELITE_LINK = "https://buy.stripe.com/test_ELITE_LINK";

// ---- Dexscreener helpers ----
const DS_API = "https://api.dexscreener.com/latest/dex/";

/** Parse user input: full Dexscreener link, raw address, or search text */
function parseDexInput(raw) {
  try {
    const txt = raw.trim();
    // raw pair/token heuristic
    if (/^[0-9a-zA-Z]{32,}$/.test(txt)) return { kind: "raw", id: txt };

    // try as URL
    const url = new URL(txt);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);

    if (host.includes("dexscreener.com") && parts.length >= 2) {
      // https://dexscreener.com/<chain>/<pair>
      return { kind: "dex", chain: parts[0], id: parts[1] };
    }
    return { kind: "search", q: txt };
  } catch {
    // not a URL → raw or search
    if (/^[0-9a-zA-Z]{32,}$/.test(raw.trim())) return { kind: "raw", id: raw.trim() };
    return { kind: "search", q: raw.trim() };
  }
}

/** Try multiple endpoints until one returns pairs */
async function fetchDexSmart(parsed) {
  const tries = [];

  if (parsed?.kind === "dex") {
    tries.push(`${DS_API}pairs/${parsed.chain}/${parsed.id}`);
  }
  if (parsed?.kind === "raw") {
    tries.push(`${DS_API}tokens/${parsed.id}`);
  }
  // Always add search fallback (works for address, symbol, or pasted text)
  tries.push(`${DS_API}search?q=${encodeURIComponent(parsed?.q || parsed?.id || "")}`);

  for (const u of tries) {
    try {
      const r = await fetch(u, { headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const d = await r.json();
      if (d?.pairs?.length) return d;
    } catch {
      // ignore and continue
    }
  }
  return null;
}

// ---- utils ----
const k = (n = 0, d = 2) => {
  const x = Number(n) || 0;
  if (Math.abs(x) >= 1e9) return (x / 1e9).toFixed(d) + "B";
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(d) + "M";
  if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(d) + "k";
  return x.toFixed(d);
};
const pct = (num) => (num == null ? "—" : `${Number(num).toFixed(2)}%`);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString() : "—");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function scoreFrom(pair) {
  if (!pair) return { total: 50, label: "Neutral" };
  const liq = pair?.liquidity?.usd ?? 0;
  const vol = pair?.volume?.h24 ?? 0;
  const buys = pair?.txns?.h24?.buys ?? 0;
  const sells = pair?.txns?.h24?.sells ?? 0;
  const change = pair?.priceChange?.h24 ?? 0;
  const base = Math.log10(liq + vol + 1) * 10 + (buys - sells) + change;
  const total = Math.round(clamp(base, 0, 100));
  // label no longer used for UI; AI mood is the source of truth
  const label = total > 50 ? "Bullish" : total < 50 ? "Bearish" : "Neutral";
  return { total, label };
}

// AI qualities + insight (local rule-based)
function analyzeQualities(pair) {
  if (!pair) {
    return {
      stability: 5, growth: 5, momentum: 5,
      fortune: 50, mood: "Neutral", buyerShare: 50,
      insight: "No live data found. Try a full Dexscreener link or a known pair address."
    };
  }
  const liq = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const ch1 = Number(pair?.priceChange?.h1 ?? 0);
  const ch6 = Number(pair?.priceChange?.h6 ?? 0);
  const ch24 = Number(pair?.priceChange?.h24 ?? 0);
  const buys = Number(pair?.txns?.h24?.buys ?? 0);
  const sells= Number(pair?.txns?.h24?.sells ?? 0);
  const buyerShare = (buys + sells) ? buys / (buys + sells) : 0.5;

  // 0..10 subs
  let stability = (Math.log10(liq + 1) * 1.6) - (Math.min(Math.abs(ch24), 50) / 25);
  stability = clamp(stability, 0, 10);

  let growth = (Math.log10(vol24 + 1) * 1.6) + (clamp(ch24, -20, 20) / 10);
  growth = clamp(growth, 0, 10);

  const bias = (buyerShare - 0.5) * 20; // -10..+10
  let momentum = 5 + bias * 0.6 + clamp((ch1 + ch6) / 4, -5, 5);
  momentum = clamp(momentum, 0, 10);

  // 0..100 fortune
  const fortune = clamp(
    Math.round((stability * 3 + growth * 3 + momentum * 4) * 2.5),
    0, 100
  );

  const mood = fortune > 75 ? "Bullish" : fortune < 35 ? "Bearish" : "Neutral";

  const reasons = [];
  if (buyerShare > 0.58) reasons.push("strong buyer advantage");
  if (buyerShare < 0.42) reasons.push("seller pressure");
  if (ch24 > 8) reasons.push("solid 24h price gain");
  if (ch24 < -8) reasons.push("24h price weakness");
  if (liq > 500000) reasons.push("healthy liquidity");
  if (vol24 > 300000) reasons.push("active trading volume");
  if (!reasons.length) reasons.push("mixed signals");

  return {
    stability: Math.round(stability * 10) / 10,
    growth: Math.round(growth * 10) / 10,
    momentum: Math.round(momentum * 10) / 10,
    fortune,
    mood,
    buyerShare: Math.round(buyerShare * 1000) / 10,
    insight: `${mood} bias — ${reasons.slice(0, 3).join(", ")}.`
  };
}

function buildSparkPoints(pc = {}) {
  const seq = [
    { t: 0, v: 0 },
    { t: 1, v: Number(pc.h1 ?? 0) },
    { t: 6, v: Number(pc.h6 ?? 0) },
    { t: 24, v: Number(pc.h24 ?? 0) },
  ];
  const ys = seq.map((p) => p.v);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;
  return seq.map((p) => ({ x: (p.t / 24) * 100, y: 100 - ((p.v - min) / range) * 100 }));
}

// Mood color helper (for badge & raw score)
function moodColor(mood) {
  if (mood === "Bullish") return "#2ECC71"; // green
  if (mood === "Bearish") return "#E74C3C"; // red
  return "#F1C40F";                          // gold (Neutral)
}

// ---- storage keys ----
const LSK_PRO = "fx_isPro";
const LSK_DAILY = (d = new Date()) =>
  `fx_daily_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const LSK_HISTORY = "fx_history";
const LSK_FAVS = "fx_favorites";

export default function FortunexAIApp() {
  const [link, setLink] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [showUpgrade, setShowUpgrade] = React.useState(false);
  const [isPro, setIsPro] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(LSK_PRO) || "false"); }
    catch { return false; }
  });
  const [history, setHistory] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(LSK_HISTORY) || "[]"); }
    catch { return []; }
  });
  const [favs, setFavs] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(LSK_FAVS) || "[]"); }
    catch { return []; }
  });

  const FREE_LIMIT = 2;

  // Auto-upgrade from Stripe (?pro=1)
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("pro") === "1") {
      localStorage.setItem(LSK_PRO, "true");
      setIsPro(true);
      const url = window.location.origin + window.location.pathname;
      window.history.replaceState({}, "", url);
    }
  }, []);

  const getCount = () => {
    try { return parseInt(localStorage.getItem(LSK_DAILY()) || "0", 10) || 0; }
    catch { return 0; }
  };
  const incCount = () => {
    const n = getCount() + 1;
    localStorage.setItem(LSK_DAILY(), String(n));
  };

  function toggleFav(id) {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next);
    localStorage.setItem(LSK_FAVS, JSON.stringify(next));
  }
  function pushHistory(entry) {
    const max = isPro ? 1000 : 10;
    const next = [entry, ...history].slice(0, max);
    setHistory(next);
    localStorage.setItem(LSK_HISTORY, JSON.stringify(next));
  }

  async function analyze() {
    if (!isPro && getCount() >= FREE_LIMIT) {
      setShowUpgrade(true);
      return;
    }
    setLoading(true);
    setResult(null);

    const parsed = parseDexInput(link);
    const data = await fetchDexSmart(parsed);
    const top = data?.pairs?.[0] ?? null;

    const baseScore = scoreFrom(top);
    const qual = analyzeQualities(top);

    const res = { parsed, top, score: baseScore, qual };
    setResult(res);
    setLoading(false);

    if (!isPro) incCount();

    if (top) {
      pushHistory({
        id: top.pairAddress ?? parsed?.id ?? link,
        symbol: `${top?.baseToken?.symbol ?? "?"}/${top?.quoteToken?.symbol ?? "?"}`,
        price: Number(top?.priceUsd ?? 0),
        score: baseScore.total,
        label: qual.mood, // store mood label for history chip
        ts: Date.now(),
        link: `https://dexscreener.com/${top.chainId ?? parsed?.chain}/${top.pairAddress ?? parsed?.id ?? ""}`,
      });
    }
  }

  function copySummary() {
    if (!result?.top) return;
    const p = result.top;
    const s = [
      `Fortunex AI — Analysis`,
      `${p.baseToken?.symbol}/${p.quoteToken?.symbol} • Price $${Number(p.priceUsd ?? 0).toFixed(6)}`,
      `Fortune Score: ${result.qual.fortune}/100 (${result.qual.mood})`,
      `Subs — Stability ${result.qual.stability}/10 • Growth ${result.qual.growth}/10 • Momentum ${result.qual.momentum}/10`,
      `24h Change: ${pct(p.priceChange?.h24)} | Vol24h: $${k(p.volume?.h24)} | Liq: $${k(p.liquidity?.usd)}`,
      `Buyer Share: ${result.qual.buyerShare}% | Tx 24h: Buys ${p.txns?.h24?.buys ?? 0} / Sells ${p.txns?.h24?.sells ?? 0}`,
      `Insight: ${result.qual.insight}`,
      `Pair: ${p.pairAddress ?? "—"} on ${p.chainId ?? "—"}`,
      `Note: Educational only — not financial advice.`,
    ].join("\n");
    navigator.clipboard?.writeText(s);
    alert("Summary copied to clipboard.");
  }

  // handy locals for UI
  const p = result?.top;
  const mood = result?.qual?.mood || result?.score?.label || "Neutral";
  const moodCol = moodColor(mood);
  const buys = p?.txns?.h24?.buys ?? 0;
  const sells = p?.txns?.h24?.sells ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(#0A1A2F,#111)", color: "#fff", fontFamily: "Inter,system-ui,Arial", paddingBottom: 40 }}>
      {/* Header */}
      <header style={{ position: "sticky", top: 0, backdropFilter: "blur(4px)", borderBottom: "1px solid #D4AF37", background: "#0A1A2Fcc", zIndex: 10 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: "linear-gradient(135deg,#D4AF37,#2E86DE)", display: "grid", placeItems: "center", color: "#000", fontWeight: 800 }}>F</div>
            <div>
              <div style={{ fontWeight: 700, letterSpacing: 1 }}>FORTUNEX AI</div>
              <div style={{ fontSize: 12, color: "#D4AF37" }}>Token Intelligence Dashboard</div>
            </div>
          </div>
          <a href="#" onClick={(e) => { e.preventDefault(); setShowUpgrade(true); }} style={{ fontSize: 12, color: "#D4AF37", textDecoration: "underline" }}>Pricing</a>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 12, display: "grid", gap: 12 }}>
        {/* Input Card */}
        <div style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>Paste DEX link / address / name</div>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="e.g., https://dexscreener.com/solana/PAIR  or  7xKXJ8K...  or  BONK"
            style={{ width: "100%", background: "#111", border: "1px solid #D4AF3722", color: "#fff", borderRadius: 12, padding: "10px 12px" }}
          />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
            <button onClick={analyze} disabled={loading} style={{ background: "linear-gradient(90deg,#D4AF37,#2E86DE)", color: "#000", fontWeight: 700, border: "none", padding: "10px 16px", borderRadius: 12 }}>
              {loading ? "Analyzing..." : "Analyze"}
            </button>
            {!isPro && <div style={{ fontSize: 12, opacity: 0.8 }}>Free uses today: {Math.min(getCount(), FREE_LIMIT)} / {FREE_LIMIT}</div>}
          </div>
        </div>

        {/* No data message */}
        {result && !result.top && (
          <div style={{ background: "#311", border: "1px solid #a33", borderRadius: 12, padding: 12 }}>
            Couldn’t find live data for that input. Try a full Dexscreener link like{" "}
            <code>https://dexscreener.com/solana/&lt;pair&gt;</code>, a raw pair/token address, or a token name.
            (Very new/illiquid pairs may not have stats yet.)
          </div>
        )}

        {/* Result Card */}
        {result && result.top && (
          <div style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
            {/* Header row — mood badge & raw score colorized */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {p?.info?.imageUrl && (
                <img src={p.info.imageUrl} alt="token" width={32} height={32} style={{ borderRadius: 8, background: "#111" }} />
              )}

              <div style={{ fontWeight: 700 }}>
                {p ? `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}` : "—"}
              </div>

              <span style={{
                border: `1px solid ${moodCol}`,
                color: moodCol,
                fontWeight: 700,
                fontSize: 12,
                borderRadius: 8,
                padding: "2px 8px",
              }}>
                {mood}
              </span>

              <span style={{ fontSize: 12, color: moodCol }}>
                Raw Score: {result.score.total}/100
              </span>

              {p?.pairAddress && (
                <a
                  href={`https://dexscreener.com/${p.chainId}/${p.pairAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: "auto", fontSize: 12, color: "#2E86DE" }}
                >
                  View on Dexscreener ↗
                </a>
              )}
              {p?.pairAddress && (
                <button
                  onClick={() => toggleFav(p.pairAddress)}
                  title="Favorite"
                  style={{ marginLeft: 8, background: "transparent", border: "1px solid #D4AF37", color: "#D4AF37", borderRadius: 8, padding: "2px 8px" }}
                >
                  {favs.includes(p.pairAddress) ? "★" : "☆"}
                </button>
              )}
            </div>

            {/* AI Insight + Fortune Score */}
            <div style={{ marginTop: 12, background: "#111", border: "1px solid #222", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ background: "#D4AF37", color: "#000", fontWeight: 700, borderRadius: 8, padding: "2px 8px" }}>
                  Fortune Score: {result.qual.fortune}/100
                </span>
                <span style={{ fontSize: 12, color: "#D4AF37cc" }}>
                  {result.qual.mood} • Buyer Share {result.qual.buyerShare}%
                </span>
              </div>

              {/* Sub-score bars */}
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <Bar label="Stability" value={result.qual.stability} />
                <Bar label="Growth"    value={result.qual.growth} />
                <Bar label="Momentum"  value={result.qual.momentum} />
              </div>

              <div style={{ marginTop: 10, fontSize: 14, color: "#eee" }}>
                <b>AI Insight:</b> {result.qual.insight}
              </div>
            </div>

            {/* Sparkline */}
            <div style={{ marginTop: 12 }}>
              <Sparkline points={buildSparkPoints(p?.priceChange)} height={50} />
              <div style={{ fontSize: 12, color: "#D4AF37aa", marginTop: 4 }}>
                1h: {pct(p?.priceChange?.h1)} • 6h: {pct(p?.priceChange?.h6)} • 24h: {pct(p?.priceChange?.h24)}
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12, fontSize: 14 }}>
              <Stat label="Price" value={`$${Number(p?.priceUsd ?? 0).toFixed(6)}`} />
              <Stat label="Liquidity" value={`$${k(p?.liquidity?.usd)}`} />
              <Stat label="Vol 24h" value={`$${k(p?.volume?.h24)}`} />
              <Stat label="Tx 24h" value={`${buys} buys / ${sells} sells`} />
              <Stat label="Pair Age" value={fmtDate(p?.pairCreatedAt)} />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={copySummary} style={{ borderRadius: 10, padding: "8px 12px", border: "1px solid #D4AF37", color: "#D4AF37", background: "transparent" }}>
                Copy summary
              </button>
              <button onClick={() => setShowUpgrade(true)} style={{ borderRadius: 10, padding: "8px 12px", border: "1px solid #2E86DE", color: "#2E86DE", background: "transparent" }}>
                Export PDF (Pro)
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#D4AF37aa" }}>
              Educational insights only — Not financial advice.
            </div>
          </div>
        )}

        {/* History + Favorites */}
        {(history.length > 0 || favs.length > 0) && (
          <div style={{ display: "grid", gap: 12 }}>
            {history.length > 0 && (
              <div style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent Analyses</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {history.map((h, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
                      <span style={{ width: 64, opacity: 0.8 }}>
                        {new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span style={{ flex: 1 }}>{h.symbol}</span>
                      <span style={{ opacity: 0.8 }}>${Number(h.price).toFixed(6)}</span>
                      <span style={{ background: "#222", border: "1px solid #444", borderRadius: 8, padding: "2px 8px" }}>
                        {h.label} {h.score}/100
                      </span>
                      <a href={h.link} target="_blank" rel="noreferrer" style={{ color: "#2E86DE" }}>
                        Open ↗
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {favs.length > 0 && (
              <div style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Favorites</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {favs.map((id) => (
                    <span key={id} style={{ border: "1px solid #D4AF37", color: "#D4AF37", borderRadius: 999, padding: "6px 10px", fontSize: 12 }}>
                      ★ {id.slice(0, 6)}…{id.slice(-4)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Upgrade Modal */}
      {showUpgrade && (
        <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.6)", backdropFilter: "blur(2px)" }}>
          <div style={{ width: "92%", maxWidth: 420, background: "#0A1A2F", border: "1px solid #D4AF37", borderRadius: 16, padding: 16 }}>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div style={{ width: 48, height: 48, margin: "0 auto", borderRadius: 24, background: "linear-gradient(135deg,#D4AF37,#2E86DE)", display: "grid", placeItems: "center", color: "#000", fontWeight: 800 }}>F</div>
            </div>
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: 18 }}>You’ve reached your free limit</div>
            <div style={{ textAlign: "center", opacity: 0.85, fontSize: 14, marginTop: 6 }}>
              You’ve completed 2 analyses today. Upgrade to unlock unlimited insights and advanced learning tools.
            </div>
            <ul style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
              <li>• Unlimited analyses per day</li>
              <li>• Momentum & buyer/seller trends</li>
              <li>• Shareable PDF summaries</li>
            </ul>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <a href={STRIPE_PRO_LINK} style={{ textAlign: "center", borderRadius: 12, padding: "10px 12px", fontWeight: 700, background: "linear-gradient(90deg,#D4AF37,#2E86DE)", color: "#000" }}>
                🔓 Upgrade Now — €4.99/mo
              </a>
              <button onClick={() => setShowUpgrade(false)} style={{ textAlign: "center", borderRadius: 12, padding: "10px 12px", fontWeight: 700, border: "1px solid #D4AF3788", color: "#D4AF37", background: "transparent" }}>
                Remind me tomorrow
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 6, fontSize: 12, color: "#D4AF37aa" }}>
              Educational purpose only — Not financial advice.
            </div>
          </div>
        </div>
      )}

      <footer style={{ textAlign: "center", padding: 12, fontSize: 12, color: "#D4AF37aa" }}>© {new Date().getFullYear()} Fortunex AI</footer>
    </div>
  );
}

/* ---------- Small UI helpers ---------- */
function Stat({ label, value }) {
  return (
    <div style={{ background: "#111", border: "1px solid #D4AF3722", borderRadius: 12, padding: 10 }}>
      <div style={{ fontSize: 12, color: "#D4AF37cc" }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Bar({ label, value }) {
  const p = Math.round((Number(value) / 10) * 100);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "#D4AF37cc" }}>{label}</span>
        <span>{Number(value).toFixed(1)}/10</span>
      </div>
      <div style={{ height: 10, background: "#1b1b1b", borderRadius: 8, overflow: "hidden", border: "1px solid #333" }}>
        <div style={{ width: `${p}%`, height: "100%", background: "linear-gradient(90deg,#2E86DE,#D4AF37)" }} />
      </div>
    </div>
  );
}

function Sparkline({ points = [], height = 50 }) {
  if (!points.length) return null;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const up = points[points.length - 1].y < points[0].y; // lower y = higher value
  const stroke = up ? "#2ECC71" : "#E74C3C";
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
                         }
