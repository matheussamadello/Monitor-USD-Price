// Diagnostico temporario: horas planas (maxima = minima) do USD/BRL.
// Regra atual: toda hora plana fica fora da vela. Alternativa: hora plana
// com preco DIFERENTE do ultimo negocio aceito e' um negocio unico e entra.
const UA = { headers: { "User-Agent": "usd-monitor/1.0" } };
const j = (await (await fetch("https://query1.finance.yahoo.com/v8/finance/chart/USDBRL%3DX?interval=1h&range=730d", UA)).json()).chart.result[0];
const q = j.indicators.quote[0];
const barras = j.timestamp.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
  .filter((b) => [b.o, b.h, b.l, b.c].every((v) => typeof v === "number" && v > 0) && b.l <= b.h)
  .filter((b) => ![0, 6].includes(new Date(b.t * 1000).getUTCDay()));
const dia = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const hora = (t) => new Date(t * 1000).getUTCHours();
function velas(regra) {
  const v = new Map(); let ultimo = null;
  for (const b of barras) {
    const plana = b.h === b.l;
    const entra = !plana || (regra === "B" && ultimo !== null && Math.abs(b.c - ultimo) > 1e-9);
    if (!entra) continue;
    const d = dia(b.t);
    if (!v.has(d)) v.set(d, { o: plana ? b.c : b.o, h: b.h, l: b.l, c: b.c });
    else { const x = v.get(d); x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; }
    ultimo = b.c;
  }
  return v;
}
const A = velas("A"), B = velas("B");
const planas = barras.filter((b) => b.h === b.l);
let ant = null; const novas = [];
for (const b of barras) { if (b.h === b.l && ant !== null && Math.abs(b.c - ant) > 1e-9) novas.push(b); if (b.h !== b.l || (ant !== null && Math.abs(b.c - ant) > 1e-9)) ant = b.c; }
const porHora = (lista) => { const c = Array(24).fill(0); for (const b of lista) c[hora(b.t)]++; return c.join(" "); };
console.log(`horas: ${barras.length}, planas: ${planas.length}, planas com preco novo: ${novas.length}`);
console.log(`planas por hora UTC (0..23):          ${porHora(planas)}`);
console.log(`planas com preco novo por hora UTC:   ${porHora(novas)}`);
let difO = 0, difH = 0, difL = 0, difC = 0, so = [];
const maxRel = { o: 0, c: 0 };
for (const [d, a] of A) {
  const b = B.get(d); if (!b) continue;
  if (a.o !== b.o) { difO++; maxRel.o = Math.max(maxRel.o, Math.abs(a.o - b.o) / a.o); }
  if (a.h !== b.h) difH++;
  if (a.l !== b.l) difL++;
  if (a.c !== b.c) { difC++; maxRel.c = Math.max(maxRel.c, Math.abs(a.c - b.c) / a.c); }
  if (d >= "2026-09-01" && (a.o !== b.o || a.c !== b.c || a.h !== b.h || a.l !== b.l)) so.push(`${d} A ${a.o}/${a.h}/${a.l}/${a.c} B ${b.o}/${b.h}/${b.l}/${b.c}`);
}
console.log(`dias: ${A.size} | mudam: abertura ${difO}, maxima ${difH}, minima ${difL}, fechamento ${difC} | maior mudanca rel.: abertura ${(maxRel.o * 100).toFixed(3)}%, fechamento ${(maxRel.c * 100).toFixed(3)}%`);
console.log("diferencas desde 2026-09-01:"); for (const s of so) console.log("  " + s);
