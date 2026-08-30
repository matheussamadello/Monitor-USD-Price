// Harness de fumaca: serve series sinteticas de USD/BRL nos dois
// formatos de fonte e confere que o relatorio sai inteiro.
import { build, relatorioParaJSON, parseYahoo, ancorarDia, calcularTrilho } from "./monitor.mjs";

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
const porTf = { "1d": diario, "1wk": semanal };

// USDT/BRL negocia 24/7: nada de pular fim de semana. O premio sobre o
// dolar varia de proposito, para o percentil do trilho ter distribuicao
// de verdade em vez de uma constante.
function serieCripto(referencia, passo) {
  const porTempo = new Map(referencia.map((r) => [r.t, r]));
  const ini = referencia[0].t;
  const fim = referencia[referencia.length - 1].t + passo;
  const out = [];
  let ultimo = referencia[0].c;
  for (let t = ini; t <= fim; t += passo) {
    const r = porTempo.get(t);
    if (r) ultimo = r.c;
    const prem = 1 + ((rnd() - 0.35) * 2.5) / 100;
    const c = ultimo * prem;
    const o = c * (1 + (rnd() - 0.5) * 0.004);
    out.push({
      t,
      o,
      h: Math.max(o, c) * (1 + rnd() * 0.003),
      l: Math.min(o, c) * (1 - rnd() * 0.003),
      c,
      v: 20000 + rnd() * 40000,
      n: Math.floor(500 + rnd() * 2000),
    });
  }
  return out;
}

const usdtDiario = serieCripto(diario, DIA);
const usdtSemanal = serieCripto(semanal, DIA * 7);
const usdtPorTf = { "1d": usdtDiario, "1w": usdtSemanal };

