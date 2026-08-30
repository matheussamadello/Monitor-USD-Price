// Sonda descartavel, rodada 4: caracterizar web-api.pyth.network/history.
async function pegar(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "usd-monitor-probe/1.0" } });
    return { ok: res.ok, status: res.status, txt: await res.text() };
  } catch (e) { return { ok: false, status: "EXC", txt: e.message }; }
}
const iso = (s) => (/[Zz]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");

console.log("###### ranges aceitos e granularidade ######");
for (const range of ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "5Y", "ALL", "MAX"]) {
  const u = `https://web-api.pyth.network/history?symbol=${encodeURIComponent("FX.USD/BRL")}&range=${range}&cluster=pythnet`;
  const r = await pegar(u);
  if (!r.ok) { console.log(`  ${range.padEnd(4)} http ${r.status} (${r.txt.length}b) ${r.txt.slice(0,90)}`); continue; }
  let j;
  try { j = JSON.parse(r.txt); } catch { console.log(`  ${range.padEnd(4)} corpo nao-JSON: ${r.txt.slice(0,90)}`); continue; }
  if (!Array.isArray(j) || !j.length) { console.log(`  ${range.padEnd(4)} 0 pontos (${r.txt.slice(0,90)})`); continue; }
  const ts = j.map((x) => Date.parse(iso(x.timestamp)) / 1000).sort((a, b) => a - b);
  const difs = [];
  for (let i = 1; i < ts.length; i++) difs.push(ts[i] - ts[i - 1]);
  difs.sort((a, b) => a - b);
  const passo = difs[Math.floor(difs.length / 2)];
  const dias = new Set(j.map((x) => x.timestamp.slice(0, 10))).size;
  const ohlcIguais = j.filter((x) => x.high_price === x.low_price).length;
  console.log(
    `  ${range.padEnd(4)} ${String(j.length).padStart(6)} pontos | ${new Date(ts[0]*1000).toISOString().slice(0,16)} -> ${new Date(ts[ts.length-1]*1000).toISOString().slice(0,16)}` +
    ` | passo mediano ${passo}s (${(passo/60).toFixed(0)}min) | ${dias} dias distintos | H==L em ${ohlcIguais}`
  );
}

console.log("\n###### o ponto mais antigo disponivel (profundidade do historico) ######");
{
  const r = await pegar(`https://web-api.pyth.network/history?symbol=${encodeURIComponent("FX.USD/BRL")}&range=ALL&cluster=pythnet`);
  if (r.ok) {
    try {
      const j = JSON.parse(r.txt);
      if (Array.isArray(j) && j.length) {
        const ts = j.map((x) => Date.parse(iso(x.timestamp))).sort((a, b) => a - b);
        const anos = (ts[ts.length-1] - ts[0]) / (365.25 * 864e5);
        console.log(`  ALL cobre ${anos.toFixed(2)} anos (${new Date(ts[0]).toISOString().slice(0,10)} -> ${new Date(ts[ts.length-1]).toISOString().slice(0,10)})`);
        console.log(`  semanas cobertas: ${Math.floor(anos*52)} (EMA89 semanal precisa de 89)`);
        console.log(`  amostra crua: ${JSON.stringify(j[j.length-1])}`);
      }
    } catch (e) { console.log("  parse falhou: " + e.message); }
  } else console.log(`  http ${r.status}`);
}
