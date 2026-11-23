// TEMPORARIO (branch descartavel): codigo da main x novo, dia a dia, no
// historico inteiro de horas do Yahoo.
import { readFileSync, writeFileSync } from "node:fs";
const comuns = [
  ["const inicio = ultimaFechada ?? montadas.at(-1).time;", "const inicio = globalThis.__inicioDiag ?? (ultimaFechada ?? montadas.at(-1).time);"],
  ["if (dia >= inicio) throw new Error(", "if (dia >= inicio) if (globalThis.__falha) globalThis.__falha(dia, 'OHLC invalido'); else throw new Error("],
  ["        throw new Error(`Yahoo 1h: cobertura incompleta em ${fmtDia(l.time)} (sessao ausente)`);", "        { if (globalThis.__falha) globalThis.__falha(l.time, 'sessao ausente'); else throw new Error('x'); }"],
];
const versoes = {
  velho: ["../monitor.mjs", [
    ["if (referencias.length < 3) throw new Error(", "if (referencias.length < 3) if (globalThis.__falha) { globalThis.__falha(dia, 'sem referencias'); continue; } else throw new Error("],
    ["        throw new Error(`Yahoo 1h: cobertura incompleta em ${fmtDia(dia)} (hora ausente)`);", "        { if (globalThis.__falha) { globalThis.__falha(dia, 'hora ausente'); continue; } throw new Error('x'); }"],
  ]],
  novo: ["./monitor-novo.mjs", [
    ["if (janela) throw new Error(\"Yahoo 1h: cobertura recente", "if (janela) if (globalThis.__falha) globalThis.__falha(dia, 'sem referencias'); else throw new Error(\"Yahoo 1h: cobertura recente"],
    ["if (janela) throw new Error(`Yahoo 1h: cobertura incompleta em ${fmtDia(dia)} (hora ausente)`);", "if (janela) if (globalThis.__falha) globalThis.__falha(dia, 'hora ausente'); else throw new Error('x');"],
  ]],
};
const M = {};
for (const [nome, [arq, proprias]] of Object.entries(versoes)) {
  let src = readFileSync(new URL(arq, import.meta.url), "utf8");
  for (const [de, para] of [...comuns, ...proprias]) {
    if (src.split(de).length !== 2) throw new Error(`${nome}: padrao ${de.slice(0, 60)}`);
    src = src.replace(de, para);
  }
  writeFileSync(new URL(`../bt-${nome}.mjs`, import.meta.url), src);
  M[nome] = await import(`../bt-${nome}.mjs`);
}
const TF = Object.fromEntries(M.velho.TIMEFRAMES_TESTE.map((t) => [t.key, t]));
const UA = { headers: { "User-Agent": "usd-monitor/1.0" } };
const base = "https://query1.finance.yahoo.com/v8/finance/chart/USDBRL%3DX";
const h1 = await (await fetch(base + "?interval=1h&range=730d", UA)).text();
const d1 = await (await fetch(base + "?interval=1d&range=5y", UA)).text();
const w1 = await (await fetch(base + "?interval=1wk&range=10y", UA)).text();
const dt = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const r = JSON.parse(h1).chart.result[0], q = r.indicators.quote[0];
const mapa = new Map();
r.timestamp.forEach((t, i) => {
  const dia = t - (t % 86400), h = new Date(t * 1000).getUTCHours();
  if (!mapa.has(dia)) mapa.set(dia, Array(24).fill("."));
  const p = [q.open[i], q.high[i], q.low[i], q.close[i]];
  mapa.get(dia)[h] = p.every((v) => v == null) ? "n" : p[1] > p[2] ? "#" : "=";
});
const res = {};
for (const [nome, V] of Object.entries(M)) for (const tfk of ["diario", "semanal"]) {
  const f = new Map();
  globalThis.__falha = (d, m) => { if (!f.has(d)) f.set(d, m); };
  globalThis.__inicioDiag = Math.floor(r.timestamp[0] / 86400) * 86400 + 28 * 86400;
  let s, erro = "";
  try { s = V.parseYahooHibrido(tfk === "diario" ? [h1, d1] : [h1, w1, d1], TF[tfk]); } catch (e) { erro = e.message; }
  const av = (k) => ((s?.avisosDados || []).find((a) => a.includes(k)) || "").match(/\d{4}-\d\d-\d\d/g) || [];
  res[`${nome} ${tfk}`] = { f, red: new Set(av("sessao reduzida")), par: new Set(av("horas paradas")), erro };
}
for (const [k, v] of Object.entries(res)) {
  const por = {}; for (const m of v.f.values()) por[m] = (por[m] || 0) + 1;
  console.log(`${k}: falhas ${JSON.stringify(por)} reduzidas ${v.red.size} paradas ${v.par.size}${v.erro ? " ERRO " + v.erro : ""}`);
}
for (const tfk of ["diario", "semanal"]) {
  const a = res[`velho ${tfk}`], b = res[`novo ${tfk}`];
  const st = (x, d) => x.f.get(d) || (x.red.has(dt(d)) ? "reduzida" : x.par.has(dt(d)) ? "ok(parada)" : "ok");
  const todos = [...new Set([...mapa.keys()])].sort((x, y) => x - y).filter((d) => ![0, 6].includes(new Date(d * 1000).getUTCDay()));
  console.log(`\n== ${tfk}: dias que mudam`);
  for (const d of todos) {
    const x = st(a, d), y = st(b, d);
    if (x !== y) console.log(`${dt(d)} ${"DSTQQSS"[new Date(d * 1000).getUTCDay()]} ${x.padEnd(14)} -> ${y.padEnd(14)} ${mapa.get(d).join("")}`);
  }
  console.log(`== ${tfk}: continuam com hora ausente: ${[...b.f].filter(([, m]) => m === "hora ausente").map(([d]) => dt(d)).join(" ")}`);
  console.log(`== ${tfk}: outras falhas: ${[...b.f].filter(([, m]) => m !== "hora ausente").map(([d, m]) => dt(d) + " " + m).join(", ") || "nenhuma"}`);
}