function respBinance(rows) {
  return JSON.stringify(
    rows.map((r) => [r.t * 1000, r.o, r.h, r.l, r.c, r.v, 0, "0", r.n, "0", "0", "0"])
  );
}
function respMercadoBitcoin(rows) {
  return JSON.stringify({
    t: rows.map((r) => r.t),
    o: rows.map((r) => r.o),
    h: rows.map((r) => r.h),
    l: rows.map((r) => r.l),
    c: rows.map((r) => r.c),
    v: rows.map((r) => r.v),
  });
}

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
// hostsFora: quais hosts do Yahoo estao derrubados nesta simulacao.
function fakeFetch({
  hostsFora = [],
  series = porTf,
  seriesUsdt = usdtPorTf,
  usdtFora = [],
} = {}) {
  const chamadas = [];
  const f = async (url) => {
    chamadas.push(url);
    if (url.includes("binance")) {
      if (usdtFora.includes("binance")) {
        return { ok: false, status: 451, text: async () => "" };
      }
      const iv = url.match(/interval=([^&]+)/)[1];
      return { ok: true, text: async () => respBinance(seriesUsdt[iv]) };
    }
    if (url.includes("mercadobitcoin")) {
      if (usdtFora.includes("mercadobitcoin")) {
        return { ok: false, status: 503, text: async () => "" };
      }
      const iv = url.match(/resolution=([^&]+)/)[1];
      return { ok: true, text: async () => respMercadoBitcoin(seriesUsdt[iv]) };
    }
    const host = url.match(/https:\/\/([^.]+)\./)[1];
    if (hostsFora.includes(host)) {
      return { ok: false, status: host === "query1" ? 429 : 502, text: async () => "" };
    }
    const iv = url.match(/interval=([^&]+)/)[1];
    return { ok: true, text: async () => respYahoo(series[iv]) };
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

// Extrai o bloco de UM par dentro de UMA secao. Com dois pares na
// mesma secao, uma busca solta pelo texto inteiro confunde os dois.
function blocoDoPar(texto, secao, par) {
  const sec = texto.split(`========== ${secao} ==========`)[1];
  if (!sec) return "";
  const linhas = sec.split("\n==========")[0].split("\n");
  const i = linhas.findIndex((l) => l.trim() === par);
  if (i === -1) return "";
  let j = linhas.length;
  for (let k = i + 1; k < linhas.length; k++) {
    if (/^(USD\/BRL|USDT\/BRL)$/.test(linhas[k].trim())) { j = k; break; }
  }
  return linhas.slice(i, j).join("\n");
}

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
  ok(/fonte: USD\/BRL diario=yahoo\/query1 semanal=yahoo\/query1/.test(r.texto),
    "cabecalho aponta o host primario do cambio");
  ok(/USDT\/BRL diario=binance semanal=binance/.test(r.texto),
    "cabecalho aponta a fonte do par de cripto");
  ok(!/NaN|undefined/.test(r.texto), "sem NaN/undefined no texto");
  ok(/^USD\/BRL$/m.test(r.texto), "bloco do par USD/BRL");
  ok(/volume_disponivel: nao/.test(r.texto), "volume declarado indisponivel");
  const usdDia = blocoDoPar(r.texto, "GRAFICO DIARIO", "USD/BRL");
  const usdtDia = blocoDoPar(r.texto, "GRAFICO DIARIO", "USDT/BRL");
  ok(!/volume_vs_media_pct|volume_classificacao|trades_vela_atual/.test(usdDia),
    "USD/BRL: campos de volume fora do bloco");
  // O par de cripto e' o oposto: tem livro, tem tape, tem volume.
  ok(/volume_disponivel/.test(usdDia) && !/volume_disponivel/.test(usdtDia),
    "so o par de cambio declara volume indisponivel");
  ok(/volume_vs_media_pct: -?\d/.test(usdtDia), "USDT/BRL: volume comparado com a media");
  ok(/volume_classificacao: \w/.test(usdtDia), "USDT/BRL: volume classificado");
  ok(/trades_vela_atual: \d/.test(usdtDia), "USDT/BRL: numero de negocios publicado");
  ok(/rsi14_fechado: \d/.test(usdtDia) && /adx14_fechado: \d/.test(usdtDia),
    "USDT/BRL: RSI e ADX calculados");
  ok(/nivel_5_33_estado: /.test(usdtDia) && /nivel_5_16_estado: /.test(usdtDia),
    "USDT/BRL: maquina de niveis com os niveis DELE");
  ok(/zonas_automaticas_total: \d|zonas_automaticas: nenhuma/.test(usdtDia),
    "USDT/BRL: zonas automaticas calculadas");
  ok(/estrutura_preco: \w/.test(usdtDia), "USDT/BRL: estrutura de pivos");
  ok(/padrao_candles: /.test(usdtDia), "USDT/BRL: padroes de candle");
  ok(/vela_atual_em_formacao: (sim|nao)/.test(r.texto), "linha vela_atual_em_formacao");
  ok(/rsi14_fechado: \d/.test(r.texto), "RSI calculado");
  ok(/adx14_fechado: \d/.test(r.texto), "ADX calculado");
  ok(/ema89: \d/.test(r.texto), "EMA89 calculada");
  ok(/zonas_automaticas_total: \d/.test(r.texto) || /zonas_automaticas: nenhuma/.test(r.texto), "secao de zonas presente");
  ok(/preco_atual: \d\.\d{4}/.test(r.texto), "preco com 4 casas");
});

// O modo de falha que de fato acontece: um host da provedora limita ou
// bloqueia o IP do runner, e o outro continua servindo.
await cenario("host primario limitado (429)", { hostsFora: ["query1"] }, (r) => {
  ok(!/FALHA:/.test(r.texto), "o espelho assumiu, nenhum bloco em FALHA");
  ok(/fonte: USD\/BRL diario=yahoo\/query2 semanal=yahoo\/query2/.test(r.texto),
    "cabecalho aponta o espelho");
  ok(!/NaN|undefined/.test(r.texto), "sem NaN/undefined no texto");
});

