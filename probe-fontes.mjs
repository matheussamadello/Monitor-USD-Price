// Sonda descartavel, rodada 3.
const fmt = (t) => new Date(t * 1000).toISOString().slice(0, 10);
async function pegar(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "usd-monitor-probe/1.0" } });
    const txt = await res.text();
    return { ok: res.ok, status: res.status, txt };
  } catch (e) { return { ok: false, status: "EXC", txt: e.message }; }
}

console.log("###### 1. Pyth: sobrou alguma rota de OHLC? ######");
for (const u of [
  "https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=Crypto.BTC/USD&resolution=1D&from=1756000000&to=1788056209",
  "https://benchmarks.pyth.network/v1/ohlc?symbol=FX.USD/BRL&resolution=1D",
  "https://benchmarks.pyth.network/v1/history?symbol=FX.USD/BRL&resolution=1D&from=1756000000&to=1788056209",
  "https://web-api.pyth.network/history?symbol=FX.USD/BRL&range=1M&cluster=pythnet",
]) {
  const r = await pegar(u);
  console.log(`  http ${r.status} (${r.txt.length}b) ${u.slice(0, 95)}`);
  if (r.ok) console.log(`     ${r.txt.slice(0, 220)}`);
}

console.log("\n###### 2. Yahoo espelho query2 (redundancia da primaria) ######");
for (const h of ["query1", "query2"]) {
  const r = await pegar(`https://${h}.finance.yahoo.com/v8/finance/chart/USDBRL=X?interval=1d&range=1mo`);
  let info = "";
  if (r.ok) {
    try {
      const x = JSON.parse(r.txt).chart.result[0];
      const q = x.indicators.quote[0];
      const n = x.timestamp.length;
      info = `${n} velas, ultima ${fmt(x.timestamp[n-1])} C=${q.close[n-1]}`;
    } catch (e) { info = "parse falhou: " + e.message; }
  }
  console.log(`  ${h}: http ${r.status} (${r.txt.length}b) ${info}`);
}

console.log("\n###### 3. PTAX do Banco Central (oficial, sem chave) ######");
{
  const u = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='01-01-2024'&@dataFinalCotacao='08-29-2026'&$top=100000&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim";
  const r = await pegar(u);
  console.log(`  http ${r.status} (${r.txt.length}b)`);
  if (r.ok) {
    const j = JSON.parse(r.txt);
    const v = j.value || [];
    console.log(`  registros: ${v.length}`);
    console.log(`  amostra: ${JSON.stringify(v[0])}`);
    console.log(`  ultimo:  ${JSON.stringify(v[v.length - 1])}`);
    const porDia = new Map();
    for (const x of v) {
      const d = x.dataHoraCotacao.slice(0, 10);
      const p = (x.cotacaoCompra + x.cotacaoVenda) / 2;
      const e = porDia.get(d) || { n: 0, hi: -1e9, lo: 1e9 };
      e.n++; e.hi = Math.max(e.hi, p); e.lo = Math.min(e.lo, p);
      porDia.set(d, e);
    }
    const dias = [...porDia.entries()].sort();
    const boletins = dias.map(([, e]) => e.n);
    const amp = dias.map(([, e]) => ((e.hi - e.lo) / e.lo) * 100);
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    console.log(`  dias uteis: ${dias.length} | ${dias[0][0]} -> ${dias[dias.length-1][0]}`);
    console.log(`  boletins/dia: mediana ${med(boletins)} (min ${Math.min(...boletins)}, max ${Math.max(...boletins)})`);
    console.log(`  amplitude diaria implicita: mediana ${med(amp).toFixed(3)}% (max ${Math.max(...amp).toFixed(3)}%)`);
    console.log("  ^ comparar com a amplitude REAL do Yahoo abaixo");
  }
}

console.log("\n###### 4. Amplitude real do Yahoo, para medir o quanto o PTAX subestima ######");
{
  const r = await pegar("https://query1.finance.yahoo.com/v8/finance/chart/USDBRL=X?interval=1d&range=1y");
  if (r.ok) {
    const x = JSON.parse(r.txt).chart.result[0];
    const q = x.indicators.quote[0];
    const amp = [];
    for (let i = 0; i < x.timestamp.length; i++) {
      if (Number.isFinite(q.high[i]) && Number.isFinite(q.low[i]) && q.low[i] > 0 && q.high[i] > q.low[i])
        amp.push(((q.high[i] - q.low[i]) / q.low[i]) * 100);
    }
    amp.sort((a, b) => a - b);
    console.log(`  ${amp.length} velas | amplitude mediana ${amp[Math.floor(amp.length/2)].toFixed(3)}%`);
  }
}
