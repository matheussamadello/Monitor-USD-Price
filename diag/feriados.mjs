// TEMPORARIO (branch descartavel): como os dias que a conferencia de horas
// bloqueia aparecem hora a hora, para desenhar o reconhecimento de feriado.
import { readFileSync, writeFileSync } from "node:fs";
let src = readFileSync(new URL("../monitor.mjs", import.meta.url), "utf8");
const troca = (de, para) => { if (src.split(de).length !== 2) throw new Error("padrao: " + de.slice(0, 60)); src = src.replace(de, para); };
troca("const inicio = ultimaFechada ?? montadas.at(-1).time;", "const inicio = globalThis.__inicioDiag ?? (ultimaFechada ?? montadas.at(-1).time);");
troca("if (dia >= inicio) throw new Error(", "if (dia >= inicio) if (globalThis.__falha) globalThis.__falha(dia, 'OHLC invalido'); else throw new Error(");
troca("if (referencias.length < 3) throw new Error(", "if (referencias.length < 3) if (globalThis.__falha) { globalThis.__falha(dia, 'sem referencias'); continue; } else throw new Error(");
troca("        throw new Error(`Yahoo 1h: cobertura incompleta em ${fmtDia(dia)} (hora ausente)`);", "        { if (globalThis.__falha) { globalThis.__falha(dia, 'hora ausente'); continue; } throw new Error('x'); }");
troca("        throw new Error(`Yahoo 1h: cobertura incompleta em ${fmtDia(l.time)} (sessao ausente)`);", "        { if (globalThis.__falha) globalThis.__falha(l.time, 'sessao ausente'); else throw new Error('x'); }");
troca("      const comNegocio = esperadas.filter((h) => negociadas.get(dia)?.has(h)).length;\n",
  "      const comNegocio = esperadas.filter((h) => negociadas.get(dia)?.has(h)).length;\n      globalThis.__diag?.({ dia, esperadas, comNegocio, amplitude: amplitudeSessao.get(dia), linha1d: sessoes.find((l) => l.time === dia), antes: sessoes.filter((l) => l.time < dia && l.time >= dia - 21 * 86400 && l.high > l.low).map((l) => l.high - l.low), reduzida: sessaoReduzida(dia) });\n");
writeFileSync(new URL("../bt-fer.mjs", import.meta.url), src);
const M = await import("../bt-fer.mjs");
const TF = Object.fromEntries(M.TIMEFRAMES_TESTE.map((t) => [t.key, t]));
const UA = { headers: { "User-Agent": "usd-monitor/1.0" } };
const base = "https://query1.finance.yahoo.com/v8/finance/chart/USDBRL%3DX";
const h1 = await (await fetch(base + "?interval=1h&range=730d", UA)).text();
const d1 = await (await fetch(base + "?interval=1d&range=5y", UA)).text();
const dt = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const r = JSON.parse(h1).chart.result[0], q = r.indicators.quote[0];
const porDia = new Map();
r.timestamp.forEach((t, i) => {
  const dia = t - (t % 86400), h = new Date(t * 1000).getUTCHours();
  const p = [q.open[i], q.high[i], q.low[i], q.close[i]];
  if (!porDia.has(dia)) porDia.set(dia, Array(24).fill(null));
  porDia.get(dia)[h] = p.every((v) => v == null) ? { c: "n" } : { c: p[1] > p[2] ? "#" : "=", o: p[0], h: p[1], l: p[2], f: p[3] };
});
const reg = new Map(), falhas = new Map();
globalThis.__diag = (x) => reg.set(x.dia, x);
globalThis.__falha = (d, m) => { if (!falhas.has(d)) falhas.set(d, m); };
globalThis.__inicioDiag = Math.floor(r.timestamp[0] / 86400) * 86400 + 28 * 86400;
const s = M.parseYahooHibrido([h1, d1], TF.diario);
const aviso = (k) => (s.avisosDados.find((a) => a.includes(k)) || "").match(/\d{4}-\d\d-\d\d/g) || [];
const reduz = new Set(aviso("sessao reduzida")), parad = new Set(aviso("horas paradas"));
const med = (xs) => { const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const f4 = (v) => (v == null ? "-" : v.toFixed(4));
function linha(dia, status) {
  const x = reg.get(dia), hs = porDia.get(dia) || [];
  const mapa = hs.map((v) => (v ? v.c : ".")).join("");
  const neg = hs.map((v, h) => [h, v]).filter(([, v]) => v && v.c === "#");
  const ult = neg.at(-1), hi = Math.max(...neg.map(([, v]) => v.h)), lo = Math.min(...neg.map(([, v]) => v.l));
  const depois = ult ? hs.slice(ult[0] + 1).map((v) => (v ? (v.c === "=" ? f4(v.f) : v.c) : ".")) : [];
  const planasDepois = [...new Set(depois.filter((v) => /\d/.test(v)))];
  const l1 = x?.linha1d, m21 = x ? med(x.antes) : NaN;
  const cabe = l1 && neg.length ? `1d ${f4(l1.low)}-${f4(l1.high)} horas ${f4(lo)}-${f4(hi)} fora ${f4(Math.max(0, l1.high - hi) + Math.max(0, lo - l1.low))}` : "-";
  const esp = x ? `${x.esperadas[0]}-${x.esperadas.at(-1)}` : "?";
  console.log(`${dt(dia)} ${"DSTQQSS"[new Date(dia * 1000).getUTCDay()]} ${status.padEnd(12)} ${mapa} esp=${esp} neg=${x?.comNegocio}/${x?.esperadas.length} amp=${f4(x?.amplitude)} med=${f4(m21)} | ${cabe} | ultneg=${ult ? ult[0] + "h " + f4(ult[1].f) : "-"} depois:${planasDepois.join("/") || "-"}`);
}
console.log("dia        sem status       000000000011111111112222");
const dias = [...reg.keys()].sort((a, b) => a - b);
let normaisPoucos = 0;
for (const d of dias) {
  const st = falhas.get(d) || (reduz.has(dt(d)) ? "reduzida" : parad.has(dt(d)) ? "ok(parada)" : "ok");
  const x = reg.get(d);
  if (st !== "ok") linha(d, st);
  else if (x.comNegocio * 2 < x.esperadas.length) { normaisPoucos++; linha(d, "ok-poucas"); }
}
console.log(`\ndias conferidos: ${dias.length}; ok com menos da metade negociada: ${normaisPoucos}`);
