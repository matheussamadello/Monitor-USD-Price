// Harness de fumaca: serve series sinteticas de USD/BRL nos dois
// formatos de fonte e confere que o relatorio sai inteiro.
import { build, relatorioParaJSON, parseYahoo, parseStooq, ancorarDia } from "./monitor.mjs";

const DIA = 86400;
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function serie(n, passo, base = 5.40) {
  const out = [];
  let p = base;
  // Comeca no passado e anda ate hoje, pulando fim de semana no diario.
  let t = Math.floor(Date.now() / 1000 / passo) * passo - n * passo;
  for (let i = 0; i < n; i++) {
    t += passo;
    if (passo === DIA) {
      const dow = new Date(t * 1000).getUTCDay();
      if (dow === 0 || dow === 6) continue; // cambio nao negocia fim de semana
    }
    const o = p;
    const var_ = (rnd() - 0.48) * 0.035;
    const c = Math.max(3, o + var_);
    const h = Math.max(o, c) + rnd() * 0.012;
    const l = Math.min(o, c) - rnd() * 0.012;
    out.push({ t: ancorarDia(t), o, h, l, c });
    p = c;
  }
  return out;
}

const diario = serie(900, DIA);
const semanal = serie(400, DIA * 7);
const porTf = { "1d": diario, "1wk": semanal, d: diario, w: semanal };

function respYahoo(rows) {
  return JSON.stringify({
    chart: {
      error: null,
      result: [{
        meta: { gmtoffset: 0 },
        timestamp: rows.map((r) => r.t),
        indicators: { quote: [{
          open: rows.map((r) => r.o), high: rows.map((r) => r.h),
          low: rows.map((r) => r.l), close: rows.map((r) => r.c),
          // Yahoo manda volume ZERO em cambio. E' exatamente este caso
          // que o monitor precisa NAO ler como "volume fraco".
          volume: rows.map(() => 0),
        }] },
      }],
    },
  });
}
function respStooq(rows) {
  return ["Date,Open,High,Low,Close"]
    .concat(rows.map((r) =>
      [new Date(r.t * 1000).toISOString().slice(0, 10),
       r.o.toFixed(4), r.h.toFixed(4), r.l.toFixed(4), r.c.toFixed(4)].join(",")))
    .join("\n");
}

function fakeFetch({ yahooOk = true, stooqOk = true, series = porTf } = {}) {
  const chamadas = [];
  const f = async (url) => {
    chamadas.push(url);
    if (url.includes("yahoo")) {
      const iv = url.match(/interval=([^&]+)/)[1];
      return yahooOk
        ? { ok: true, text: async () => respYahoo(series[iv]) }
        : { ok: false, status: 502, text: async () => "" };
    }
    const iv = url.match(/[?&]i=([^&]+)/)[1];
    return stooqOk
      ? { ok: true, text: async () => respStooq(series[iv]) }
      : { ok: false, status: 403, text: async () => "" };
  };
  f.chamadas = chamadas;
  return f;
}

// Fora do pregao o Yahoo acrescenta uma vela carimbada AGORA com o
// ultimo preco repetido nas quatro pontas. Reproduz esse caso: serie que
// termina alguns pregoes atras, mais o fantasma de hoje.
function comFantasma(rows, recuar) {
  const reais = rows.slice(0, -recuar);
  const ult = reais[reais.length - 1];
  return reais.concat([
    { t: ancorarDia(Math.floor(Date.now() / 1000)), o: ult.c, h: ult.c, l: ult.c, c: ult.c },
  ]);
}
const dia = (t) => new Date(t * 1000).toISOString().slice(0, 10);

let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FALHA") + "  " + msg); if (!cond) falhas++; };

async function cenario(nome, opts, checa) {
  console.log("\n== " + nome + " ==");
  const r = await build(fakeFetch(opts), {});
  checa(r);
  return r;
}

