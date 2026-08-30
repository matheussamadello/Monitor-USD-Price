// Sonda descartavel: mede o que cada fonte candidata de USD/BRL entrega
// de verdade. Nao altera nada do monitor. Roda so por workflow_dispatch.
const agora = Math.floor(Date.now() / 1000);
const ANO = 31536000;

const fmt = (t) => new Date(t * 1000).toISOString().slice(0, 10);

async function pegar(url, opts = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": "usd-monitor-probe/1.0" }, ...opts });
  const txt = await res.text();
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, txt };
}

function resumo(nome, linhas, extra = "") {
  if (!linhas.length) return console.log(`  ${nome}: 0 velas`);
  linhas.sort((a, b) => a.t - b.t);
  const ult = linhas[linhas.length - 1];
  const zeroRange = linhas.filter((l) => l.h === l.l).length;
  console.log(
    `  ${nome}: ${linhas.length} velas | ${fmt(linhas[0].t)} -> ${fmt(ult.t)} | ` +
      `ultima OHLC ${ult.o} ${ult.h} ${ult.l} ${ult.c} | amplitude-zero: ${zeroRange}` +
      (extra ? ` | ${extra}` : "")
  );
}

const candidatos = [
  {
    nome: "pyth/tradingview D",
    url: `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent("FX.USD/BRL")}&resolution=D&from=${agora - 5 * ANO}&to=${agora}`,
    parse: (t) => {
      const j = JSON.parse(t);
      if (j.s !== "ok") throw new Error(`s=${j.s} ${j.errmsg || ""}`);
      return j.t.map((ts, i) => ({ t: ts, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i] }));
    },
  },
  {
    nome: "pyth/tradingview W",
    url: `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent("FX.USD/BRL")}&resolution=W&from=${agora - 15 * ANO}&to=${agora}`,
    parse: (t) => {
      const j = JSON.parse(t);
      if (j.s !== "ok") throw new Error(`s=${j.s} ${j.errmsg || ""}`);
      return j.t.map((ts, i) => ({ t: ts, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i] }));
    },
  },
  {
    nome: "pyth/symbols (metadados)",
    url: `https://benchmarks.pyth.network/v1/shims/tradingview/symbols?symbol=${encodeURIComponent("FX.USD/BRL")}`,
    cru: true,
  },
  {
    nome: "pyth/price_feeds (existe FX USD/BRL?)",
    url: "https://hermes.pyth.network/v2/price_feeds?query=USD%2FBRL&asset_type=fx",
    cru: true,
  },
  {
    nome: "yahoo D (atual)",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/USDBRL=X?interval=1d&range=5y",
    parse: (t) => {
      const r = JSON.parse(t).chart.result[0];
      const q = r.indicators.quote[0];
      return r.timestamp
        .map((ts, i) => ({ t: ts, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
        .filter((x) => [x.o, x.h, x.l, x.c].every((v) => Number.isFinite(v)));
    },
  },
  {
    nome: "stooq D (fallback atual)",
    url: "https://stooq.com/q/d/l/?s=usdbrl&i=d",
    parse: (t) =>
      t.trim().split(/\r?\n/).slice(1).map((l) => {
        const c = l.split(",");
        return { t: Date.parse(`${c[0]}T00:00:00Z`) / 1000, o: +c[1], h: +c[2], l: +c[3], c: +c[4] };
      }).filter((x) => Number.isFinite(x.t)),
  },
  {
    nome: "fxcm candledata (tiro longo)",
    url: "https://candledata.fxcorporate.com/D1/USDBRL/2026.csv.gz",
    cru: true,
  },
];

for (const c of candidatos) {
  console.log(`\n== ${c.nome}`);
  console.log(`  url: ${c.url}`);
  try {
    const r = await pegar(c.url);
    console.log(`  http ${r.status} em ${r.ms}ms, ${r.txt.length} bytes`);
    if (!r.ok) { console.log(`  corpo: ${r.txt.slice(0, 200)}`); continue; }
    if (c.cru) { console.log(`  corpo: ${r.txt.slice(0, 500)}`); continue; }
    resumo("dados", c.parse(r.txt));
  } catch (e) {
    console.log(`  ERRO: ${e.message}`);
  }
}
