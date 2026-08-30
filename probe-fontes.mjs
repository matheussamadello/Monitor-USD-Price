// Sonda descartavel, rodada 2.
const agora = Math.floor(Date.now() / 1000);
const ANO = 31536000;
const fmt = (t) => new Date(t * 1000).toISOString().slice(0, 10);

async function pegar(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": "usd-monitor-probe/1.0" } });
    const txt = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, txt };
  } catch (e) {
    return { ok: false, status: "EXC", ms: Date.now() - t0, txt: e.message };
  }
}

function resumo(linhas) {
  if (!linhas.length) return console.log("  -> 0 velas");
  linhas.sort((a, b) => a.t - b.t);
  const u = linhas[linhas.length - 1];
  const z = linhas.filter((l) => l.h === l.l).length;
  console.log(
    `  -> ${linhas.length} velas | ${fmt(linhas[0].t)} -> ${fmt(u.t)} | ` +
      `ultima O=${u.o} H=${u.h} L=${u.l} C=${u.c} | amplitude-zero: ${z}`
  );
}

const udf = (t) => {
  const j = JSON.parse(t);
  if (j.s !== "ok") throw new Error(`s=${j.s} ${j.errmsg || ""}`);
  return j.t.map((ts, i) => ({ t: ts, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i] }));
};

console.log("###### 1. Achar a rota certa do Pyth Benchmarks ######");
const rotasPyth = [
  "https://benchmarks.pyth.network/",
  "https://benchmarks.pyth.network/v1/shims/tradingview/config",
  "https://benchmarks.pyth.network/v1/shims/tradingview/time",
  "https://benchmarks.pyth.network/v1/shims/tradingview/symbol_info?group=crypto",
  "https://benchmarks.pyth.network/v1/price_feeds/",
];
for (const u of rotasPyth) {
  const r = await pegar(u);
  console.log(`  http ${r.status} (${r.txt.length}b) ${u}`);
  if (r.ok) console.log(`     ${r.txt.slice(0, 300)}`);
}

console.log("\n###### 2. Pyth history: variacoes de resolucao/simbolo ######");
const de = agora - 2 * ANO;
for (const [sym, res] of [
  ["FX.USD/BRL", "1D"],
  ["FX.USD/BRL", "D"],
  ["Crypto.BTC/USD", "1D"],
  ["USDBRL", "1D"],
]) {
  const u = `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(sym)}&resolution=${res}&from=${de}&to=${agora}`;
  const r = await pegar(u);
  console.log(`\n  [${sym} @ ${res}] http ${r.status} (${r.txt.length}b)`);
  if (r.ok) { try { resumo(udf(r.txt)); } catch (e) { console.log(`  -> ${e.message}`); console.log(`     ${r.txt.slice(0,200)}`); } }
  else console.log(`     ${r.txt.slice(0, 160)}`);
}

console.log("\n###### 3. Stooq: o que sao aqueles 796 bytes? ######");
{
  const r = await pegar("https://stooq.com/q/d/l/?s=usdbrl&i=d");
  console.log(`  http ${r.status} (${r.txt.length}b)`);
  console.log("  corpo bruto:\n" + r.txt.slice(0, 700).split("\n").map((l) => "    " + l).join("\n"));
}

console.log("\n###### 4. Candidatos a fallback que funcione ######");
{
  const u = "https://economia.awesomeapi.com.br/json/daily/USD-BRL/400";
  const r = await pegar(u);
  console.log(`\n  [awesomeapi] http ${r.status} (${r.txt.length}b) ${u}`);
  if (r.ok) {
    const j = JSON.parse(r.txt);
    console.log(`     amostra: ${JSON.stringify(j[0])}`);
    const linhas = j.map((x) => ({
      t: Number(x.timestamp), o: +x.bid, h: +x.high, l: +x.low, c: +x.bid,
    })).filter((x) => Number.isFinite(x.t));
    resumo(linhas);
  } else console.log(`     ${r.txt.slice(0, 160)}`);
}
{
  const u = "https://api.frankfurter.dev/v1/2024-01-01..?base=USD&symbols=BRL";
  const r = await pegar(u);
  console.log(`\n  [frankfurter, so fechamento] http ${r.status} (${r.txt.length}b)`);
  if (r.ok) {
    const j = JSON.parse(r.txt);
    const ds = Object.keys(j.rates || {}).sort();
    console.log(`     ${ds.length} dias | ${ds[0]} -> ${ds[ds.length - 1]} | ultimo ${JSON.stringify(j.rates[ds[ds.length-1]])}`);
  } else console.log(`     ${r.txt.slice(0, 160)}`);
}
