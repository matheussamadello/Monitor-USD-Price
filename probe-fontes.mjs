// Sonda descartavel: quem serve USDT/BRL sem bloquear IP de runner.
const fmt = (t) => new Date(t).toISOString().slice(0, 10);
const agora = Math.floor(Date.now() / 1000);
const ANO = 31536000;
async function pegar(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "usd-monitor-probe/1.0" } });
    return { ok: r.ok, status: r.status, txt: await r.text() };
  } catch (e) { return { ok: false, status: "EXC", txt: e.message }; }
}
function resumo(nome, v) {
  if (!v.length) return console.log(`  ${nome}: 0 velas`);
  v.sort((a, b) => a.t - b.t);
  const u = v[v.length - 1];
  const anos = (u.t - v[0].t) / (365.25 * 864e5);
  console.log(
    `  ${nome}: ${v.length} velas | ${fmt(v[0].t)} -> ${fmt(u.t)} (${anos.toFixed(1)} anos) | ` +
    `ultima O=${u.o} H=${u.h} L=${u.l} C=${u.c} vol=${u.v ?? "--"} | ` +
    `amplitude-zero: ${v.filter((x) => x.h === x.l).length} | volume-zero: ${v.filter((x) => !x.v).length}`
  );
  return v;
}

const achados = {};

console.log("###### Binance via o mirror publico de dados ######");
for (const host of ["data-api.binance.vision", "api-gcp.binance.com"]) {
  const r = await pegar(`https://${host}/api/v3/klines?symbol=USDTBRL&interval=1d&limit=1000`);
  console.log(`  ${host}: http ${r.status} (${r.txt.length}b)`);
  if (r.ok) {
    try {
      const k = JSON.parse(r.txt);
      achados[host] = resumo(host, k.map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] })));
    } catch (e) { console.log(`     parse: ${e.message}`); }
  } else console.log(`     ${r.txt.slice(0, 130)}`);
}

console.log("\n###### Corretoras brasileiras ######");
{
  const u = `https://api.mercadobitcoin.net/api/v4/candles?symbol=USDT-BRL&resolution=1d&from=${agora - 4 * ANO}&to=${agora}`;
  const r = await pegar(u);
  console.log(`  mercadobitcoin: http ${r.status} (${r.txt.length}b)`);
  if (r.ok) {
    try {
      const j = JSON.parse(r.txt);
      achados.mb = resumo("mercadobitcoin", j.t.map((t, i) => ({ t: t * 1000, o: +j.o[i], h: +j.h[i], l: +j.l[i], c: +j.c[i], v: +j.v[i] })));
    } catch (e) { console.log(`     parse: ${e.message} | ${r.txt.slice(0,150)}`); }
  } else console.log(`     ${r.txt.slice(0, 130)}`);
}
{
  const r = await pegar("https://api.bitso.com/v3/available_books/");
  console.log(`  bitso available_books: http ${r.status}`);
  if (r.ok) {
    try {
      const livros = JSON.parse(r.txt).payload.map((b) => b.book).filter((b) => b.includes("brl"));
      console.log(`     livros com brl: ${livros.join(", ") || "nenhum"}`);
    } catch (e) { console.log(`     ${r.txt.slice(0, 150)}`); }
  }
}
{
  const r = await pegar("https://api.foxbit.com.br/rest/v3/markets/usdtbrl/candles?interval=1d&start_time=2024-01-01T00:00:00Z");
  console.log(`  foxbit: http ${r.status} (${r.txt.length}b) ${r.txt.slice(0, 130)}`);
}

console.log("\n###### Premio do USDT/BRL sobre o USD/BRL ######");
{
  const fonte = achados["data-api.binance.vision"] || achados["api-gcp.binance.com"] || achados.mb;
  const y = await pegar("https://query1.finance.yahoo.com/v8/finance/chart/USDBRL=X?interval=1d&range=2y");
  if (!fonte || !y.ok) console.log("  sem fonte de USDT/BRL para comparar");
  else {
    const x = JSON.parse(y.txt).chart.result[0];
    const q = x.indicators.quote[0];
    const usd = new Map();
    for (let i = 0; i < x.timestamp.length; i++)
      if (Number.isFinite(q.close[i]) && q.high[i] !== q.low[i]) usd.set(fmt(x.timestamp[i] * 1000), q.close[i]);
    const par = [];
    for (const k of fonte) { const u = usd.get(fmt(k.t)); if (u) par.push({ usdt: k.c, usd: u }); }
    if (!par.length) { console.log("  nenhuma data em comum"); }
    else {
    const ps = par.map((p) => ((p.usdt - p.usd) / p.usd) * 100).sort((a, b) => a - b);
    const P = (f) => ps[Math.floor(ps.length * f)].toFixed(2);
    const ult = par[par.length - 1];
    console.log(`  ${par.length} dias comparaveis`);
    console.log(`  premio mediano ${P(0.5)}% | p05 ${P(0.05)}% | p95 ${P(0.95)}% | min ${ps[0].toFixed(2)}% max ${ps[ps.length-1].toFixed(2)}%`);
    console.log(`  hoje: USDT/BRL ${ult.usdt} vs USD/BRL ${ult.usd.toFixed(4)}`);
    const vs = [];
    for (let i = 1; i < par.length; i++)
      vs.push([(par[i].usdt - par[i-1].usdt) / par[i-1].usdt, (par[i].usd - par[i-1].usd) / par[i-1].usd]);
    const m = (j) => vs.reduce((s, x) => s + x[j], 0) / vs.length;
    const ma = m(0), mb2 = m(1);
    let n = 0, da = 0, db = 0;
    for (const [a, b] of vs) { n += (a-ma)*(b-mb2); da += (a-ma)**2; db += (b-mb2)**2; }
    console.log(`  correlacao das variacoes diarias: ${(n/Math.sqrt(da*db)).toFixed(4)} (n=${vs.length})`);
    }
  }
}
