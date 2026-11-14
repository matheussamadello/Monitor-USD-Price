// Diagnostico temporario: horas do Yahoo nos feriados de 12/10 e 02/11
// (e semanas vizinhas), para entender a guarda de cobertura.
const url = (iv, rg) => `https://query1.finance.yahoo.com/v8/finance/chart/USDBRL%3DX?interval=${iv}&range=${rg}`;
const r = await fetch(url("1h", "60d"), { headers: { "User-Agent": "usd-monitor/1.0" } });
const j = (await r.json()).chart.result[0];
const q = j.indicators.quote[0];
const dias = {};
j.timestamp.forEach((t, i) => {
  const d = new Date(t * 1000); const dia = d.toISOString().slice(0, 10); const h = d.getUTCHours();
  if (![0, 6].includes(d.getUTCDay())) {
    const s = q.open[i] == null ? "n" : q.high[i] === q.low[i] ? "p" : "X";
    (dias[dia] ??= Array(24).fill(".")); dias[dia][h] = s;
  }
});
console.log("legenda: X negocio, p plana, n nula, . ausente; colunas = horas UTC 0..23");
for (const [d, hs] of Object.entries(dias)) if (d >= "2026-10-05" && d <= "2026-11-13") console.log(d, hs.join(""));
