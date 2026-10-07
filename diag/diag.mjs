// Diagnostico temporario: horas do Yahoo em volta do fechamento diario.
const url = (host, iv, rg) => `https://${host}.finance.yahoo.com/v8/finance/chart/USDBRL%3DX?interval=${iv}&range=${rg}`;
for (const host of ["query1", "query2"]) {
  const r = await fetch(url(host, "1h", "10d"), { headers: { "User-Agent": "usd-monitor/1.0" } });
  const j = (await r.json()).chart.result[0];
  console.log(`== ${host} 1h status ${r.status} gmtoffset=${j.meta.gmtoffset} tz=${j.meta.exchangeTimezoneName} regularMarketTime=${new Date(j.meta.regularMarketTime*1000).toISOString()} agora=${new Date().toISOString()}`);
  console.log("currentTradingPeriod", JSON.stringify(j.meta.currentTradingPeriod));
  const q = j.indicators.quote[0];
  j.timestamp.forEach((t, i) => {
    const iso = new Date(t * 1000).toISOString();
    if (iso >= "2026-10-05T18" && iso <= "2026-10-07T06")
      console.log(iso, "o", q.open[i], "h", q.high[i], "l", q.low[i], "c", q.close[i], "v", q.volume[i]);
  });
  const d = (await (await fetch(url(host, "1d", "10d"), { headers: { "User-Agent": "usd-monitor/1.0" } })).json()).chart.result[0];
  const qd = d.indicators.quote[0];
  d.timestamp.forEach((t, i) => console.log("1d", new Date(t * 1000).toISOString(), "o", qd.open[i], "h", qd.high[i], "l", qd.low[i], "c", qd.close[i]));
}
