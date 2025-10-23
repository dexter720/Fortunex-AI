import React from "react";

/* FORTUNEX AI v2 (compact)
   - 2/day free gate
   - Buyer/Seller ratio, Liquidity, Volume
   - Sparkline (from h1/h6/h24)
   - History + Favorites (localStorage)
   - Copy summary
*/

export const STRIPE_PRO_LINK = "https://buy.stripe.com/test_PRO_LINK";
export const STRIPE_ELITE_LINK = "https://buy.stripe.com/test_ELITE_LINK";

// ---------- Dexscreener helpers ----------
const DS_API = "https://api.dexscreener.com/latest/dex/";
function parseDexLink(raw) {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    if (host.includes("dexscreener.com") && parts.length >= 2) {
      return { provider: "dexscreener", chain: parts[0], id: parts[1] };
    }
    return { provider: "unknown", id: raw };
  } catch {
    return null;
  }
}
async function fetchDexscreener(chain, id) {
  const urls = [`${DS_API}pairs/${chain}/${id}`, `${DS_API}tokens/${id}`];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      if (d?.pairs?.length) return d;
    } catch {}
  }
  return null;
}

// ---------- utils ----------
const k = (n = 0, d = 2) => {
  const x = Number(n) || 0;
  if (Math.abs(x) >= 1e9) return (x / 1e9).toFixed(d) + "B";
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(d) + "M";
  if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(d) + "k";
  return x.toFixed(d);
};
const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(2)}%`);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString() : "—");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function scoreFrom(pair) {
  if (!pair) return { total: 50, label: "Neutral" };
  const liq = pair?.liquidity?.usd ?? 0;
  const vol = pair?.volume?.h24 ?? 0;
  const buys = pair?.txns?.h24?.buys ?? 0;
  const sells = pair?.txns?.h24?.sells ?? 0;
  const ch = pair?.priceChange?.h24 ?? 0;
  const base = Math.log10(liq + vol + 1) * 10 + (buys - sells) + ch;
  const total = Math.round(clamp(base, 0, 100));
  const label = total > 66 ? "Bullish" : total < 33 ? "Bearish" : "Neutral";
  return { total, label };
}
function sparkPoints(pc = {}) {
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

// ---------- storage keys ----------
const LSK_PRO = "fx_isPro";
const LSK_DAILY = (d = new Date()) =>
  `fx_daily_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const LSK_HISTORY = "fx_history";
const LSK_FAVS = "fx_favorites";

