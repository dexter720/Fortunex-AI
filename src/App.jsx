import React from "react";

/* ============================================
   FORTUNEX AI v5.3 — Full App.jsx
   - Analyzer • Top Movers (auto-refresh + status dot) • Favorites • Pricing
   - Public promo codes (auto-apply on Enter + toast)
   - Gift Pro modal (?pro=1 share link)
   - Share as Image (watermark) + Export PDF (Pro)
   - Compare Mode (Pro)
   - Robust Dexscreener fetch (link / raw address / search)
============================================ */

// ---- Stripe Payment Links (replace with your live links) ----
export const STRIPE_PRO_LINK   = "https://buy.stripe.com/test_PRO_LINK";
export const STRIPE_ELITE_LINK = "https://buy.stripe.com/test_ELITE_LINK";

// ---- Public promo codes → Stripe discounted links (replace) ----
const PROMOS = {
  FORTUNE20: "https://buy.stripe.com/test_DISCOUNT20", // 20% off
  WELCOME10: "https://buy.stripe.com/test_DISCOUNT10", // 10% off
  VIPFREE:   "https://buy.stripe.com/test_FREEFIRST",  // free first month
};

// ---- Dexscreener API ----
const DS_API = "https://api.dexscreener.com/latest/dex/";

// ---- Auto-refresh config for Top Movers ----
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const FRESH_GREEN_MS  = 5  * 60 * 1000;     // <5m = green
const FRESH_YELLOW_MS = 20 * 60 * 1000;     // 5–20m = yellow, else red

/* ------------ Input parsing + fetch helpers ------------ */
function parseDexInput(raw) {
  try {
    const txt = raw.trim();
    if (/^[0-9a-zA-Z]{32,}$/.test(txt)) return { kind: "raw", id: txt };
    const url = new URL(txt);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (host.includes("dexscreener.com") && parts.length >= 2) {
      return { kind: "dex", chain: parts[0], id: parts[1] };
    }
    return { kind: "search", q: txt };
  } catch {
    if (/^[0-9a-zA-Z]{32,}$/.test(raw.trim())) return { kind: "raw", id: raw.trim() };
    return { kind: "search", q: raw.trim() };
  }
}

