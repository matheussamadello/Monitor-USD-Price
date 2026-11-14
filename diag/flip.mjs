// Diagnostico temporario: o fechamento de 2026-11-09 do USD/BRL alterna
// entre 5,5085 e 5,5069 de uma execucao para outra. Consulta as horas
// varias vezes nos dois hosts e mostra o que muda entre as respostas.
import * as m from "./monitor-atual.mjs";
const tf = m.TIMEFRAMES_TESTE.find((t) => t.key === "diario");
const UA = { headers: { "User-Agent": "usd-monitor/1.0" } };
const dias = ["2026-11-09", "2026-11-10", "2026-11-12"].map((d) => Date.parse(d + "T00:00:00Z") / 1000);
const f4 = (v) => (v == null ? "null" : v.toFixed(4));
for (let k = 0; k < 6; k++) {
  for (const host of ["query1", "query2"]) {
    const base = `https://${host}.finance.yahoo.com/v8/finance/chart/USDBRL%3DX`;
    try {
      const rh = await fetch(`${base}?interval=1h&range=730d`, UA);
      const th = await rh.text();
      const tl = await (await fetch(`${base}?interval=${tf.intervalos.yahoo}&range=${tf.yahooRange}`, UA)).text();
      const j = JSON.parse(th).chart.result[0];
      const q = j.indicators.quote[0];
      const r = m.parseYahooHibrido([th, tl], tf);
      const cab = [rh.headers.get("x-yahoo-request-id") || "", rh.headers.get("age") || "", rh.headers.get("date") || ""].join(" ");
      console.log(`\n#${k} ${host} ${j.timestamp.length} horas, ultima ${new Date(j.timestamp.at(-1) * 1000).toISOString()} | ${cab}`);
      for (const dia of dias) {
        const i = r.times.indexOf(dia);
        const horas = [];
        j.timestamp.forEach((t, x) => {
          if (t >= dia + 19 * 3600 && t < dia + 24 * 3600)
            horas.push(`${new Date(t * 1000).toISOString().slice(11, 16)} ${f4(q.open[x])}/${f4(q.high[x])}/${f4(q.low[x])}/${f4(q.close[x])} v${q.volume[x]}`);
        });
        console.log(`  ${new Date(dia * 1000).toISOString().slice(0, 10)} vela ${i < 0 ? "?" : [r.opens[i], r.highs[i], r.lows[i], r.closes[i]].map(f4).join("/")} | ${horas.join(" | ")}`);
      }
    } catch (e) {
      console.log(`#${k} ${host} erro ${e.message}`);
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
}