await cenario("cascata inteira fora do ar", { hostsFora: ["query1", "query2"] }, (r) => {
  ok(/FALHA:/.test(r.texto), "bloco marcado como FALHA");
  ok(/yahoo\/query1: HTTP 429/.test(r.texto) && /yahoo\/query2: HTTP 502/.test(r.texto),
    "erro cita cada elo com seu proprio status");
  ok(/fonte: USD\/BRL diario=indisponivel semanal=indisponivel/.test(r.texto),
    "cabecalho registra indisponibilidade do cambio");
  ok(/USDT\/BRL diario=binance/.test(r.texto),
    "o par de cripto continua respondendo: as cascatas sao independentes");
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

await cenario("trilho de execucao (USDT/BRL)", {}, (r) => {
  ok(/^========== TRILHO DE EXECUCAO ==========$/m.test(r.texto), "secao propria no relatorio");
  ok(/trilho_disponivel: sim/.test(r.texto), "trilho disponivel");
  ok(/trilho_fonte: binance/.test(r.texto), "fonte primaria do trilho");
  ok(/trilho_premio_pct: -?\d+\.\d\d/.test(r.texto), "premio calculado");
  ok(/trilho_premio_classificacao: (caro|normal|barato)/.test(r.texto), "premio classificado");
  ok(/trilho_volume_usdt_ultimo_fechado: \d/.test(r.texto), "volume do trilho publicado (a cripto tem)");
  ok(/trilho_premio_comparavel: (sim|nao)/.test(r.texto), "premio diz se e' comparavel");
  ok(/trilho_usd_referencia_dia: \d{4}-\d\d-\d\d/.test(r.texto), "publica de que dia e' o dolar de referencia");
  // O trilho nao pode contaminar o par analisado.
  const diarioBloco = r.texto.split("========== GRAFICO DIARIO ==========")[1].split("==========")[0];
  ok(!/trilho_/.test(diarioBloco), "nenhum campo do trilho vazou para o bloco diario");
  ok(/volume_disponivel: nao/.test(diarioBloco), "USD/BRL continua sem volume");
});

await cenario("trilho: binance bloqueada, MB assume", { usdtFora: ["binance"] }, (r) => {
  ok(/trilho_disponivel: sim/.test(r.texto), "trilho continua disponivel");
  ok(/trilho_fonte: mercadobitcoin/.test(r.texto), "segunda provedora assumiu");
});

await cenario("trilho fora do ar nao derruba o relatorio", {
  usdtFora: ["binance", "mercadobitcoin"],
}, (r) => {
  ok(/trilho_disponivel: nao/.test(r.texto), "trilho marcado como indisponivel");
  ok(/binance: HTTP 451/.test(r.texto) && /mercadobitcoin: HTTP 503/.test(r.texto),
    "falha cita cada provedora");
  ok(/rsi14_fechado: \d/.test(r.texto), "o par analisado continua saindo inteiro");
  ok(/GATILHOS ATIVOS:/.test(r.texto), "gatilhos continuam sendo avaliados");
});

console.log("\n== trilho: aritmetica ==");
{
  // Premio conhecido: USDT 1% acima do dolar em toda a serie.
  const dias3 = [1, 2, 3].map((d) => ancorarDia(1756425600 + d * DIA));
  const usd = {
    times: dias3,
    closes: [5.0, 5.1, 5.2],
    live: { close: 5.2, time: dias3[2] },
  };
  const usdt = usd.times.map((t, i) => ({ time: t, close: usd.closes[i] * 1.01, volume: 100 }));
  const t = calcularTrilho(usdt, usd);
  ok(Math.abs(t.premioPct - 1) < 1e-9, `premio de 1% e' calculado como 1% (deu ${t.premioPct.toFixed(6)})`);
  ok(t.diasComparados === 3, "casou os tres dias por data");
  ok(t.classificacao === "caro", "premio no topo da propria distribuicao vira 'caro'");
  ok(t.defasagemDias === 0 && t.comparavel === true,
    "mesma data nas duas pontas e' comparavel");
}

console.log("\n== trilho: defasagem e volume parcial ==");
{
  // Domingo: o USDT ja andou dois dias, o dolar parou na sexta.
  const dias = [0, 1, 2, 3].map((d) => ancorarDia(1756425600 + d * DIA));
  const usd = { times: dias.slice(0, 2), closes: [5.0, 5.1], live: { close: 5.1, time: dias[1] } };
  const usdt = [
    { time: dias[0], close: 5.05, volume: 1000 },
    { time: dias[1], close: 5.15, volume: 1200 },
    { time: dias[2], close: 5.2, volume: 900 },
    // dia em formacao: poucas horas de giro
    { time: dias[3], close: 5.3, volume: 7 },
  ];
  const t = calcularTrilho(usdt, usd);
  ok(t.defasagemDias === 2, `defasagem medida em dias (deu ${t.defasagemDias})`);
  ok(t.comparavel === false, "com o cambio fechado, o premio nao e' comparavel");
  ok(t.volumeUltimoFechado === 900,
    `volume vem da ultima vela FECHADA, nao da que esta em formacao (deu ${t.volumeUltimoFechado})`);
  ok(t.volumeMediana30 === 1000,
    `mediana ignora a vela em formacao (deu ${t.volumeMediana30})`);
}

console.log("\n== JSON ==");
const j = relatorioParaJSON(r1.texto, r1.zonas);
ok(j.diario["USD/BRL"] && typeof j.diario["USD/BRL"].preco_atual === "number", "JSON tem diario USD/BRL com preco numerico");
ok(j.semanal["USD/BRL"] && typeof j.semanal["USD/BRL"].rsi14_fechado === "number", "JSON tem semanal USD/BRL com RSI numerico");
ok(j.diario["USD/BRL"].volume_disponivel === "nao", "JSON marca volume_disponivel");
ok(Array.isArray(j.diario["USD/BRL"].alertas_tecnicos), "alertas_tecnicos vira lista");
ok(Array.isArray(j.gatilhos_ativos), "gatilhos_ativos vira lista");
ok(j.trilho_execucao && typeof j.trilho_execucao.trilho_premio_pct === "number",
  "JSON tem trilho_execucao com premio numerico");
ok(j.trilho_execucao.trilho_par === "USDT/BRL", "JSON identifica o par do trilho");
ok(j.diario["USD/BRL"].trilho_premio_pct === undefined,
  "o trilho nao vazou para o bloco diario do JSON");
ok(j.diario["USDT/BRL"] && typeof j.diario["USDT/BRL"].rsi14_fechado === "number",
  "JSON tem o par USDT/BRL com indicadores");
ok(typeof j.diario["USDT/BRL"].volume_vs_media_pct === "number",
  "JSON traz volume real do USDT/BRL");
ok(j.diario["USDT/BRL"].niveis_manuais.faixas[0].label === "faixa_5_28_5_40",
  "cada par publica as SUAS faixas manuais");
ok(j.diario["USD/BRL"].niveis_manuais.faixas[0].label === "faixa_5_25_5_36",
  "as faixas do cambio nao foram trocadas pelas do cripto");

console.log("\n== estado entre execucoes ==");
const r2 = await build(fakeFetch(), { niveis: r1.estadoNiveis, zonas: r1.zonasEstado, contadoresZona: r1.contadoresZona });
ok(!/NaN|undefined/.test(r2.texto), "segunda execucao le o estado anterior sem quebrar");

console.log("\n== ancoragem de fuso ==");
ok(ancorarDia(1756425600, 0) === 1756425600, "meia-noite UTC continua na propria data");
ok(ancorarDia(1756436400, -10800) === 1756425600, "carimbo em fuso -03 cai na data local, nao no dia seguinte");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo passou");
process.exit(falhas ? 1 : 0);