async function fetchDexSmart(parsed) {
  const tries = [];
  if (parsed?.kind === "dex")  tries.push(`${DS_API}pairs/${parsed.chain}/${parsed.id}`);
  if (parsed?.kind === "raw")  tries.push(`${DS_API}tokens/${parsed.id}`);
  tries.push(`${DS_API}search?q=${encodeURIComponent(parsed?.q || parsed?.id || "")}`);
  for (const u of tries) {
    try {
      const r = await fetch(u, { headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const d = await r.json();
      if (d?.pairs?.length) return d;
    } catch {}
  }
  return null;
}

async function fetchMovers(chain = "solana", sortKey = "pct") {
  const r = await fetch(`${DS_API}search?q=${encodeURIComponent(chain)}`, { headers: { Accept: "application/json" } });
  if (!r.ok) return [];
  const d = await r.json();
  const arr = Array.isArray(d?.pairs) ? d.pairs : [];
  const minLiq = 20000, minVol = 20000;
  const filtered = arr.filter(p => (p?.liquidity?.usd ?? 0) >= minLiq && (p?.volume?.h24 ?? 0) >= minVol);
  if (sortKey === "vol") {
    return filtered.sort((a,b)=> (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0)).slice(0, 25);
  }
  return filtered
    .sort((a,b)=>{
      const ap = Math.abs(a?.priceChange?.h24 ?? 0);
      const bp = Math.abs(b?.priceChange?.h24 ?? 0);
      if (bp !== ap) return bp - ap;
      return (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0);
    })
    .slice(0, 25);
}

/* ------------------- utils ------------------- */
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
  const label = total > 50 ? "Bullish" : total < 50 ? "Bearish" : "Neutral";
  return { total, label };
}

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

  let stability = (Math.log10(liq + 1) * 1.6) - (Math.min(Math.abs(ch24), 50) / 25);
  stability = clamp(stability, 0, 10);

  let growth = (Math.log10(vol24 + 1) * 1.6) + (clamp(ch24, -20, 20) / 10);
  growth = clamp(growth, 0, 10);

  const bias = (buyerShare - 0.5) * 20;
  let momentum = 5 + bias * 0.6 + clamp((ch1 + ch6) / 4, -5, 5);
  momentum = clamp(momentum, 0, 10);

  const fortune = clamp(Math.round((stability * 3 + growth * 3 + momentum * 4) * 2.5), 0, 100);
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

function moodColor(mood) {
  if (mood === "Bullish") return "#2ECC71";
  if (mood === "Bearish") return "#E74C3C";
  return "#F1C40F"; // Neutral
}

function freshnessColor(ts) {
  if (!ts) return "#999"; // unknown
  const age = Date.now() - ts;
  if (age < FRESH_GREEN_MS) return "#2ECC71";
  if (age < FRESH_YELLOW_MS) return "#F1C40F";
  return "#E74C3C";
}

// ---- storage keys ----
const LSK_PRO = "fx_isPro";
const LSK_DAILY = (d = new Date()) =>
  `fx_daily_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const LSK_HISTORY = "fx_history";
const LSK_FAVS = "fx_favorites";

// ---- Lazy loaders for html2canvas / jsPDF (NPM or CDN) ----
async function ensureLibs() {
  let html2canvas = window.html2canvas;
  let jsPDFCtor = window.jspdf?.jsPDF;

  try {
    if (!html2canvas) {
      const mod = await import(/* @vite-ignore */ "html2canvas").catch(()=>null);
      html2canvas = mod?.default || mod;
    }
  } catch {}
  try {
    if (!jsPDFCtor) {
      const mod = await import(/* @vite-ignore */ "jspdf").catch(()=>null);
      jsPDFCtor = mod?.jsPDF || mod?.default?.jsPDF;
    }
  } catch {}

  async function injectOnce(src, check) {
    if (check()) return;
    await new Promise((resolve,reject)=>{
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = ()=> reject(new Error("CDN load failed: "+src));
      document.head.appendChild(s);
    });
  }
  if (!html2canvas) {
    await injectOnce("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", ()=> !!window.html2canvas);
    html2canvas = window.html2canvas;
  }
  if (!jsPDFCtor) {
    await injectOnce("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js", ()=> !!window.jspdf?.jsPDF);
    jsPDFCtor = window.jspdf.jsPDF;
  }
  return { html2canvas, jsPDF: jsPDFCtor };
}

/* =======================
   Main App Component
======================= */
export default function FortunexAIApp() {
  const [tab, setTab] = React.useState("analyze"); // analyze | movers | favs | pricing

  // Analyzer state
  const [link, setLink] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  // Modals / UX
  const [showUpgrade, setShowUpgrade] = React.useState(false);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [compareLink, setCompareLink] = React.useState("");
  const [compareRes, setCompareRes] = React.useState(null);
  const [giftOpen, setGiftOpen] = React.useState(false);
  const [toast, setToast] = React.useState(null);

  // Plan / persistence
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

  // Movers state
  const [mChain, setMChain] = React.useState("solana");
  const [mSort, setMSort] = React.useState("pct");
  const [movers, setMovers] = React.useState([]);
  const [mLoading, setMLoading] = React.useState(false);
  const [lastRefresh, setLastRefresh] = React.useState(null);
  const [autoRefresh, setAutoRefresh] = React.useState(true);

  // Pricing / promo
  const [coupon, setCoupon] = React.useState("");

  // Misc
  const FREE_LIMIT = 2;
  const cardRef = React.useRef(null);

  /* -------- lifecycle -------- */
  // Auto-upgrade from Stripe (?pro=1)
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("pro") === "1") {
      localStorage.setItem(LSK_PRO, "true");
      setIsPro(true);
      const url = window.location.origin + window.location.pathname;
      window.history.replaceState({}, "", url);
      showToast("✅ Pro unlocked on this device");
    }
  }, []);

  // Load movers on tab open / filter change
  const loadMovers = React.useCallback(async () => {
    setMLoading(true);
    const list = await fetchMovers(mChain, mSort);
    setMovers(list);
    setMLoading(false);
    setLastRefresh(Date.now());
  }, [mChain, mSort]);

  React.useEffect(() => {
    if (tab !== "movers") return;
    let alive = true;
    (async () => { if (alive) await loadMovers(); })();
    return () => { alive = false; };
  }, [tab, mChain, mSort, loadMovers]);

  // Auto-refresh interval
  React.useEffect(() => {
    if (tab !== "movers" || !autoRefresh) return;
    const id = setInterval(() => { loadMovers(); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tab, autoRefresh, loadMovers]);

  /* -------- local helpers -------- */
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
  function showToast(msg, ms = 1800) {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }
  function applyPromo(codeRaw) {
    const code = (codeRaw || "").trim().toUpperCase();
    if (!code) return;
    const link = PROMOS[code];
    if (link) {
      showToast(`✅ ${code} applied — redirecting…`);
      setTimeout(() => { window.location.href = link; }, 500);
    } else {
      showToast("❌ Invalid code");
    }
  }
  const giftLink = React.useMemo(() => {
    const base = window.location.origin + window.location.pathname;
    return `${base}?pro=1`;
  }, []);

  /* -------- core actions -------- */
  async function analyze() {
    if (!isPro && getCount() >= FREE_LIMIT) { setShowUpgrade(true); return; }
    setLoading(true); setResult(null);

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
        label: qual.mood,
        ts: Date.now(),
        link: `https://dexscreener.com/${top.chainId ?? parsed?.chain}/${top.pairAddress ?? parsed?.id ?? ""}`,
      });
    }
  }

  async function runCompare() {
    if (!isPro) { setShowUpgrade(true); return; }
    setCompareRes(null);
    const p = parseDexInput(compareLink);
    const d = await fetchDexSmart(p);
    const t = d?.pairs?.[0] ?? null;
    const baseScore = scoreFrom(t);
    const qual = analyzeQualities(t);
    setCompareRes({ parsed: p, top: t, score: baseScore, qual });
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
      `Generated by Fortunex AI — fortunex.app`,
    ].join("\n");
    navigator.clipboard?.writeText(s);
    showToast("📋 Summary copied");
  }

  // ---- Share as Image (PNG) with watermark ----
  async function shareImage() {
    if (!result?.top || !cardRef.current) return;
    const { html2canvas } = await ensureLibs();
    const node = cardRef.current;

    const canvas = await html2canvas(node, { backgroundColor: "#0A1A2F" });
    const ctx = canvas.getContext("2d");

    const barH = Math.max(36, Math.round(canvas.height * 0.05));
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, canvas.height - barH, canvas.width, barH);

    const r = Math.min(18, Math.round(barH * 0.4));
    ctx.beginPath();
    ctx.arc(20 + r, canvas.height - barH/2, r, 0, Math.PI * 2);
    ctx.fillStyle = "#D4AF37"; ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `${Math.round(r*1.2)}px Inter, Arial`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("F", 20 + r, canvas.height - barH/2 + 1);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${Math.max(12, Math.round(barH*0.4))}px Inter, Arial`;
    ctx.textAlign = "left";
    ctx.fillText("Generated by Fortunex AI — Educational use only • fortunex.app", 20 + r*2 + 16, canvas.height - barH/2 + 1);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.95));
    const file = new File([blob], "fortunex-analysis.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: "Fortunex AI Analysis",
          text: "Generated by Fortunex AI — Educational use only.",
          files: [file],
        });
        return;
      } catch {}
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "fortunex-analysis.png";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast("📸 Image saved");
  }

  // ---- Export PDF (Pro) ----
  async function sharePDF() {
    if (!isPro) { setShowUpgrade(true); return; }
    if (!result?.top || !cardRef.current) return;

    const { html2canvas, jsPDF } = await ensureLibs();
    const node = cardRef.current;
    const canvas = await html2canvas(node, { backgroundColor: "#0A1A2F" });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Fortunex AI — Educational Analysis Report", margin, 40);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, 58);

    const imgW = pageW - margin*2;
    const ratio = canvas.height / canvas.width;
    const imgH = Math.min(pageH - 160, imgW * ratio);
    pdf.addImage(imgData, "PNG", margin, 80, imgW, imgH, "", "FAST");

    const yFooter = pageH - 36;
    pdf.setFillColor(0,0,0); pdf.rect(margin, yFooter - 20, pageW - margin*2, 26, "F");
    pdf.setTextColor(255,255,255); pdf.setFont("helvetica", "bold");
    pdf.text("Generated by Fortunex AI — Educational use only • fortunex.app", margin + 12, yFooter);

    pdf.save("fortunex-report.pdf");
    showToast("📄 PDF saved");
  }

  /* -------- render -------- */
  const p = result?.top;
  const mood = result?.qual?.mood || result?.score?.label || "Neutral";
  const moodCol = moodColor(mood);
  const buys = p?.txns?.h24?.buys ?? 0;
  const sells = p?.txns?.h24?.sells ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(#0A1A2F,#111)", color: "#fff", fontFamily: "Inter,system-ui,Arial", paddingBottom: 40 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", top:16, left:"50%", transform:"translateX(-50%)",
          background:"#0A1A2F", border:"1px solid #D4AF37", color:"#fff",
          padding:"8px 12px", borderRadius:12, zIndex:100
        }}>{toast}</div>
      )}

      {/* Header */}
      <header style={{ position: "sticky", top: 0, backdropFilter: "blur(4px)", borderBottom: "1px solid #D4AF37", background: "#0A1A2Fcc", zIndex: 10 }}>
        <div style={{ maxWidth: 1024, margin: "0 auto", padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: "linear-gradient(135deg,#D4AF37,#2E86DE)", display: "grid", placeItems: "center", color: "#000", fontWeight: 800 }}>F</div>
            <div>
              <div style={{ fontWeight: 700, letterSpacing: 1 }}>FORTUNEX AI</div>
              <div style={{ fontSize: 12, color: "#D4AF37" }}>Token Intelligence Dashboard</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setGiftOpen(true); }} style={{ fontSize: 12, color: "#2E86DE", textDecoration: "underline" }}>🎁 Gift Pro</a>
            <a href="#" onClick={(e) => { e.preventDefault(); setShowUpgrade(true); }} style={{ fontSize: 12, color: "#D4AF37", textDecoration: "underline" }}>Upgrade</a>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ maxWidth: 1024, margin: "0 auto", padding: "8px 12px", display: "flex", gap: 8, flexWrap:"wrap" }}>
          {[
            ["analyze","Analyzer"],
            ["movers","Top Movers"],
            ["favs","Favorites"],
            ["pricing","Pricing"],
          ].map(([key,label]) => (
            <button key={key} onClick={()=>setTab(key)}
              style={{
                background: tab===key ? "#162844" : "transparent",
                border: "1px solid #2a3b5a",
                color: "#fff",
                borderRadius: 12, padding: "8px 12px", fontWeight: 600
              }}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 1024, margin: "0 auto", padding: 12, display: "grid", gap: 12 }}>

        {/* ----- ANALYZER TAB ----- */}
        {tab==="analyze" && (
          <>
            <div style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>Paste DEX link / address / name</div>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://dexscreener.com/solana/PAIR  or  7xKXJ8K...  or  BONK"
                style={{ width: "100%", background: "#111", border: "1px solid #D4AF3722", color: "#fff", borderRadius: 12, padding: "10px 12px" }}
              />
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                <button onClick={analyze} disabled={loading}
                  style={{ background: "linear-gradient(90deg,#D4AF37,#2E86DE)", color: "#000", fontWeight: 700, border: "none", padding: "10px 16px", borderRadius: 12 }}>
                  {loading ? "Analyzing..." : "Analyze"}
                </button>
                {!isPro && <div style={{ fontSize: 12, opacity: 0.8 }}>Free uses today: {Math.min(getCount(), FREE_LIMIT)} / {FREE_LIMIT}</div>}
                <button onClick={()=> setCompareOpen(true)} style={{ border: "1px solid #2E86DE", color: "#2E86DE", borderRadius: 12, padding: "8px 12px", background: "transparent" }}>
                  Compare Pair (Pro)
                </button>
              </div>
            </div>

            {result && !result.top && (
              <div style={{ background: "#311", border: "1px solid #a33", borderRadius: 12, padding: 12 }}>
                Couldn’t find live data for that input. Try a full Dexscreener link, a raw pair/token address, or a token name.
              </div>
            )}

            {result && result.top && (
              <div ref={cardRef} style={{ background: "#0A1A2F", border: "1px solid #D4AF3755", borderRadius: 16, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  {p?.info?.imageUrl && <img src={p.info.imageUrl} alt="token" width={32} height={32} style={{ borderRadius: 8, background: "#111" }} />}
                  <div style={{ fontWeight: 700 }}>
                    {p ? `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}` : "—"}
                  </div>
                  <span style={{ border: `1px solid ${moodCol}`, color: moodCol, fontWeight: 700, fontSize: 12, borderRadius: 8, padding: "2px 8px" }}>{mood}</span>
                  <span style={{ fontSize: 12, color: moodCol }}>Raw Score: {result.score.total}/100</span>
                  {p?.pairAddress && (
                    <a href={`https://dexscreener.com/${p.chainId}/${p.pairAddress}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 12, color: "#2E86DE" }}>
                      View on Dexscreener ↗
                    </a>
                  )}
                  {p?.pairAddress && (
                    <button onClick={() => toggleFav(p.pairAddress)} title="Favorite"
                      style={{ marginLeft: 8, background: "transparent", border: "1px solid #D4AF37", color: "#D4AF37", borderRadius: 8, padding: "2px 8px" }}>
                      {favs.includes(p.pairAddress) ? "★" : "☆"}
                    </button>
                  )}
                </div>

                <div style={{ marginTop: 12, background: "#111", border: "1px solid #222", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ background: "#D4AF37", color: "#000", fontWeight: 700, borderRadius: 8, padding: "2px 8px" }}>
                      Fortune Score: {result.qual.fortune}/100
                    </span>
                    <span style={{ fontSize: 12, color: "#D4AF37cc" }}>
                      {result.qual.mood} • Buyer Share {result.qual.buyerShare}%
                    </span>
                  </div>
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    <Bar label="Stability" value={result.qual.stability} />
                    <Bar label="Growth"    value={result.qual.growth} />
                    <Bar label="Momentum"  value={result.qual.momentum} />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 14, color: "#eee" }}>
                    <b>AI Insight:</b> {result.qual.insight}
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <Sparkline points={buildSparkPoints(p?.priceChange)} height={50} />
                  <div style={{ fontSize: 12, color: "#D4AF37aa", marginTop: 4 }}>
                    1h: {pct(p?.priceChange?.h1)} • 6h: {pct(p?.priceChange?.h6)} • 24h: {pct(p?.priceChange?.h24)}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
                  <Stat label="Price" value={`$${Number(p?.priceUsd ?? 0).toFixed(6)}`} />
                  <Stat label="Liquidity" value={`$${k(p?.liquidity?.usd)}`} />
                  <Stat label="Vol 24h" value={`$${k(p?.volume?.h24)}`} />
                  <Stat label="Tx 24h" value={`${buys} buys / ${sells} sells`} />
                  <Stat label="Pair Age" value={fmtDate(p?.pairCreatedAt)} />
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={copySummary} style={{ borderRadius: 10, padding: "8px 12px", border: "1px solid #D4AF37", color: "#D4AF37", background: "transparent" }}>
                    Copy summary
                  </button>
                  <button onClick={shareImage} style={{ borderRadius: 10, padding: "8px 12px", border: "1px solid #D4AF37", color: "#D4AF37", background: "transparent" }}>
                    Share as Image
                  </button>
                  <button onClick={sharePDF} style={{ borderRadius: 10, padding: "8px 12px", border: "1px solid #2E86DE", color: "#2E86DE", background: "transparent" }}>
                    Export PDF (Pro)
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: "#D4AF37aa" }}>
                  Educational insights only — Not financial advice.
                </div>
              </div>
            )}

            {/* Compare Modal (Pro) */}
            {compareOpen && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 30 }}>
                <div style={{ width: "94%", maxWidth: 980, background: "#0A1A2F", border: "1px solid #2E86DE", borderRadius: 16, padding: 16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ fontWeight: 700 }}>Compare Pair (Pro)</div>
                    <button onClick={()=>{ setCompareOpen(false); setCompareRes(null); }} style={{ background:"transparent", border:"1px solid #444", color:"#fff", borderRadius:8, padding:"4px 8px" }}>Close</button>
                  </div>
                  {!isPro && (
                    <div style={{ marginTop: 8, background:"#311", border:"1px solid #a33", borderRadius:12, padding:10 }}>
                      Compare Mode is a Pro feature. Upgrade to unlock.
                      <div style={{ marginTop:8 }}>
                        <a href={STRIPE_PRO_LINK} style={{ color:"#2E86DE", textDecoration:"underline" }}>Upgrade now →</a>
                      </div>
                    </div>
                  )}
                  <div style={{ display:"grid", gap:8, marginTop: 12 }}>
                    <input value={compareLink} onChange={e=>setCompareLink(e.target.value)} placeholder="Paste second link / address / name"
                      style={{ width:"100%", background:"#111", border:"1px solid #2E86DE55", color:"#fff", borderRadius:12, padding:"10px 12px" }} />
                    <button onClick={runCompare} disabled={!isPro} style={{ border:"1px solid #2E86DE", color:"#2E86DE", background:"transparent", borderRadius:12, padding:"8px 12px" }}>
                      Analyze & Compare
                    </button>
                  </div>

                  <div style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", marginTop: 16 }}>
                    {result?.top && <CompareCard title="Token A" data={result} />}
                    {compareRes?.top && <CompareCard title="Token B" data={compareRes} />}
                  </div>

                  {result?.top && compareRes?.top && (
                    <CompareTable a={result} b={compareRes} />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ----- MOVERS TAB (auto-refresh) ----- */}
        {tab==="movers" && (
          <div style={{ background:"#0A1A2F", border:"1px solid #D4AF3755", borderRadius:16, padding:16 }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              <label>Chain:</label>
              <select value={mChain} onChange={e=>setMChain(e.target.value)}
                style={{ background:"#111", color:"#fff", border:"1px solid #2a3b5a", borderRadius:8, padding:"6px 8px" }}>
                {["solana","ethereum","bsc","base","polygon","arbitrum","avalanche"].map(c=>(
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <label>Sort:</label>
              <select value={mSort} onChange={e=>setMSort(e.target.value)}
                style={{ background:"#111", color:"#fff", border:"1px solid #2a3b5a", borderRadius:8, padding:"6px 8px" }}>
                <option value="pct">24h % Change</option>
                <option value="vol">24h Volume</option>
              </select>

              {/* status pill */}
              <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:"auto" }}>
                <span title={lastRefresh ? `Last refresh: ${new Date(lastRefresh).toLocaleTimeString()}` : "No data yet"}
                      style={{
                        width:10, height:10, borderRadius:6,
                        background: freshnessColor(lastRefresh),
                        boxShadow:"0 0 8px rgba(0,0,0,.4)"
                      }} />
                <span style={{ fontSize:12, color:"#D4AF37aa" }}>
                  {lastRefresh ? `Updated ${Math.round((Date.now()-lastRefresh)/60000)}m ago` : "Waiting…"}
                </span>
              </div>

              {/* controls */}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={loadMovers} disabled={mLoading}
                  style={{ border:"1px solid #2E86DE", color:"#2E86DE", background:"transparent", borderRadius:8, padding:"6px 10px" }}>
                  {mLoading ? "Refreshing…" : "Refresh now"}
                </button>
                <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, border:"1px solid #2a3b5a", borderRadius:8, padding:"6px 10px" }}>
                  <input type="checkbox" checked={autoRefresh} onChange={e=>setAutoRefresh(e.target.checked)} />
                  Auto-refresh 10m
                </label>
              </div>
            </div>

            <div style={{ marginTop:6, fontSize:12, color:"#D4AF37aa" }}>
              Tip: Change <code>REFRESH_INTERVAL_MS</code> at the top to customize auto-refresh.
            </div>

            {mLoading && <div style={{ marginTop:12, opacity:.8 }}>Loading movers…</div>}
            {!mLoading && movers.length===0 && (
              <div style={{ marginTop:12, background:"#311", border:"1px solid #a33", borderRadius:12, padding:10 }}>
                No movers found for this filter. Try another chain.
              </div>
            )}

            <div style={{ marginTop:12, display:"grid", gap:8 }}>
              {movers.map((x, i)=>(
                <div key={x?.pairAddress || i} style={{ display:"grid", gridTemplateColumns:"40px 1fr 110px 120px 130px 120px", gap:8, alignItems:"center", background:"#111", border:"1px solid #2a3b5a", borderRadius:12, padding:"8px 10px" }}>
                  <div style={{ opacity:.8 }}>#{i+1}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, overflow:"hidden" }}>
                    {x?.info?.imageUrl && <img src={x.info.imageUrl} width={24} height={24} style={{ borderRadius:6 }} />}
                    <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      {x?.baseToken?.symbol}/{x?.quoteToken?.symbol}
                      <div style={{ fontSize:11, opacity:.7 }}>{x?.chainId}</div>
                    </div>
                  </div>
                  <div style={{ color: (x?.priceChange?.h24 ?? 0) >= 0 ? "#2ECC71" : "#E74C3C", fontWeight:700 }}>
                    {pct(x?.priceChange?.h24)}
                  </div>
                  <div>${k(x?.volume?.h24)} Vol</div>
                  <div>${k(x?.liquidity?.usd)} Liq</div>
                  <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                    <a href={`https://dexscreener.com/${x.chainId}/${x.pairAddress}`} target="_blank" rel="noreferrer" style={{ color:"#2E86DE" }}>Open ↗</a>
                    <button onClick={()=>{ setTab("analyze"); setLink(`https://dexscreener.com/${x.chainId}/${x.pairAddress}`); }}
                      style={{ border:"1px solid #D4AF37", color:"#D4AF37", background:"transparent", borderRadius:8, padding:"4px 8px" }}>
                      Analyze
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ----- FAVORITES TAB ----- */}
        {tab==="favs" && (
          <div style={{ background:"#0A1A2F", border:"1px solid #D4AF3755", borderRadius:16, padding:16 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Favorites</div>
            {favs.length === 0 && <div style={{ opacity:.8 }}>You haven’t added any favorites yet.</div>}
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {favs.map((id)=>(
                <span key={id} style={{ border:"1px solid #D4AF37", color:"#D4AF37", borderRadius:999, padding:"6px 10px", fontSize:12 }}>
                  ★ {id.slice(0,6)}…{id.slice(-4)}
                </span>
              ))}
            </div>
            {history.length>0 && (
              <>
                <div style={{ fontWeight:700, margin:"16px 0 8px" }}>Recent Analyses</div>
                <div style={{ display:"grid", gap:8 }}>
                  {history.map((h, i)=>(
                    <div key={i} style={{ display:"flex", gap:10, alignItems:"center", fontSize:14 }}>
                      <span style={{ width:64, opacity:.8 }}>{new Date(h.ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</span>
                      <span style={{ flex:1 }}>{h.symbol}</span>
                      <span style={{ opacity:.8 }}>${Number(h.price).toFixed(6)}</span>
                      <span style={{ background:"#222", border:"1px solid #444", borderRadius:8, padding:"2px 8px" }}>{h.label} {h.score}/100</span>
                      <a href={h.link} target="_blank" rel="noreferrer" style={{ color:"#2E86DE" }}>Open ↗</a>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ----- PRICING TAB ----- */}
        {tab==="pricing" && (
          <div style={{ display:"grid", gap:16 }}>
            {/* Hero + Promo */}
            <div style={{ background:"#0A1A2F", border:"1px solid #D4AF3755", borderRadius:16, padding:16, textAlign:"center" }}>
              <div style={{ fontSize:22, fontWeight:800, letterSpacing:.5 }}>Choose your plan</div>
              <div style={{ marginTop:6, color:"#D4AF37aa" }}>Start free. Upgrade anytime. Educational use only.</div>
              <div style={{ marginTop:8, color:"#2ECC71", fontSize:13 }}>
                Use code <b>FORTUNE20</b> for 20% off — press <b>Enter</b> to apply
              </div>
              <div style={{ marginTop:8, display:"flex", gap:8, justifyContent:"center" }}>
                <input
                  value={coupon}
                  onChange={(e)=>setCoupon(e.target.value)}
                  onKeyDown={(e)=>{ if (e.key === "Enter") applyPromo(coupon); }}
                  placeholder="Enter promo code (e.g., FORTUNE20)"
                  style={{ width:260, background:"#111", border:"1px solid #2a3b5a", color:"#fff", borderRadius:8, padding:"8px 10px", textAlign:"center" }}
                />
              </div>
            </div>

            {/* Plans */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:12 }}>
              {/* Free */}
              <div style={{ background:"#0A1A2F", border:"1px solid #2a3b5a", borderRadius:16, padding:16 }}>
                <div style={{ fontWeight:800, fontSize:18 }}>Free</div>
                <div style={{ fontSize:12, color:"#D4AF37aa" }}>Great for getting started</div>
                <div style={{ fontSize:24, fontWeight:800, margin:"8px 0" }}>€0<span style={{ fontSize:12, opacity:.8 }}>/mo</span></div>
                <ul style={{ lineHeight:1.8, fontSize:14, marginTop:6 }}>
                  <li>• 2 analyses / day</li>
                  <li>• AI Insight + Fortune Score</li>
                  <li>• Top Movers (basic)</li>
                  <li>• Share as Image</li>
                </ul>
                <button onClick={()=>setTab("analyze")} style={{ marginTop:12, width:"100%", border:"1px solid #D4AF37", color:"#D4AF37", background:"transparent", borderRadius:12, padding:"10px 12px", fontWeight:700 }}>
                  Continue Free
                </button>
              </div>

              {/* Pro */}
              <div style={{ background:"#0A1A2F", border:"1px solid #D4AF37", borderRadius:16, padding:16, position:"relative" }}>
                <span style={{ position:"absolute", top:12, right:12, background:"#D4AF37", color:"#000", fontWeight:800, fontSize:12, borderRadius:999, padding:"4px 8px" }}>POPULAR</span>
                <div style={{ fontWeight:800, fontSize:18 }}>Pro</div>
                <div style={{ fontSize:12, color:"#D4AF37aa" }}>For active learners & creators</div>
                <div style={{ fontSize:24, fontWeight:800, margin:"8px 0" }}>€4.99<span style={{ fontSize:12, opacity:.8 }}>/mo</span></div>
                <ul style={{ lineHeight:1.8, fontSize:14, marginTop:6 }}>
                  <li>• Unlimited analyses</li>
                  <li>• ⚖️ Compare Mode</li>
                  <li>• 📄 PDF Export (watermarked)</li>
                  <li>• Enhanced Top Movers</li>
                  <li>• Priority features</li>
                </ul>
                <a href={STRIPE_PRO_LINK} style={{ display:"block", textAlign:"center", marginTop:12, border:"none", background:"linear-gradient(90deg,#D4AF37,#2E86DE)", color:"#000", borderRadius:12, padding:"10px 12px", fontWeight:800, textDecoration:"none" }}>
                  Upgrade — €4.99/mo
                </a>
                <div style={{ textAlign:"center", marginTop:8 }}>
                  <a href="#" onClick={(e)=>{ e.preventDefault(); setGiftOpen(true); }} style={{ color:"#2E86DE", fontSize:12, textDecoration:"underline" }}>
                    🎁 Gift Pro access to a friend
                  </a>
                </div>
              </div>

              {/* Elite */}
              <div style={{ background:"#0A1A2F", border:"1px solid #2a3b5a", borderRadius:16, padding:16 }}>
                <div style={{ fontWeight:800, fontSize:18 }}>Elite</div>
                <div style={{ fontSize:12, color:"#D4AF37aa" }}>Coming soon</div>
                <div style={{ fontSize:24, fontWeight:800, margin:"8px 0" }}>TBA</div>
                <ul style={{ lineHeight:1.8, fontSize:14, marginTop:6, opacity:.7 }}>
                  <li>• Alerts & watchlists</li>
                  <li>• Deeper analytics</li>
                  <li>• Early feature access</li>
                </ul>
                <a href={STRIPE_ELITE_LINK} style={{ display:"block", textAlign:"center", marginTop:12, border:"1px solid #2E86DE", color:"#2E86DE", background:"transparent", borderRadius:12, padding:"10px 12px", fontWeight:700, textDecoration:"none" }}>
                  Join waitlist
                </a>
              </div>
            </div>

            {/* FAQ */}
            <div style={{ background:"#0A1A2F", border:"1px solid #2a3b5a", borderRadius:16, padding:16 }}>
              <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>FAQ</div>
              <div style={{ display:"grid", gap:10 }}>
                <QA q="Is this financial advice?" a="No. Fortunex AI is for educational purposes only. It summarizes on-chain market data to help you learn. Always do your own research." />
                <QA q="What blockchains are supported?" a="We use Dexscreener data — if a pair is listed there, you can analyze it. Start by pasting a full Dexscreener link or pair address." />
                <QA q="How do I unlock Pro?" a="Tap Upgrade or apply a promo code and complete checkout. After payment, your device can auto-unlock via ?pro=1 during testing (or with webhooks later)." />
                <QA q="Can I cancel anytime?" a="Yes. You control your subscription via Stripe; cancel with one click." />
                <QA q="Can I gift Pro?" a="Yes. Use the Gift Pro link to share a one-time unlock link (?pro=1) for now. You can switch to license keys or Stripe coupons later." />
              </div>
            </div>

            <div style={{ textAlign:"center", color:"#D4AF37aa", fontSize:12 }}>
              7-day money-back guarantee. Educational purpose only — Not financial advice.
            </div>
          </div>
        )}
      </main>

      {/* Upgrade Modal (with promo input) */}
      {showUpgrade && (
        <div style={{ position:"fixed", inset:0, display:"grid", placeItems:"center", background:"rgba(0,0,0,.6)", backdropFilter:"blur(2px)" }}>
          <div style={{ width:"92%", maxWidth:420, background:"#0A1A2F", border:"1px solid #D4AF37", borderRadius:16, padding:16 }}>
            <div style={{ textAlign:"center", marginBottom:8 }}>
              <div style={{ width:48, height:48, margin:"0 auto", borderRadius:24, background:"linear-gradient(135deg,#D4AF37,#2E86DE)", display:"grid", placeItems:"center", color:"#000", fontWeight:800 }}>F</div>
            </div>
            <div style={{ textAlign:"center", fontWeight:700, fontSize:18 }}>Unlock Pro Features</div>
            <div style={{ textAlign:"center", opacity:.85, fontSize:14, marginTop:6 }}>
              Unlimited analyses, Compare Mode, and shareable PDF reports.
            </div>
            <ul style={{ marginTop:8, fontSize:14, lineHeight:1.6 }}>
              <li>• Unlimited daily analyses</li>
              <li>• ⚖️ Compare mode</li>
              <li>• 📄 PDF reports</li>
            </ul>
            <div style={{ display:"grid", gap:8, marginTop:12 }}>
              <a href={STRIPE_PRO_LINK} style={{ textAlign:"center", borderRadius:12, padding:"10px 12px", fontWeight:700, background:"linear-gradient(90deg,#D4AF37,#2E86DE)", color:"#000" }}>
                🔓 Upgrade Now — €4.99/mo
              </a>
              <input
                value={coupon}
                onChange={(e)=>setCoupon(e.target.value)}
                onKeyDown={(e)=>{ if (e.key === "Enter") applyPromo(coupon); }}
                placeholder="Have a promo code? Type and press Enter"
                style={{ width:"100%", background:"#111", border:"1px solid #2a3b5a", color:"#fff", borderRadius:8, padding:"8px 10px" }}
              />
              <button onClick={()=>setShowUpgrade(false)} style={{ textAlign:"center", borderRadius:12, padding:"10px 12px", fontWeight:700, border:"1px solid #D4AF3788", color:"#D4AF37", background:"transparent" }}>
                Maybe later
              </button>
            </div>
            <div style={{ textAlign:"center", marginTop:6, fontSize:12, color:"#D4AF37aa" }}>
              Educational purpose only — Not financial advice.
            </div>
          </div>
        </div>
      )}

      {/* Gift Pro Modal */}
      {giftOpen && (
        <div style={{ position:"fixed", inset:0, display:"grid", placeItems:"center", background:"rgba(0,0,0,.6)" }}>
          <div style={{ width:"92%", maxWidth:460, background:"#0A1A2F", border:"1px solid #2E86DE", borderRadius:16, padding:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontWeight:800 }}>🎁 Gift Pro Access</div>
              <button onClick={()=>setGiftOpen(false)} style={{ background:"transparent", border:"1px solid #444", color:"#fff", borderRadius:8, padding:"4px 8px" }}>Close</button>
            </div>
            <div style={{ marginTop:8, color:"#D4AF37aa", fontSize:14 }}>
              Share this link with a friend. When they open it, their device will unlock Pro:
            </div>
            <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
              <input value={giftLink} readOnly style={{ flex:1, minWidth:240, background:"#111", border:"1px solid #2E86DE55", color:"#fff", borderRadius:8, padding:"8px 10px" }} />
              <button onClick={()=>{ navigator.clipboard?.writeText(giftLink); showToast("🔗 Gift link copied"); }} style={{ border:"1px solid #2E86DE", color:"#2E86DE", background:"transparent", borderRadius:8, padding:"8px 12px" }}>
                Copy
              </button>
            </div>
            <div style={{ marginTop:10, fontSize:12, color:"#D4AF37aa" }}>
              Tip: Replace this with license keys or Stripe-issued gift codes when you add a backend.
            </div>
          </div>
        </div>
      )}

      <footer style={{ textAlign:"center", padding:12, fontSize:12, color:"#D4AF37aa" }}>
        © {new Date().getFullYear()} Fortunex AI
      </footer>
    </div>
  );
}

/* ---------- UI helpers ---------- */
function Stat({ label, value }) {
  return (
    <div style={{ background:"#111", border:"1px solid #D4AF3722", borderRadius:12, padding:10 }}>
      <div style={{ fontSize:12, color:"#D4AF37cc" }}>{label}</div>
      <div style={{ fontWeight:600 }}>{value}</div>
    </div>
  );
}
function Bar({ label, value }) {
  const p = Math.round((Number(value) / 10) * 100);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
        <span style={{ color:"#D4AF37cc" }}>{label}</span>
        <span>{Number(value).toFixed(1)}/10</span>
      </div>
      <div style={{ height:10, background:"#1b1b1b", borderRadius:8, overflow:"hidden", border:"1px solid #333" }}>
        <div style={{ width:`${p}%`, height:"100%", background:"linear-gradient(90deg,#2E86DE,#D4AF37)" }} />
      </div>
    </div>
  );
}
function Sparkline({ points = [], height = 50 }) {
  if (!points.length) return null;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const up = points[points.length - 1].y < points[0].y;
  const stroke = up ? "#2ECC71" : "#E74C3C";
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width:"100%", height }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}
function QA({ q, a }) {
  return (
    <div style={{ border:"1px solid #2a3b5a", borderRadius:12, padding:12 }}>
      <div style={{ fontWeight:700 }}>{q}</div>
      <div style={{ marginTop:4, color:"#D4AF37aa", fontSize:14 }}>{a}</div>
    </div>
  );
}

/* ---------- Compare UI ---------- */
function CompareCard({ title, data }) {
  const p = data?.top;
  const mood = data?.qual?.mood || "Neutral";
  const moodCol = moodColor(mood);
  const buys = p?.txns?.h24?.buys ?? 0;
  const sells = p?.txns?.h24?.sells ?? 0;
  return (
    <div style={{ background:"#0A1A2F", border:"1px solid #2E86DE55", borderRadius:12, padding:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ fontWeight:700 }}>{title}</div>
        <span style={{ marginLeft:"auto", border:`1px solid ${moodCol}`, color:moodCol, borderRadius:8, padding:"2px 8px", fontSize:12 }}>{mood}</span>
      </div>
      <div style={{ fontWeight:700, marginTop:6 }}>{p?.baseToken?.symbol}/{p?.quoteToken?.symbol}</div>
      <div style={{ fontSize:12, opacity:.8, marginBottom:6 }}>{p?.chainId}</div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:8 }}>
        <Stat label="Price" value={`$${Number(p?.priceUsd ?? 0).toFixed(6)}`} />
        <Stat label="Fortune" value={`${data?.qual?.fortune}/100`} />
        <Stat label="Vol 24h" value={`$${k(p?.volume?.h24)}`} />
        <Stat label="Liq" value={`$${k(p?.liquidity?.usd)}`} />
        <Stat label="Buyer Share" value={`${data?.qual?.buyerShare}%`} />
        <Stat label="Tx 24h" value={`${buys} / ${sells}`} />
      </div>
    </div>
  );
}
function CompareTable({ a, b }) {
  const rows = [
    ["Fortune", a.qual.fortune, b.qual.fortune, v=>v],
    ["Liquidity ($)", a.top?.liquidity?.usd ?? 0, b.top?.liquidity?.usd ?? 0, v=>"$"+k(v)],
    ["Volume 24h ($)", a.top?.volume?.h24 ?? 0, b.top?.volume?.h24 ?? 0, v=>"$"+k(v)],
    ["Buyer Share (%)", a.qual.buyerShare, b.qual.buyerShare, v=>v.toFixed(1)+"%"],
    ["Price 24h (%)", a.top?.priceChange?.h24 ?? 0, b.top?.priceChange?.h24 ?? 0, v=>pct(v)],
  ];
  const winCol = (av,bv)=> (av>bv?"#2ECC7188":av<bv?"#E74C3C88":"transparent");
  return (
    <div style={{ marginTop:12, background:"#0A1A2F", border:"1px solid #2E86DE55", borderRadius:12, overflow:"hidden" }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", padding:"10px 12px", borderBottom:"1px solid #2a3b5a", fontWeight:700 }}>
        <div>Metric</div><div style={{ textAlign:"center" }}>Token A</div><div style={{ textAlign:"center" }}>Token B</div>
      </div>
      {rows.map(([name,av,bv,fmt],i)=>(
        <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", padding:"8px 12px", borderTop:"1px solid #1b2a44" }}>
          <div style={{ opacity:.9 }}>{name}</div>
          <div style={{ textAlign:"center", background:winCol(av,bv), borderRadius:6 }}>{fmt(Number(av)||0)}</div>
          <div style={{ textAlign:"center", background:winCol(bv,av), borderRadius:6 }}>{fmt(Number(bv)||0)}</div>
        </div>
      ))}
    </div>
  );
                           }