// ---------- App ----------
export default function FortunexAIApp() {
  const [link, setLink] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [showUpgrade, setShowUpgrade] = React.useState(false);
  const [isPro, setIsPro] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LSK_PRO) || "false");
    } catch {
      return false;
    }
  });
  const [history, setHistory] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LSK_HISTORY) || "[]");
    } catch {
      return [];
    }
  });
  const [favs, setFavs] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LSK_FAVS) || "[]");
    } catch {
      return [];
    }
  });

  const FREE_LIMIT = 2;

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
    try {
      return parseInt(localStorage.getItem(LSK_DAILY()) || "0", 10) || 0;
    } catch {
      return 0;
    }
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

    const parsed = parseDexLink(link);
    let data = null;
    if (parsed?.provider === "dexscreener") {
      data = await fetchDexscreener(parsed.chain, parsed.id);
    }

    const top = data?.pairs?.[0] ?? null;
    const score = scoreFrom(top);
    const res = { parsed, top, score };
    setResult(res);
    setLoading(false);
    if (!isPro) incCount();

    if (top) {
      pushHistory({
        id: top.pairAddress ?? parsed?.id ?? link,
        symbol: `${top?.baseToken?.symbol ?? "?"}/${top?.quoteToken?.symbol ?? "?"}`,
        price: Number(top?.priceUsd ?? 0),
        score: score.total,
        label: score.label,
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
  const spark = sparkPoints(p?.priceChange);
  const buys = p?.txns?.h24?.buys ?? 0;
  const sells = p?.txns?.h24?.sells ?? 0;
  const totalTx = buys + sells || 1;
  const buyerShare = (buys / totalTx) * 100;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(#0A1A2F,#111)", color: "#fff", fontFamily: "Inter,system-ui,Arial", paddingBottom: 40 }}>
      {/* Header */}
      <header style={{ position: "sticky", top: 0, backdropFilter: "blur(4px)", borderBottom: "1px solid #D4AF37", background: "#0A1A2Fcc", zIndex: 10 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: "linear-gradient(135deg,#D4AF37,#2E86DE)", display: "grid", placeItems: "center", color: "#000", fontWeight: 800 }}>F</div>
            <div>
              <div style={{ fontWeight: 700, letterSpacing: 1 }}>FORTUNEX AI</div>
              <div style={{ fontSize: 12, color: "#D4AF37" }}>Intelligent • Educational Analysis</div>
            </div>
          </div>
          <a href="#" onClick={(e) => { e.preventDefault(); setShowUpgrade(true); }} style={{ fontSize: 12, color: "#D4AF37", textDecoration: "underline" }}>Pricing</a>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 12, display: "grid", gap: 12 }}>
        {/* Input Card */}
        <div style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>Paste DEX link</div>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://dexscreener.com/solana/PAIR..." style={{ width: "100%", background: "#111", border: "1px solid #D4AF3722", color: "#fff", borderRadius: 12, padding: "10px 12px" }} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
            <button onClick={analyze} disabled={loading} style={{ background: "linear-gradient(90deg,#D4AF37,#2E86DE)", color: "#000", fontWeight: 700, border: "none", padding: "10px 16px", borderRadius: 12 }}>
              {loading ? "Analyzing..." : "Analyze"}
            </button>
            {!isPro && <div style={{ fontSize: 12, opacity: 0.8 }}>Free uses today: {Math.min(getCount(), FREE_LIMIT)} / {FREE_LIMIT}</div>}
          </div>
        </div>

        {/* Result Card */}
        {result && (
          <div style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {p?.info?.imageUrl && <img src={p.info.imageUrl} alt="token" width={32} height={32} style={{ borderRadius: 8, background: "#111" }} />}
              <div style={{ fontWeight: 700 }}>{p ? `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}` : "—"}</div>
              <span style={{ background: "#D4AF37", color: "#000", fontWeight: 700, fontSize: 12, borderRadius: 8, padding: "2px 8px" }}>{result.score.label}</span>
              <span style={{ fontSize: 12, color: "#D4AF37cc" }}>Score: {result.score.total}/100</span>
              {p?.pairAddress && (
                <a href={`https://dexscreener.com/${p.chainId}/${p.pairAddress}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 12, color: "#2E86DE" }}>
                  View on Dexscreener ↗
                </a>
              )}
              {p?.pairAddress && (
                <button onClick={() => toggleFav(p.pairAddress)} title="Favorite" style={{ marginLeft: 8, background: "transparent", border: "1px solid #D4AF37", color: "#D4AF37", borderRadius: 8, padding: "2px 8px" }}>
                  {favs.includes(p.pairAddress) ? "★" : "☆"}
                </button>
              )}
            </div>

            {/* Sparkline */}
            <div style={{ marginTop: 10 }}>
              <Sparkline points={spark} height={50} />
              <div style={{ fontSize: 12, color: "#D4AF37aa", marginTop: 4 }}>
                1h: {pct(p?.priceChange?.h1)} • 6h: {pct(p?.priceChange?.h6)} • 24h: {pct(p?.priceChange?.h24)}
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12, fontSize: 14 }}>
              <Stat label="Price" value={`$${Number(p?.priceUsd ?? 0).toFixed(6)}`} />
              <Stat label="Liquidity" value={`$${k(p?.liquidity?.usd)}`} />
              <Stat label="Vol 24h" value={`$${k(p?.volume?.h24)}`} />
              <Stat label="Tx 24h" value={`${buys} buys / ${sells} sells`} />
              <Stat label="Buyer Share" value={`${buyerShare.toFixed(1)}%`} />
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
                      <span style={{ width: 64, opacity: 0.8 }}>{new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span style={{ flex: 1 }}>{h.symbol}</span>
                      <span style={{ opacity: 0.8 }}>${Number(h.price).toFixed(6)}</span>
                      <span style={{ background: "#222", border: "1px solid #444", borderRadius: 8, padding: "2px 8px" }}>{h.label} {h.score}/100</span>
                      <a href={h.link} target="_blank" rel="noreferrer" style={{ color: "#2E86DE" }}>Open ↗</a>
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
              You’ve completed {FREE_LIMIT} analyses today. Upgrade to unlock unlimited insights and advanced learning tools.
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

// ---------- small UI helpers ----------
function Stat({ label, value }) {
  return (
    <div style={{ background: "#111", border: "1px solid #D4AF3722", borderRadius: 12, padding: 10 }}>
      <div style={{ fontSize: 12, color: "#D4AF37cc" }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}
function Sparkline({ points = [], height = 40 }) {
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
/* END OF FILE */