const r1 = await cenario("fonte primaria (Yahoo)", {}, (r) => {
  ok(!/FALHA:/.test(r.texto), "nenhum bloco em FALHA");
  ok(/fonte: OHLC de cambio \(diario=yahoo, semanal=yahoo\)/.test(r.texto), "cabecalho aponta yahoo");
  ok(!/NaN|undefined/.test(r.texto), "sem NaN/undefined no texto");
  ok(/^USD\/BRL$/m.test(r.texto), "bloco do par USD/BRL");
  ok(/volume_disponivel: nao/.test(r.texto), "volume declarado indisponivel");
  ok(!/volume_vs_media_pct|volume_classificacao|trades_vela_atual/.test(r.texto), "campos de volume fora do relatorio");
  ok(/vela_atual_em_formacao: (sim|nao)/.test(r.texto), "linha vela_atual_em_formacao");
  ok(/rsi14_fechado: \d/.test(r.texto), "RSI calculado");
  ok(/adx14_fechado: \d/.test(r.texto), "ADX calculado");
  ok(/ema89: \d/.test(r.texto), "EMA89 calculada");
  ok(/zonas_automaticas_total: \d/.test(r.texto) || /zonas_automaticas: nenhuma/.test(r.texto), "secao de zonas presente");
  ok(/preco_atual: \d\.\d{4}/.test(r.texto), "preco com 4 casas");
});

await cenario("fallback: Yahoo fora do ar", { yahooOk: false }, (r) => {
  ok(!/FALHA:/.test(r.texto), "Stooq assumiu, nenhum bloco em FALHA");
  ok(/fonte: OHLC de cambio \(diario=stooq, semanal=stooq\)/.test(r.texto), "cabecalho aponta stooq");
  ok(!/NaN|undefined/.test(r.texto), "sem NaN/undefined no texto");
});

await cenario("as duas fontes fora do ar", { yahooOk: false, stooqOk: false }, (r) => {
  ok(/FALHA:/.test(r.texto), "bloco marcado como FALHA");
  ok(/yahoo: HTTP 502/.test(r.texto) && /stooq: HTTP 403/.test(r.texto), "erro cita as duas fontes");
  ok(/fonte: OHLC de cambio \(diario=indisponivel/.test(r.texto), "cabecalho registra indisponibilidade");
});

await cenario("vela-fantasma de fim de semana", {
  series: { "1d": comFantasma(diario, 3), "1wk": comFantasma(semanal, 2) },
}, (r) => {
  const ultimoRealDiario = diario[diario.length - 4];
  ok(!/FALHA:/.test(r.texto), "relatorio sai inteiro");
  ok(
    new RegExp(`candle_atual_data: ${dia(ultimoRealDiario.t)}`).test(r.texto),
    "vela atual e' o ultimo pregao real, nao o fantasma de hoje"
  );
  ok(!new RegExp(`candle_atual_data: ${dia(ancorarDia(Math.floor(Date.now() / 1000)))}`).test(r.texto),
    "o fantasma de hoje nao aparece como vela atual");
  ok(/vela_atual_em_formacao: nao/.test(r.texto), "mercado fechado nao e' vela em formacao");
  ok(!/candle_atual_var_pct_desde_abertura: 0\.00\b/.test(r.texto),
    "preco atual nao e' o ultimo preco repetido nas quatro pontas");
});

console.log("\n== JSON ==");
const j = relatorioParaJSON(r1.texto, r1.zonas);
ok(j.diario["USD/BRL"] && typeof j.diario["USD/BRL"].preco_atual === "number", "JSON tem diario USD/BRL com preco numerico");
ok(j.semanal["USD/BRL"] && typeof j.semanal["USD/BRL"].rsi14_fechado === "number", "JSON tem semanal USD/BRL com RSI numerico");
ok(j.diario["USD/BRL"].volume_disponivel === "nao", "JSON marca volume_disponivel");
ok(Array.isArray(j.diario["USD/BRL"].alertas_tecnicos), "alertas_tecnicos vira lista");
ok(Array.isArray(j.gatilhos_ativos), "gatilhos_ativos vira lista");

console.log("\n== estado entre execucoes ==");
const r2 = await build(fakeFetch(), { niveis: r1.estadoNiveis, zonas: r1.zonasEstado, contadoresZona: r1.contadoresZona });
ok(!/NaN|undefined/.test(r2.texto), "segunda execucao le o estado anterior sem quebrar");

console.log("\n== ancoragem de fuso ==");
ok(ancorarDia(1756425600, 0) === 1756425600, "meia-noite UTC continua na propria data");
ok(ancorarDia(1756436400, -10800) === 1756425600, "carimbo em fuso -03 cai na data local, nao no dia seguinte");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo passou");
process.exit(falhas ? 1 : 0);
