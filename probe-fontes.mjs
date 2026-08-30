// Sonda descartavel: USDT/BRL como substituto de USD/BRL.
const fmt = (t) => new Date(t).toISOString().slice(0, 10);
async function pegar(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "usd-monitor-probe/1.0" } });
    return { ok: r.ok, status: r.status, txt: await r.text() };
  } catch (e) { return { ok: false, status: "EXC", txt: e.message }; }
}

console.log("###### 1. O par USDTBRL existe na Binance? ######");
{
  const r = await pegar("https://api.binance.com/api/v3/exchangeInfo?symbol=USDTBRL");
  console.log(`  http ${r.status}`);
  if (r.ok) {
    const s = JSON.parse(r.txt).symbols[0];
    console.log(`  ${s.symbol} status=${s.status} base=${s.baseAsset} quote=${s.quoteAsset}`);
  } else console.log(`  ${r.txt.slice(0, 200)}`);
}

console.log("\n###### 2. Klines: profundidade, volume, granularidade ######");
const serie = {};
for (const [iv, lim] of [["1d", 1000], ["1w", 1000]]) {
  const r = await pegar(`https://api.binance.com/api/v3/klines?symbol=USDTBRL&interval=${iv}&limit=${lim}`);
  if (!r.ok) { console.log(`  ${iv}: http ${r.status} ${r.txt.slice(0,150)}`); continue; }
  const k = JSON.parse(r.txt);
  const zero = k.filter((x) => +x[2] === +x[3]).length;
  const semVol = k.filter((x) => +x[5] === 0).length;
  console.log(
    `  ${iv}: ${k.length} velas | ${fmt(k[0][0])} -> ${fmt(k[k.length-1][0])} | ` +
    `ultima O=${k[k.length-1][1]} H=${k[k.length-1][2]} L=${k[k.length-1][3]} C=${k[k.length-1][4]} ` +
    `vol=${(+k[k.length-1][5]).toFixed(0)} trades=${k[k.length-1][8]} | amplitude-zero: ${zero} | volume-zero: ${semVol}`
  );
  serie[iv] = k;
}
if (serie["1w"]) {
  const anos = (serie["1w"][serie["1w"].length-1][0] - serie["1w"][0][0]) / (365.25*864e5);
  console.log(`  -> semanal cobre ${anos.toFixed(1)} anos, ${serie["1w"].length} velas (EMA89 precisa de 89)`);
}

console.log("\n###### 3. Premio do USDT/BRL sobre o USD/BRL (a pergunta que importa) ######");
{
  const y = await pegar("https://query1.finance.yahoo.com/v8/finance/chart/USDBRL=X?interval=1d&range=2y");
  if (!y.ok || !serie["1d"]) { console.log("  nao deu para comparar"); }
  else {
    const x = JSON.parse(y.txt).chart.result[0];
    const q = x.indicators.quote[0];
    const usd = new Map();
    for (let i = 0; i < x.timestamp.length; i++) {
      if (Number.isFinite(q.close[i]) && q.high[i] !== q.low[i])
        usd.set(fmt(x.timestamp[i] * 1000), q.close[i]);
    }
    const premios = [];
    for (const k of serie["1d"]) {
      const d = fmt(k[0]);
      const u = usd.get(d);
      if (u) premios.push({ d, p: ((+k[4] - u) / u) * 100, usdt: +k[4], usd: u });
    }
    if (!premios.length) { console.log("  nenhuma data em comum"); }
    else {
      const ps = premios.map((x) => x.p).sort((a, b) => a - b);
      const pct = (f) => ps[Math.floor(ps.length * f)].toFixed(2);
      const ult = premios[premios.length - 1];
      console.log(`  ${premios.length} dias comparaveis (${premios[0].d} -> ${ult.d})`);
      console.log(`  premio mediano: ${pct(0.5)}%`);
      console.log(`  faixa: p05 ${pct(0.05)}% | p25 ${pct(0.25)}% | p75 ${pct(0.75)}% | p95 ${pct(0.95)}%`);
      console.log(`  extremos: min ${ps[0].toFixed(2)}% | max ${ps[ps.length-1].toFixed(2)}%`);
      console.log(`  hoje: USDT/BRL ${ult.usdt} vs USD/BRL ${ult.usd.toFixed(4)} = ${ult.p.toFixed(2)}%`);
      // O que interessa para analise tecnica nao e' o nivel, e' se as
      // duas series ANDAM JUNTAS. Correlacao das variacoes diarias.
      const vs = [];
      for (let i = 1; i < premios.length; i++) {
        const a = (premios[i].usdt - premios[i-1].usdt) / premios[i-1].usdt;
        const b = (premios[i].usd - premios[i-1].usd) / premios[i-1].usd;
        if (Number.isFinite(a) && Number.isFinite(b)) vs.push([a, b]);
      }
      const m = (arr, j) => arr.reduce((s, x) => s + x[j], 0) / arr.length;
      const ma = m(vs, 0), mb = m(vs, 1);
      let num = 0, da = 0, db = 0;
      for (const [a, b] of vs) { num += (a-ma)*(b-mb); da += (a-ma)**2; db += (b-mb)**2; }
      console.log(`  correlacao das variacoes diarias: ${(num/Math.sqrt(da*db)).toFixed(4)} (n=${vs.length})`);
    }
  }
}
