// Harness de fumaca: serve series sinteticas de USD/BRL nos dois
// formatos de fonte e confere que o relatorio sai inteiro.
import {
  build, relatorioParaJSON, toHTML, PARES_TESTE, TIMEFRAMES_TESTE, dmiSeries, rsiSeries, parseYahoo, ancorarDia, calcularTrilho, analisarVolume,
  situacaoNiveis, atualizarEstadoNivel, alertasTecnicos, sinteses, inicioSemana,
  acharPivos, classificarEstrutura, mudancaEstrutura, alinhamentoNiveis,
  registrarHistorico, entradaHistorico, assinaturaHistorico, leituraLonga, leituraCurta, EXPLICACOES, reconciliarAnteriores, atualizarCiclo, forcaTendencia, ondeNosNiveis, zonasCandidatas,
} from "./monitor.mjs";

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
// Mexe SO na ultima vela, a que esta em formacao. Tudo que ja fechou
// continua identico entre execucoes.
function soAVivaMudou(rows, fator) {
  if (!fator) return rows;
  const out = rows.slice();
  const v = { ...out[out.length - 1] };
  for (const k of ["o", "h", "l", "c"]) v[k] = v[k] * (1 + fator);
  out[out.length - 1] = v;
  return out;
}

function fakeFetch({
  hostsFora = [],
  series = porTf,
  seriesUsdt = usdtPorTf,
  usdtFora = [],
  mexerNaViva = 0,
} = {}) {
  const chamadas = [];
  const f = async (url) => {
    chamadas.push(url);
    if (url.includes("binance")) {
      if (usdtFora.includes("binance")) {
        return { ok: false, status: 451, text: async () => "" };
      }
      const iv = url.match(/interval=([^&]+)/)[1];
      return { ok: true, text: async () => respBinance(soAVivaMudou(seriesUsdt[iv], mexerNaViva)) };
    }
    if (url.includes("mercadobitcoin")) {
      if (usdtFora.includes("mercadobitcoin")) {
        return { ok: false, status: 503, text: async () => "" };
      }
      const iv = url.match(/resolution=([^&]+)/)[1];
      return {
        ok: true,
        text: async () => respMercadoBitcoin(soAVivaMudou(seriesUsdt[iv], mexerNaViva)),
      };
    }
    const host = url.match(/https:\/\/([^.]+)\./)[1];
    if (hostsFora.includes(host)) {
      return { ok: false, status: host === "query1" ? 429 : 502, text: async () => "" };
    }
    const iv = url.match(/interval=([^&]+)/)[1];
    return { ok: true, text: async () => respYahoo(soAVivaMudou(series[iv], mexerNaViva)) };
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
// A semana corrente chega em DOIS pedacos, como o Yahoo faz: seg-qua
// carimbado na segunda e a quinta carimbada na quinta. Juntos, os dois
// reconstroem exatamente a ultima barra da serie original.
function emPedacos(rows) {
  const reais = rows.slice(0, -1);
  const u = rows[rows.length - 1];
  const seg = inicioSemana(u.t);
  const meio = (u.o + u.c) / 2;
  return reais.concat([
    { t: seg, o: u.o, h: Math.max(u.o, meio) + 0.001, l: Math.min(u.o, meio) - 0.001, c: meio },
    { t: seg + 3 * DIA, o: meio, h: u.h, l: u.l, c: u.c },
  ]);
}
// Trecho de UM par dentro da linha "fonte:" do cabecalho. Procurar a
// string inteira cravaria a ordem dos pares no teste, e a ordem e'
// decisao de apresentacao -- ja mudou uma vez.
function fonteDoPar(texto, par) {
  const linha = (texto.match(/^fonte: .*$/m) || [""])[0];
  const m = new RegExp(`${par.replace("/", "\\/")} (diario=\\S+ semanal=\\S+)`).exec(linha);
  return m ? m[1] : null;
}
// Bloco de UM par dentro de UMA secao do relatorio textual.
function blocoTf(texto, secao, par) {
  const sec = (texto.split("========== " + secao + " ==========")[1] || "").split("\n==========")[0];
  const i = sec.indexOf("\n" + par + "\n");
  if (i === -1) return "";
  const resto = sec.slice(i + 1);
  const prox = resto.slice(1).search(/\n[A-Z0-9]+\/[A-Z]+\n/);
  return prox === -1 ? resto : resto.slice(0, prox + 1);
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
  ok(fonteDoPar(r.texto, "USD/BRL") === "diario=yahoo/query1 semanal=yahoo/query1",
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
  ok(/volume_referencia: ultima_vela_fechada/.test(usdtDia),
    "USDT/BRL: a classificacao declara que compara vela fechada");
  ok(/trades_vela_atual: \d/.test(usdtDia), "USDT/BRL: numero de negocios publicado");
  ok(/rsi_fechado: \d/.test(usdtDia) && /adx_fechado: \d/.test(usdtDia),
    "USDT/BRL: RSI e ADX calculados");
  ok(/nivel_5_31_estado: /.test(usdtDia) && /nivel_5_15_estado: /.test(usdtDia),
    "USDT/BRL: maquina de niveis com os niveis DELE");
  ok(/zonas_automaticas_total: \d|zonas_automaticas: nenhuma/.test(usdtDia),
    "USDT/BRL: zonas automaticas calculadas");
  ok(/estrutura_preco: \w/.test(usdtDia), "USDT/BRL: estrutura de pivos");
  ok(/padrao_candles: /.test(usdtDia), "USDT/BRL: padroes de candle");
  ok(/vela_atual_em_formacao: (sim|nao)/.test(r.texto), "linha vela_atual_em_formacao");
  ok(/rsi_fechado: \d/.test(r.texto), "RSI calculado");
  ok(/adx_fechado: \d/.test(r.texto), "ADX calculado");
  ok(/ema89: \d/.test(r.texto), "EMA89 calculada");
  ok(/atr14: \d/.test(r.texto) && /atr14_pct: \d/.test(r.texto), "ATR publicado em preco e em %");
  ok(/zonas_automaticas_total: \d/.test(r.texto) || /zonas_automaticas: nenhuma/.test(r.texto), "secao de zonas presente");
  ok(/preco_atual: \d\.\d{4}/.test(r.texto), "preco com 4 casas");
});

// O modo de falha que de fato acontece: um host da provedora limita ou
// bloqueia o IP do runner, e o outro continua servindo.
await cenario("host primario limitado (429)", { hostsFora: ["query1"] }, (r) => {
  ok(!/FALHA:/.test(r.texto), "o espelho assumiu, nenhum bloco em FALHA");
  ok(fonteDoPar(r.texto, "USD/BRL") === "diario=yahoo/query2 semanal=yahoo/query2",
    "cabecalho aponta o espelho");
  ok(!/NaN|undefined/.test(r.texto), "sem NaN/undefined no texto");
});

await cenario("cascata inteira fora do ar", { hostsFora: ["query1", "query2"] }, (r) => {
  ok(/FALHA:/.test(r.texto), "bloco marcado como FALHA");
  ok(/yahoo\/query1: HTTP 429/.test(r.texto) && /yahoo\/query2: HTTP 502/.test(r.texto),
    "erro cita cada elo com seu proprio status");
  ok(fonteDoPar(r.texto, "USD/BRL") === "diario=indisponivel semanal=indisponivel",
    "cabecalho registra indisponibilidade do cambio");
  ok(/USDT\/BRL diario=binance/.test(r.texto),
    "o par de cripto continua respondendo: as cascatas sao independentes");
});

await cenario("vela-fantasma de fim de semana", {
  series: { "1d": comFantasma(diario, 3), "1wk": comFantasma(semanal, 2) },
}, (r) => {
  const ultimoRealDiario = diario[diario.length - 4];
  ok(!/FALHA:/.test(r.texto), "relatorio sai inteiro");
  // ESCOPO POR PAR, de proposito. O USDT/BRL negocia 24/7, entao a vela
  // viva DELE pode ser legitimamente a de hoje -- procurar a data de
  // hoje no relatorio inteiro acusaria o par de cripto e falharia nos
  // dias em que as duas series se alinham. Foi o que aconteceu num
  // sabado, derrubando o job de publicar.
  const usdDia = blocoDoPar(r.texto, "GRAFICO DIARIO", "USD/BRL");
  ok(
    new RegExp(`candle_atual_data: ${dia(ultimoRealDiario.t)}`).test(usdDia),
    "vela atual e' o ultimo pregao real, nao o fantasma de hoje"
  );
  ok(!new RegExp(`candle_atual_data: ${dia(ancorarDia(Math.floor(Date.now() / 1000)))}`).test(usdDia),
    "o fantasma de hoje nao aparece como vela atual do par de cambio");
  ok(/vela_atual_em_formacao: nao/.test(r.texto), "mercado fechado nao e' vela em formacao");
  ok(!/candle_atual_var_pct_desde_abertura: 0\.00\b/.test(r.texto),
    "preco atual nao e' o ultimo preco repetido nas quatro pontas");
});

await cenario("semana em pedacos (Yahoo semanal)", {
  // Caso real de 2026-09-10, quinta: o Yahoo mandou a semana corrente
  // em DOIS pedacos -- seg-qua carimbado na segunda (07/09) e a quinta
  // carimbada na quinta (10/09). Cada carimbo virava vela propria: a
  // semana corrente saia como fechada com o fechamento de quarta, e
  // nascia uma "semana" de um dia. O filtro de amplitude zero nao pega,
  // porque o pedaco tem amplitude.
  series: { "1d": diario, "1wk": emPedacos(semanal) },
}, (r) => {
  const ult = semanal[semanal.length - 1];
  const seg = inicioSemana(ult.t);
  const segAnterior = inicioSemana(semanal[semanal.length - 2].t);
  const usdSem = blocoDoPar(r.texto, "GRAFICO SEMANAL", "USD/BRL");
  ok(!/FALHA:/.test(r.texto), "relatorio sai inteiro");
  ok(new RegExp(`candle_atual_data: ${dia(seg)}`).test(usdSem),
    "a vela semanal viva e' UMA, ancorada na segunda-feira");
  ok(!new RegExp(`candle_fechado_1: data=${dia(seg)}`).test(usdSem),
    "a semana corrente NAO aparece como fechada");
  ok(new RegExp(`ultimo_fechamento_data: ${dia(segAnterior)}`).test(usdSem),
    "a ultima fechada e' a semana anterior");
  ok(new RegExp(`candle_atual_open: ${ult.o.toFixed(4)}`).test(usdSem),
    "abertura da viva e' a do primeiro pedaco");
  ok(new RegExp(`candle_atual_close_provisorio: ${ult.c.toFixed(4)}`).test(usdSem),
    "fechamento provisorio e' o do ultimo pedaco");
  const usdtSem = blocoDoPar(r.texto, "GRAFICO SEMANAL", "USDT/BRL");
  ok(/candle_atual_data: \d{4}-\d{2}-\d{2}/.test(usdtSem), "o par de cripto (Binance, ja ancorado) continua normal");
});

console.log("\n== inicioSemana ==");
{
  const d = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000);
  ok(inicioSemana(d("2026-09-07")) === d("2026-09-07"), "segunda e' ela mesma");
  ok(inicioSemana(d("2026-09-10")) === d("2026-09-07"), "quinta cai na segunda da semana");
  ok(inicioSemana(d("2026-09-13")) === d("2026-09-07"), "domingo ainda e' a semana da segunda anterior");
  ok(inicioSemana(d("2026-09-14")) === d("2026-09-14"), "segunda seguinte comeca semana nova");
  ok(inicioSemana(d("1970-01-01")) === d("1969-12-29"), "funciona antes da epoca (modulo negativo)");
}

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
  ok(/rsi_fechado: \d/.test(r.texto), "o par analisado continua saindo inteiro");
  ok(/GATILHOS ATIVOS:/.test(r.texto), "gatilhos continuam sendo avaliados");
});

console.log("\n== volume: vela parcial nao classifica ==");
{
  // 20 dias fechados com giro ~1000 e um dia em formacao com 30. Antes,
  // os 30 eram comparados com a media de dias inteiros e davam -97%.
  const fechadas = new Array(20).fill(1000);
  const comParcial = analisarVolume(fechadas, 30);
  ok(Math.abs(comParcial.vsMediaPct) < 1e-9,
    `vela em formacao nao puxa a classificacao (vsMedia ${comParcial.vsMediaPct.toFixed(2)}%)`);
  ok(comParcial.classificacao === "normal",
    `20 dias iguais e' 'normal', nao 'contracao_forte' (deu ${comParcial.classificacao})`);
  ok(comParcial.atual === 30, "o volume da vela viva continua publicado, cru");

  // E uma seca DE VERDADE na ultima fechada continua sendo detectada.
  const seca = analisarVolume(fechadas.slice(0, 19).concat([100]), 5000);
  ok(seca.classificacao === "contracao_forte",
    `queda real na vela fechada ainda vira contracao_forte (deu ${seca.classificacao})`);
}

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


console.log("\n== vigilancia dos niveis manuais ==");
{
  const niveis = { faixas: [[100, 110, "faixa_100_110"], [80, 90, "faixa_80_90"]] };
  const dentro = situacaoNiveis(niveis, 105, 2);
  ok(dentro.situacao === "atual" && dentro.distanciaAtr === 0,
    `preco dentro de uma faixa e' 'atual' a 0 ATR (deu ${dentro.situacao})`);
  ok(dentro.faixa === "faixa_100_110", "aponta a faixa que contem o preco");

  const perto = situacaoNiveis(niveis, 111.5, 2); // 1.5 acima de 110 = 0,75 ATR
  ok(perto.situacao === "atual", `menos de 1 ATR fora ainda e' 'atual' (deu ${perto.situacao})`);

  const medio = situacaoNiveis(niveis, 114, 2); // 4 acima = 2 ATR
  ok(medio.situacao === "monitorar", `entre 1 e 3 ATR e' 'monitorar' (deu ${medio.situacao})`);

  // O caso real do XMR: preco 29% acima da faixa mais alta.
  const longe = situacaoNiveis(niveis, 128, 2); // 18 acima = 9 ATR
  ok(longe.situacao === "obsoleto", `mais de 3 ATR e' 'obsoleto' (deu ${longe.situacao})`);
  ok(Math.abs(longe.distanciaAtr - 9) < 1e-9, `distancia em ATR calculada (deu ${longe.distanciaAtr})`);

  // A distancia e' medida em ATR de proposito: o mesmo afastamento
  // percentual da leituras diferentes conforme a volatilidade do par.
  const volatil = situacaoNiveis(niveis, 128, 20);
  ok(volatil.situacao === "atual",
    "o mesmo afastamento num par muito mais volatil continua 'atual'");

  ok(situacaoNiveis({ faixas: [] }, 100, 2).situacao === "indefinida", "sem faixas, indefinida");
  ok(situacaoNiveis(niveis, 100, 0).situacao === "indefinida", "sem ATR, indefinida");
}

console.log("\n== afastado mede distancia, nao etapa do ciclo ==");
{
  // Nivel rompido para cima e deixado muito para tras: o bug antigo
  // publicava afastado: nao porque o estado era "rompido".
  const nivel = 100;
  const base = { nivel, direcao: "alta", tolPct: 0.5, resetPct: 3, maxCandles: 30, segundos: 86400 };
  const t0 = 1756425600;
  let e = atualizarEstadoNivel(null, { ...base, vela: { open: 101, close: 105, high: 106, low: 100.5, time: t0 } });
  ok(e && e.estado === "rompido", `rompimento reconhecido (deu ${e && e.estado})`);
  e = atualizarEstadoNivel(e, { ...base, vela: { open: 128, close: 130, high: 131, low: 127, time: t0 + 86400 } });
  ok(e.afastado === true, "nivel 30% para tras e' marcado como afastado mesmo em 'rompido'");
  e = atualizarEstadoNivel(e, { ...base, vela: { open: 101, close: 101.5, high: 102, low: 100.8, time: t0 + 2 * 86400 } });
  ok(e.afastado === false, "preco de volta perto do nivel desmarca o afastamento");
}


console.log("\n== a situacao dos niveis olha a vela FECHADA ==");
{
  // Duas execucoes identicas a nao ser pela vela EM FORMACAO. Se a
  // vigilancia usasse o preco vivo -- como usava na primeira versao --
  // a distancia mudaria. Usando o fechamento, nao pode mudar.
  const campo = (t, c) => {
    const m = t.match(new RegExp(`^${c}: (.+)$`, "m"));
    return m ? m[1] : null;
  };
  const normal = await build(fakeFetch(), {});
  const viva = await build(fakeFetch({ mexerNaViva: 0.25 }), {});

  ok(campo(viva.texto, "preco_atual") !== campo(normal.texto, "preco_atual"),
    "a vela em formacao de fato mudou de preco entre as duas execucoes");
  ok(campo(viva.texto, "ultimo_fechamento_close") === campo(normal.texto, "ultimo_fechamento_close"),
    "o ultimo fechamento continua o mesmo, como deve");
  ok(campo(viva.texto, "niveis_manuais_distancia_atr") === campo(normal.texto, "niveis_manuais_distancia_atr"),
    "a distancia ate a faixa manual NAO mudou: ela vem do fechamento");
  ok(campo(viva.texto, "niveis_manuais_situacao") === campo(normal.texto, "niveis_manuais_situacao"),
    "a situacao dos niveis tambem nao mudou");

  // A travessia da EMA89 e' o alerta mais caro do monitor: ela nao pode
  // depender da vela em formacao. A ultima assercao e' a contraprova --
  // o campo antigo em % E' do preco vivo, e por isso muda.
  ok(campo(viva.texto, "ema89_cruzamento_fechado") === campo(normal.texto, "ema89_cruzamento_fechado"),
    "o cruzamento da EMA89 NAO muda com a vela em formacao");
  ok(campo(viva.texto, "ema89_fechada_anterior") === campo(normal.texto, "ema89_fechada_anterior"),
    "a EMA89 do fechamento anterior tambem nao muda");
  ok(campo(viva.texto, "distancia_ema89_pct") !== campo(normal.texto, "distancia_ema89_pct"),
    "e o campo antigo em % continua sendo do preco vivo, como documentado");
}

console.log("\n== JSON ==");
const j = relatorioParaJSON(r1.texto, r1.zonas);
ok(j.diario["USD/BRL"] && typeof j.diario["USD/BRL"].preco_atual === "number", "JSON tem diario USD/BRL com preco numerico");
ok(j.semanal["USD/BRL"] && typeof j.semanal["USD/BRL"].rsi_fechado === "number", "JSON tem semanal USD/BRL com RSI numerico");
ok(j.diario["USD/BRL"].volume_disponivel === "nao", "JSON marca volume_disponivel");
ok(Array.isArray(j.diario["USD/BRL"].alertas_tecnicos), "alertas_tecnicos vira lista");
ok(Array.isArray(j.gatilhos_ativos), "gatilhos_ativos vira lista");
ok(j.trilho_execucao && typeof j.trilho_execucao.trilho_premio_pct === "number",
  "JSON tem trilho_execucao com premio numerico");
ok(j.trilho_execucao.trilho_par === "USDT/BRL", "JSON identifica o par do trilho");
ok(j.diario["USD/BRL"].trilho_premio_pct === undefined,
  "o trilho nao vazou para o bloco diario do JSON");
ok(j.diario["USDT/BRL"] && typeof j.diario["USDT/BRL"].rsi_fechado === "number",
  "JSON tem o par USDT/BRL com indicadores");
ok(typeof j.diario["USDT/BRL"].volume_vs_media_pct === "number",
  "JSON traz volume real do USDT/BRL");
ok(j.diario["USDT/BRL"].niveis_manuais.faixas[0].label === "faixa_5_27_5_35",
  "cada par publica as SUAS faixas manuais");
ok(j.diario["USD/BRL"].niveis_manuais.faixas[0].label === "faixa_5_25_5_36",
  "as faixas do cambio nao foram trocadas pelas do cripto");

console.log("\n== perda de suporte: corpo, nao so fechamento ==");
{
  // Caso real do XMR/USD em 2026-09-08: abriu 519,23 e fechou 499,77 com
  // suporte em 500. Fechou 0,05% abaixo, corpo inteiro em cima do nivel.
  // Saia como perda CONFIRMADA e alimentava deterioracao_tendencia; a
  // maquina de estados, que olha o corpo, dizia sem_registro. A
  // resistencia ja tinha a distincao forte/fraco; o suporte nao.
  const cfg = { niveis: { faixas: [], suporte: 500, suporteLabel: "500", resistencia: 550, resistenciaLabel: "550" } };
  const ind = {
    rsi: null, adx: null, adxAnt: null, diPlus: null, diMinus: null, crossUp: false, crossDown: false,
    divergencias: [], estruturaEventos: [], estruturaTendencia: null, volume: null,
    enfraquecimento: [], padroes: [], contextoTrio: null, mudancasNivel: [],
  };
  const vela = (open, close) => ({
    live: { close, high: Math.max(open, close), low: Math.min(open, close) },
    opens: [open], closes: [close],
  });
  const ctx = (alertas) => ({
    alertas, estrutura: { tendencia: null }, estruturaEventos: [], divergencias: [], vol: null,
    enfraquecimento: [], fraqueza: [], rsiFech: null, rsiAnt: null, diPlus: null, diMinus: null,
    estadosNivel: [],
  });

  const encostou = alertasTecnicos(cfg, vela(519.23, 499.77), ind);
  ok(encostou.includes("perda_suporte_confirmada_fraca_500"), "fechamento abaixo com corpo em cima e' perda FRACA");
  ok(!encostou.includes("perda_suporte_confirmada_500"), "e NAO e' perda confirmada");
  ok(sinteses(ctx(encostou)).deterioracao === "nenhuma", "perda fraca nao alimenta deterioracao_tendencia");
  ok(sinteses(ctx(encostou)).riscos.includes("suporte_sob_pressao"), "mas continua como risco: suporte sob pressao");

  const perdeu = alertasTecnicos(cfg, vela(498, 495), ind);
  ok(perdeu.includes("perda_suporte_confirmada_500"), "corpo inteiro abaixo e' perda confirmada");
  ok(sinteses(ctx(perdeu)).deterioracao.includes("perda_de_suporte_confirmada"), "e essa sim alimenta deterioracao");

  // A resistencia ja distinguia, mas a sintese por prefixo ignorava a
  // distincao: rompimento_confirmado_fraco_X comecava com
  // rompimento_confirmado e virava confluencia de entrada.
  const fraco = alertasTecnicos(cfg, vela(545, 552), ind);
  ok(fraco.includes("rompimento_confirmado_fraco_550"), "rompimento com corpo em baixo e' fraco");
  ok(!sinteses(ctx(fraco)).entrada.includes("rompimento_confirmado_por_fechamento"), "rompimento fraco NAO vira confluencia de entrada");
  const forte = alertasTecnicos(cfg, vela(551, 555), ind);
  ok(sinteses(ctx(forte)).entrada.includes("rompimento_confirmado_por_fechamento"), "rompimento forte continua virando");
}

console.log("\n== pagina HTML: o bloco do bot continua intacto ==");
{
  // O prompt usa a pagina como FALLBACK quando o relatorio.json nao
  // responde, e quem le procura linhas "campo: valor" no fonte. Tema,
  // cartoes e grafico sao moldura: o <pre> tem que sair com o relatorio
  // VERBATIM e sem uma tag no meio, ou o fallback quebra em silencio --
  // e so quando a fonte principal ja estiver fora do ar.
  const html = toHTML(r1.texto, relatorioParaJSON(r1.texto, r1.zonas));
  const pre = html.split("<pre>")[1].split("</pre>")[0];
  const esperado = r1.texto.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  ok(pre === esperado, "o <pre> traz o relatorio inteiro, byte a byte");
  ok(!/<[a-zA-Z\/]/.test(pre), "nenhuma tag dentro do <pre>");
  ok((pre.match(/^[a-z_0-9]+: /gm) || []).length > 50, "as linhas campo:valor continuam legiveis no fonte");
  ok(!/NaN|undefined/.test(html), "sem NaN/undefined na pagina");
  ok(/<article class="par"/.test(html), "os cartoes de par foram gerados");
  ok(html.indexOf("<pre>") > html.indexOf('<section class="pares">'),
    "o resumo vem antes do relatorio, e o relatorio fecha a pagina");

  // TEMA. O claro so redefine tokens; se alguem acrescentar um token de
  // cor no escuro e esquecer do claro, o tema claro herda uma cor de
  // fundo escuro em silencio -- e ninguem percebe ate abrir a pagina.
  const tokens = (bloco) => new Set((bloco.match(/--[a-z-]+(?=\s*:)/g) || []));
  const escuro = tokens(html.split(":root{")[1].split("}")[0]);
  const claro = tokens(html.split('html[data-tema="claro"]{')[1].split("}")[0]);
  const faltando = [...escuro].filter((t) => !claro.has(t) && t !== "--mono" && t !== "--bg-x");
  ok(escuro.size > 15, `o tema escuro define os tokens (${escuro.size})`);
  ok(faltando.length === 0, `o tema claro cobre todos os tokens do escuro${faltando.length ? ": faltam " + faltando.join(", ") : ""}`);
  // O script do topo decide o tema antes de qualquer pintura. Em vez de
  // conferir o TEXTO dele, roda o script de verdade com localStorage e
  // matchMedia falsos, nas combinacoes que importam.
  const scriptTema = html.split('<script id="tema-inicial">')[1].split("</script>")[0];
  const decidir = (salvo, soEscuro, matchMediaQuebrado) => {
    let attr = null;
    new Function("localStorage", "matchMedia", "document", scriptTema)(
      { getItem: () => salvo },
      matchMediaQuebrado
        ? () => { throw new Error("sem suporte"); }
        : () => ({ matches: soEscuro }),
      { documentElement: { setAttribute: (k, v) => { if (k === "data-tema") attr = v; } } }
    );
    return attr === "claro" ? "claro" : "noite";
  };
  ok(decidir(null, true) === "noite", "sem escolha e SO escuro -> noite");
  ok(decidir(null, false) === "claro", "sem escolha e SO claro -> claro");
  ok(decidir("noite", false) === "noite", "escolha salva 'noite' vence o SO claro");
  ok(decidir("claro", true) === "claro", "escolha salva 'claro' vence o SO escuro");
  ok(decidir(null, false, true) === "noite", "sem matchMedia, cai em noite");
  ok(/prefers-color-scheme/.test(scriptTema), "o padrao consulta o prefers-color-scheme");
  ok(!/getHours|Date\(/.test(scriptTema), "e nao decide por horario");
  ok(/id="btn-tema"/.test(html), "o botao de alternar continua na pagina");

  // ATR e EMA89 no cartao mudaram de APRESENTACAO. O que a mudanca nao
  // pode ter feito e' sumir com os campos do relatorio: o prompt decide
  // por eles (0,25 ATR na travessia semanal, 1,0 ATR na corroboracao).
  ok(/^atr14: [\d.]+$/m.test(r1.texto) && /^atr14_pct: [\d.]+$/m.test(r1.texto),
    "relatorio segue publicando atr14 e atr14_pct");
  ok(/^distancia_ema89_fechada_atr: [\d.]+$/m.test(r1.texto),
    "relatorio segue publicando a distancia da EMA89 em ATR");
  ok(!/<dt>ATR\(14\)<\/dt>/.test(html), "o cartao nao tem mais linha de ATR");
  ok(/<dt>ADX \/ DI \(28\/42\)<\/dt>/.test(html) && /<dt>ADX \/ DI \(14\/21\)<\/dt>/.test(html),
    "o cartao rotula cada timeframe com os SEUS periodos de DMI");
  // So faz sentido onde ha widget (par com cartao e grafico).
  if (/s3\.tradingview\.com\/tv\.js/.test(html))
    ok(/MAExp@tv-basicstudies[^}]*length:89/.test(html), "o widget do TradingView pede a EMA de periodo 89");
  if (/s3\.tradingview\.com\/tv\.js/.test(html)) {
    ok(/\{id:"RSI@tv-basicstudies",inputs:\{[^}]*smoothingLine:"None"/.test(html),
      "pede o RSI como objeto, com a media do RSI desligada");
    // O grafico abre no diario e troca para o semanal pelos botoes. Em
    // cada intervalo o RSI tem de bater com o do cartao daquele
    // timeframe. Derivado, nunca cravado: a tabela sai da configuracao.
    const diarioTf = TIMEFRAMES_TESTE.find((t) => t.key === "diario");
    const semanalTf = TIMEFRAMES_TESTE.find((t) => t.key === "semanal");
    ok(html.includes(
      `window.rsiPorIntervalo={"D":${diarioTf.rsi.length},"W":${semanalTf.rsi.length}}`),
      `a tabela do grafico casa D com o RSI do diario (${diarioTf.rsi.length}) ` +
      `e W com o do semanal (${semanalTf.rsi.length})`);
    ok(html.includes('{id:"RSI@tv-basicstudies",inputs:{length:rsi,'),
      "e o widget le o RSI dessa tabela, em vez de um periodo cravado");
    ok(/interval:iv,/.test(html) && /var iv=window\.intervaloGrafico,rsi=window\.rsiPorIntervalo\[iv\]/.test(html),
      "intervalo e RSI saem da mesma variavel: nao tem como um andar sem o outro");
    ok(/data-tf="D"/.test(html) && /data-tf="W"/.test(html),
      "a barra do grafico oferece os dois timeframes");
    ok(/\{id:"MAExp@tv-basicstudies",inputs:\{length:89\}\}/.test(html),
      "e a EMA do grafico usa 89, como o relatorio");
    ok(!/"RSI@tv-basicstudies"\s*[\]}]/.test(html), "e nunca como string solta, que o widget descartava");
  }

  // O script do widget e' montado por concatenacao de strings: um erro
  // de digitacao so apareceria no navegador. Entao roda de verdade, com
  // TradingView e DOM falsos, e confere o que o widget recebeu.
  if (/s3\.tradingview\.com\/tv\.js/.test(html)) {
    const scriptTv = html.split("window.rsiPorIntervalo=")[1].split("</script>")[0];
    const pedidos = [];
    const botoes = ["D", "W"].map((tf) => ({
      tf,
      pressed: tf === "D" ? "true" : "false",
      classList: { contains: (c) => c === "tv-tf" },
      getAttribute: (k) => (k === "data-tf" ? tf : null),
      setAttribute: (k, v) => { if (k === "aria-pressed") botoes.find((b) => b.tf === tf).pressed = v; },
    }));
    const doc = {
      getElementById: (id) => ({ id, innerHTML: "" }),
      querySelectorAll: () => botoes,
    };
    const TradingViewFalso = { widget: function (o) { pedidos.push(o); } };
    const janela = { TradingView: TradingViewFalso };
    // O script usa "TradingView" solto, que no navegador resolve pelo
    // objeto global; aqui entra como parametro.
    new Function("window", "document", "TradingView", "window.rsiPorIntervalo=" + scriptTv)(
      janela, doc, TradingViewFalso);

    const diaTf = TIMEFRAMES_TESTE.find((t) => t.key === "diario");
    const semTf = TIMEFRAMES_TESTE.find((t) => t.key === "semanal");
    const rsiDe = (o) => o.studies.find((e) => e.id === "RSI@tv-basicstudies").inputs.length;

    janela.desenharGraficos("dark");
    ok(pedidos.length > 0 && pedidos.every((o) => o.interval === "D"),
      "ao abrir, o widget pede o diario");
    ok(pedidos.every((o) => rsiDe(o) === diaTf.rsi.length),
      `e o RSI dele e' o do cartao diario (${diaTf.rsi.length})`);

    pedidos.length = 0;
    janela.desenharGraficos("dark", "W");
    ok(pedidos.length > 0 && pedidos.every((o) => o.interval === "W"),
      "trocando para semanal, o widget pede o semanal");
    ok(pedidos.every((o) => rsiDe(o) === semTf.rsi.length),
      `e o RSI acompanha, virando o do cartao semanal (${semTf.rsi.length})`);
    ok(botoes.find((b) => b.tf === "W").pressed === "true" &&
      botoes.find((b) => b.tf === "D").pressed === "false",
      "e a barra marca qual timeframe esta valendo");

    pedidos.length = 0;
    janela.desenharGraficos("light");
    ok(pedidos.every((o) => o.interval === "W" && rsiDe(o) === semTf.rsi.length),
      "trocar o TEMA nao devolve o grafico para o diario");
    ok(pedidos.every((o) => o.studies.some(
      (e) => e.id === "MAExp@tv-basicstudies" && e.inputs.length === 89)),
      "e a EMA89 continua nos dois intervalos, por nao ser por timeframe");
  }
  ok(!/<dt>EMA89 \(fechado\)<\/dt><dd[^>]*>[^<]*<small>[^<]*ATR</.test(html),
    "cartao nao mostra mais a distancia da EMA89 em ATR");
  ok(/<dt>EMA89 \(fechado\)<\/dt><dd[^>]*>(acima|abaixo)<small>[\d.,]+%<\/small>/.test(html),
    "cartao mostra o lado da EMA89 e a distancia em %");
  ok(/<svg class="lua"/.test(html) && /<svg class="sol"/.test(html), "os dois icones do botao estao no HTML");
  ok(/aria-label="Alternar night mode"/.test(html), "o botao sem texto mantem nome acessivel");
  ok(html.indexOf('localStorage.getItem("tema")') < html.indexOf("<body"),
    "o tema salvo e' aplicado ANTES do <body>, sem flash escuro");

  // A ordem dos blocos no relatorio segue a ordem da configuracao, e o
  // painel mostra so os pares com cartao. Par secundario continua
  // inteiro no relatorio -- deixar de ter cartao nao e' deixar de sair.
  const secDia = r1.texto.split("========== GRAFICO DIARIO ==========")[1].split("==========")[0];
  const posicoes = PARES_TESTE.map((c) => secDia.indexOf(`\n${c.label}\n`));
  ok(posicoes.every((v, i) => v >= 0 && (i === 0 || v > posicoes[i - 1])),
    `os blocos saem na ordem da configuracao: ${PARES_TESTE.map((c) => c.label).join(" -> ")}`);

  for (const c of PARES_TESTE) {
    const temCartao = !c.semCartao;
    ok(html.includes(`<h2>${c.label}</h2>`) === temCartao,
      `${c.label}: ${temCartao ? "tem" : "NAO tem"} cartao no painel`);
    ok(pre.includes(`\n${c.label}\n`), `${c.label}: sai inteiro no relatorio completo`);
    if (c.grafico)
      ok(typeof c.graficoNota === "string" && c.graficoNota.length > 20,
        `${c.label}: grafico ${c.grafico} tem nota de fonte`);
    // O grafico mora DENTRO do cartao: sem cartao nao pode sobrar
    // container, nem widget apontando para um container que nao existe.
    ok(html.includes(`id="tv-${c.key}"`) === Boolean(c.grafico && temCartao),
      `${c.label}: container do grafico ${c.grafico && temCartao ? "presente" : "ausente"}, como deve`);
  }
}


console.log("\n== DMI/ADX: periodos por timeframe ==");
{
  // Ate 2026-09-11 havia UM periodo (14) servindo de DI Length e de ADX
  // Smoothing, nos dois timeframes. Agora sao dois parametros e uma
  // configuracao por timeframe: diario 28/42 (leitura operacional de
  // swing/position), semanal 14/21 (contexto de prazo maior).

  // 1. COMPATIBILIDADE. Chamar com (14, 14) tem de reproduzir exatamente
  //    o que a versao de um parametro so produzia: e' o que garante que
  //    o refactor nao mexeu no metodo de Wilder, so nos periodos.
  const h = [], l = [], c = [];
  let p = 100;
  for (let i = 0; i < 300; i++) {
    p = p * (1 + (rnd() - 0.48) * 0.03);
    h.push(p * 1.01); l.push(p * 0.99); c.push(p);
  }
  const u = c.length - 1;
  const padrao = dmiSeries(h, l, c);
  const explicito = dmiSeries(h, l, c, 14, 14);
  ok(padrao.adx[u] === explicito.adx[u] && padrao.plusDI[u] === explicito.plusDI[u],
    "dmiSeries(14,14) reproduz exatamente o comportamento de antes");

  // 2. OS DOIS PARAMETROS SAO INDEPENDENTES. Mudar so o alisamento do ADX
  //    muda o ADX e NAO pode mexer nos DIs, que dependem so do diLen.
  const so28 = dmiSeries(h, l, c, 28, 28);
  const d2842 = dmiSeries(h, l, c, 28, 42);
  ok(so28.plusDI[u] === d2842.plusDI[u] && so28.minusDI[u] === d2842.minusDI[u],
    "adxLen nao afeta os DIs: eles dependem so do diLen");
  ok(so28.adx[u] !== d2842.adx[u], "mas afeta o ADX, como deve");
  ok(d2842.plusDI[u] !== padrao.plusDI[u], "e diLen 28 da DIs diferentes do 14");

  // 3. ADX MAIS ALISADO OSCILA MENOS -- o objetivo da mudanca.
  const varia = (s) => {
    let soma = 0, n = 0;
    for (let i = 200; i < s.length; i++)
      if (s[i] !== null && s[i - 1] !== null) { soma += Math.abs(s[i] - s[i - 1]); n++; }
    return n ? soma / n : 0;
  };
  ok(varia(d2842.adx) < varia(padrao.adx),
    "ADX com alisamento 42 varia menos de vela para vela que o de 14");

  // 4. SERIE CURTA nao quebra: sai null, que o relatorio publica como
  //    "--", nunca NaN.
  const curto = dmiSeries(h.slice(0, 40), l.slice(0, 40), c.slice(0, 40), 28, 42);
  ok(curto.adx.every((v) => v === null), "serie curta demais devolve ADX null, nao NaN");
}

console.log("\n== DMI/ADX: o relatorio declara a configuracao usada ==");
{
  const cfgDe = (t) => {
    const di = /dmi_di_length: (\d+)/.exec(t);
    const ad = /dmi_adx_smoothing: (\d+)/.exec(t);
    return di && ad ? di[1] + "/" + ad[1] : null;
  };
  const par = PARES_TESTE[0].label;
  const diaBloco = blocoTf(r1.texto, "GRAFICO DIARIO", par);
  const semBloco = blocoTf(r1.texto, "GRAFICO SEMANAL", par);
  ok(cfgDe(diaBloco) === "28/42", "bloco diario declara DMI 28/42");
  ok(cfgDe(semBloco) === "14/21", "bloco semanal declara DMI 14/21");
  ok(/indicadores:.*diario 28\/42, semanal 14\/21/.test(r1.texto),
    "o cabecalho lista os periodos de cada timeframe");
  ok(!/adx14_fechado|di_plus14_|di_minus14_/.test(r1.texto),
    "os campos perderam o '14' do nome, que virou mentira no diario");

  const adxDe = (t) => (/adx_fechado: ([\d.]+)/.exec(t) || [])[1];
  ok(adxDe(diaBloco) !== adxDe(semBloco),
    "diario e semanal publicam ADX distintos: as configuracoes nao se misturam");
}


console.log("\n== RSI: periodo por timeframe ==");
{
  // Ate 2026-09-11 o RSI usava 14 nos dois timeframes, por herdar o
  // default de PERIOD. Agora: diario 21, semanal 14. O metodo nao mudou
  // -- Wilder/RMA --, so o periodo, e rsiSeries ja aceitava o parametro:
  // eram os call sites que nao passavam.
  const c = [];
  let p = 100;
  for (let i = 0; i < 300; i++) { p = p * (1 + (rnd() - 0.48) * 0.03); c.push(p); }
  const u = c.length - 1;

  const r14 = rsiSeries(c);
  const r14x = rsiSeries(c, 14);
  ok(r14[u] === r14x[u], "rsiSeries(c, 14) reproduz exatamente o default de antes");

  const r21 = rsiSeries(c, 21);
  ok(r21[u] !== r14[u], "periodo 21 produz RSI diferente do 14");

  // O objetivo da troca: menos oscilacao vela a vela no diario.
  const varia = (s) => {
    let soma = 0, n = 0;
    for (let i = 100; i < s.length; i++)
      if (s[i] !== null && s[i - 1] !== null) { soma += Math.abs(s[i] - s[i - 1]); n++; }
    return n ? soma / n : 0;
  };
  ok(varia(r21) < varia(r14), "RSI(21) varia menos de vela para vela que o RSI(14)");

  // E a relacao que o usuario pediu para preservar: o RSI tem de
  // continuar MAIS responsivo que o DMI do mesmo timeframe.
  const dia = TIMEFRAMES_TESTE.find((t) => t.key === "diario");
  const sem = TIMEFRAMES_TESTE.find((t) => t.key === "semanal");
  ok(dia.rsi.length === 21 && dia.dmi.diLen === 28, "diario: RSI 21 contra DMI 28");
  ok(sem.rsi.length === 14 && sem.dmi.diLen === 14, "semanal: RSI 14 contra DMI 14");
  ok(dia.rsi.length < dia.dmi.adxLen && sem.rsi.length < sem.dmi.adxLen,
    "em cada timeframe o RSI e' mais curto que o alisamento do ADX");

  const curto = rsiSeries(c.slice(0, 10), 21);
  ok(curto.every((v) => v === null), "serie curta demais devolve RSI null, nao NaN");
}

console.log("\n== RSI: o relatorio declara o periodo usado ==");
{
  const par = PARES_TESTE[0].label;
  const lenDe = (t) => (/rsi_length: (\d+)/.exec(t) || [])[1];
  const diaBloco = blocoTf(r1.texto, "GRAFICO DIARIO", par);
  const semBloco = blocoTf(r1.texto, "GRAFICO SEMANAL", par);
  ok(lenDe(diaBloco) === "21", "bloco diario declara rsi_length 21");
  ok(lenDe(semBloco) === "14", "bloco semanal declara rsi_length 14");
  ok(/indicadores:.*RSI diario 21, semanal 14/.test(r1.texto),
    "o cabecalho lista o periodo de RSI de cada timeframe");
  ok(!/rsi14_fechado|rsi14_provisorio/.test(r1.texto),
    "os campos perderam o '14' do nome, que virou mentira no diario");

  const rsiDe = (t) => (/rsi_fechado: ([\d.]+)/.exec(t) || [])[1];
  ok(rsiDe(diaBloco) !== rsiDe(semBloco),
    "diario e semanal publicam RSI distintos: os periodos nao se misturam");
}

// ------------------------------------------------------------
// Estrutura de mercado: rotulos e eventos
// ------------------------------------------------------------
console.log("\n== estrutura: os cinco valores tem nomes distintos ==");
{
  // Zigue-zague com pernas longas o bastante para cada virada ser um
  // extremo local estrito, e pivos 2/2 para o teste nao depender do
  // fractal configurado por timeframe.
  const zig = (pontos, porPerna = 6) => {
    const v = [];
    for (let i = 0; i < pontos.length - 1; i++)
      for (let k = 0; k < porPerna; k++)
        v.push(pontos[i] + ((pontos[i + 1] - pontos[i]) * k) / porPerna);
    v.push(pontos[pontos.length - 1]);
    return { highs: v.map((x) => x + 0.5), lows: v.map((x) => x - 0.5) };
  };
  const rotulo = (pontos) => {
    const z = zig(pontos);
    return classificarEstrutura(z.highs, z.lows, acharPivos(z.highs, z.lows, 2, 2));
  };
  const alta = rotulo([90, 80, 100, 88, 130, 110]);
  const baixa = rotulo([140, 90, 130, 70, 100, 85]);
  const contr = rotulo([140, 60, 130, 70, 100, 85]);
  const expan = rotulo([105, 95, 110, 60, 130, 110]);
  ok(alta.tendencia === "alta" && alta.rotulo === "HH_HL", "HH + HL = alta");
  ok(baixa.tendencia === "baixa" && baixa.rotulo === "LH_LL", "LH + LL = baixa");
  // Antes os tres casos abaixo saiam todos como "lateral_indefinida".
  ok(contr.tendencia === "lateral_contracao" && contr.rotulo === "LH_HL",
    "LH + HL = contracao, nao 'lateral' generica: o fundo esta SUBINDO");
  ok(expan.tendencia === "lateral_expansao" && expan.rotulo === "HH_LL",
    "HH + LL = expansao: o range ABRE, que e' o oposto de lateral");
  const curta = { highs: [10, 11, 12, 11, 10], lows: [9, 10, 11, 10, 9] };
  const semDados = classificarEstrutura(curta.highs, curta.lows, acharPivos(curta.highs, curta.lows, 2, 2));
  ok(semDados.tendencia === "indefinida",
    "sem pivos suficientes o rotulo e' 'indefinida': ausencia de dado nao vira estado de mercado");
  ok(new Set([alta, baixa, contr, expan, semDados].map((x) => x.tendencia)).size === 5,
    "os cinco casos produzem cinco rotulos diferentes");
}

console.log("\n== estrutura: os eventos nao prometem o que nao aconteceu ==");
{
  const comFundos = (v) => {
    const highs = [], lows = [], teto = Math.max(...v) * 2;
    for (const x of v) for (const y of [teto, teto, x, teto, teto]) { highs.push(y + 1); lows.push(y); }
    return mudancaEstrutura(highs, lows, acharPivos(highs, lows, 2, 2));
  };
  const comTopos = (v) => {
    const highs = [], lows = [], chao = Math.min(...v) / 2;
    for (const x of v) for (const y of [chao, chao, x, chao, chao]) { highs.push(y); lows.push(y - 1); }
    return mudancaEstrutura(highs, lows, acharPivos(highs, lows, 2, 2));
  };
  ok(comFundos([100, 110, 95]).includes("perda_estrutura_alta_novo_LL"),
    "fundo 95 abaixo do 100 inicial: ha LL de verdade, o evento sai");
  ok(!comFundos([100, 110, 105]).includes("perda_estrutura_alta_novo_LL"),
    "fundo 105 acima do 100 inicial: NAO ha LL, e o evento nao sai");
  ok(comTopos([110, 100, 120]).includes("novo_HH_apos_topo_mais_baixo"),
    "topo 120 acima do 110 inicial: ha HH de verdade, o evento sai");
  ok(!comTopos([110, 100, 105]).includes("novo_HH_apos_topo_mais_baixo"),
    "topo 105 abaixo do 110 inicial: NAO ha HH, e o evento nao sai");
  ok(comFundos([110, 100, 105]).includes("novo_HL_apos_fundo_mais_baixo"),
    "o evento de fundo mais alto continua saindo");
  ok(comTopos([100, 130, 120]).includes("topo_mais_baixo_apos_HH"),
    "o evento de topo mais baixo continua saindo");
}

console.log("\n== pivos: o fractal e' por timeframe e o relatorio declara qual usou ==");
{
  const dia = TIMEFRAMES_TESTE.find((t) => t.key === "diario");
  const sem = TIMEFRAMES_TESTE.find((t) => t.key === "semanal");
  ok(dia.pivos.esq === dia.pivos.dir && sem.pivos.esq === sem.pivos.dir,
    "os dois lados do fractal sao iguais em cada timeframe");
  ok(dia.pivos.esq > sem.pivos.esq,
    `o diario usa fractal mais largo que o semanal (${dia.pivos.esq} contra ${sem.pivos.esq}): ` +
    "cada vela semanal ja cobre uma semana");
  // O 5/5 amplia a janela local e exige cinco velas fechadas a direita
  // antes de confirmar um pivo candidato. Isso filtra ruido, mas NAO
  // define uma distancia minima fixa entre pivos consecutivos.
  ok(dia.pivos.esq === 5 && dia.pivos.dir === 5,
    "o fractal diario usa 5 velas de cada lado e confirma apos 5 velas a direita");
  // Serie com ruido de vela a vela por cima de uma onda maior: e'
  // exatamente o ruido que o fractal largo tem de descartar.
  let semente = 7;
  const ale = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  const zig = [];
  for (let i = 0; i < 400; i++) zig.push(100 + Math.sin(i / 19) * 20 + (ale() - 0.5) * 6);
  const h = zig.map((x) => x + 0.5), l = zig.map((x) => x - 0.5);
  const largo = acharPivos(h, l, dia.pivos.esq, dia.pivos.dir);
  const estreito = acharPivos(h, l, 2, 2);
  const nLargo = largo.altos.length + largo.baixos.length;
  const nEstreito = estreito.altos.length + estreito.baixos.length;
  ok(nLargo < nEstreito,
    `o fractal mais largo marca menos pivos na mesma serie (${nLargo} contra ${nEstreito}): ` +
    "e' isso que corta o ruido");
}

console.log("\n== niveis manuais: o relatorio avisa quando a faixa sai de onde o mercado reage ==");
{
  const zonaEm = (lo, hi) => ({ limites_operacionais: { inferior: lo, superior: hi } });
  const niveis = { faixas: [[100, 110, "a"], [200, 210, "b"]] };
  const casado = alinhamentoNiveis(niveis, [zonaEm(101, 109), zonaEm(201, 209)]);
  ok(casado.situacao === "alinhado" && casado.corroboradas === 2,
    "as duas faixas caem sobre zonas observadas: alinhado");
  const meio = alinhamentoNiveis(niveis, [zonaEm(101, 109), zonaEm(400, 410)]);
  ok(meio.situacao === "parcial" && meio.corroboradas === 1,
    "so uma faixa corroborada: parcial");
  // O caso que nada apontava antes: a faixa pode estar perto do preco e
  // mesmo assim deslocada da regiao em que o mercado de fato reage.
  const fora = alinhamentoNiveis(niveis, [zonaEm(300, 310), zonaEm(400, 410)]);
  ok(fora.situacao === "desalinhado" && fora.corroboradas === 0,
    "nenhuma faixa corroborada: desalinhado, mesmo com os numeros ainda na configuracao");
  ok(alinhamentoNiveis(niveis, []).situacao === "indefinido",
    "sem zonas para comparar, o campo diz indefinido em vez de inventar veredito");
}

console.log("\n== maquina de estados: um rompimento vira noticia UMA vez ==");
{
  const DIA = 86400;
  const base = { nivel: 80000, direcao: "alta", tolAtr: 0.25, resetAtr: 1.5, atr: 2200, maxCandles: 30, segundos: DIA };
  const roda = (precoDe, n) => {
    let estado = null; const novos = []; const estados = [];
    for (let i = 0; i < n; i++) {
      const preco = precoDe(i);
      const vela = { open: preco - 50, high: preco + 80, low: preco - 120, close: preco, time: 1700000000 + i * DIA };
      const antes = estado;
      const depois = atualizarEstadoNivel(antes, { ...base, vela });
      if (depois && !antes && depois.estado === "rompido") novos.push(i);
      if (depois && antes && depois.estado !== antes.estado) estados.push(`${i}:${depois.estado}`);
      estado = depois;
    }
    return { novos, estados, estado };
  };
  // Rompeu e o preco foi embora, sem nunca voltar. Antes o registro era
  // APAGADO por inatividade e renascia em "rompido" na vela seguinte, o
  // que o relatorio anuncia como rompimento novo: 7 anuncios em 200 dias.
  const embora = roda((i) => (i === 0 ? 80600 : 95000), 200);
  ok(embora.novos.length === 1,
    `rompimento anunciado uma unica vez em 200 velas (foram ${embora.novos.length})`);
  ok(embora.estado && embora.estado.estado === "arquivado",
    "o nivel abandonado termina arquivado, nao apagado");
  // Arquivado nao e' o fim: se o preco VOLTA a encostar, o ciclo recomeca.
  const volta = roda((i) => (i === 0 ? 80600 : i < 120 ? 95000 : 80100), 200);
  ok(volta.novos.length === 1, "voltar ao nivel nao conta como rompimento novo");
  ok(volta.estados.some((x) => x.endsWith(":em_reteste")),
    "o nivel dormente acorda em reteste quando o preco volta a encostar");
}

console.log("\n== maquina de estados: a tolerancia acompanha a volatilidade do par ==");
{
  const DIA = 86400;
  const vela = (c) => ({ open: c, high: c + 1, low: c - 1, close: c, time: 1700000000 });
  const ctx = (atr) => ({
    nivel: 100, direcao: "alta", tolAtr: 0.25, resetAtr: 1.5, atr,
    maxCandles: 30, segundos: DIA,
  });
  // Mesmo desvio do nivel (0,4), dois regimes de volatilidade: com ATR
  // grande o preco ainda esta "na zona"; com ATR pequeno, ja rompeu.
  const anterior = { estado: "rompido", direcao: "alta", historico: [], ultimoContato: 1700000000 - DIA, dataRompimento: 1700000000 - DIA };
  const volatil = atualizarEstadoNivel(anterior, { ...ctx(4), vela: vela(100.4) });
  const calmo = atualizarEstadoNivel(anterior, { ...ctx(0.4), vela: vela(100.4) });
  ok(volatil.estado === "em_reteste",
    "num par volatil, 0,4 acima do nivel ainda e' toque: 0,4 < 0,25 x 4");
  ok(calmo.estado !== "em_reteste",
    "num par calmo, o mesmo 0,4 ja esta fora da zona: 0,4 > 0,25 x 0,4");
  // O afastamento segue a mesma regra: 1,0 de desvio nao e' nada num par
  // que anda 4 por vela, e ja e' 2,5 ATR num que anda 0,4.
  const volatilLonge = atualizarEstadoNivel(anterior, { ...ctx(4), vela: vela(101) });
  const calmoLonge = atualizarEstadoNivel(anterior, { ...ctx(0.4), vela: vela(101) });
  ok(!volatilLonge.afastado && calmoLonge.afastado,
    "e o mesmo desvio de 1,0 so conta como afastamento no par calmo");
}

console.log("\n== leitura de contexto longo: a linha para quem nao e' trader ==");
{
  // Cinco campos do bloco SEMANAL, e nada mais. Existe para responder
  // "e dai?" sem obrigar a ler os 100 e poucos campos do relatorio.
  // dp/dm/adx sao opcionais: sem eles a leitura tem de continuar saindo.
  const bloco = (fech, ema, dist, rsi, estrutura, dp, dm, adx, niveis) => ({
    ultimo_fechamento_close: fech, ema89_fechada_atual: ema,
    distancia_ema89_fechada_atr: dist, rsi_fechado: rsi,
    estrutura_tendencia: estrutura,
    di_plus_fechado: dp, di_minus_fechado: dm, adx_fechado: adx,
    ...(niveis || {}),
  });
  const barato = leituraLonga(bloco(80, 100, 2.0, 45, "lateral_contracao"));
  ok(barato.classe === "acumular", "abaixo da media longa e sem baixa instalada: acumular");
  const caindo = leituraLonga(bloco(80, 100, 2.0, 45, "baixa"));
  ok(caindo.classe === "atencao",
    "barato E caindo sao coisas diferentes: a tendencia de baixa muda o rotulo");
  const esticado = leituraLonga(bloco(130, 100, 2.5, 74, "alta"));
  ok(esticado.classe === "esticado", "longe acima com RSI esticado: esticado");
  const subindoSaudavel = leituraLonga(bloco(130, 100, 2.5, 58, "alta"));
  ok(subindoSaudavel.classe === "neutro",
    "longe acima mas SEM esticamento nao vira alarme: alta saudavel e' normal");
  // O exagero que esta regra existe para evitar.
  const emCima = leituraLonga(bloco(99, 100, 0.15, 50, "lateral_contracao"));
  ok(emCima.classe === "neutro" && emCima.rotulo === "na média longa",
    "0,15 ATR da media e' ESTAR na media, e nao vira 'barato'");
  // ---- o que o DMI acrescenta, e o RSI nao tinha como dizer ----
  // Duas situacoes com o MESMO preco e o MESMO RSI, separadas so pelo
  // DMI: subiu muito com a compra mandando e' diferente de subiu muito
  // com o movimento morrendo, e a acao que cada uma sugere e' oposta.
  const esticadoVivo = leituraLonga(bloco(130, 100, 2.5, 74, "alta", 35, 10, 30));
  const esticadoMorrendo = leituraLonga(bloco(130, 100, 2.5, 74, "alta", 35, 10, 15));
  ok(esticadoVivo.rotulo !== esticadoMorrendo.rotulo,
    "mesmo preco e mesmo RSI, rotulos diferentes: quem separa e' o DMI");
  ok(/ainda tem força/.test(esticadoVivo.rotulo) && esticadoVivo.classe === "atencao",
    "esticado com ADX forte e compra mandando: a alta ainda tem forca, nao e' hora");
  ok(/perdendo força/.test(esticadoMorrendo.rotulo) && esticadoMorrendo.classe === "esticado",
    "esticado com ADX fraco: a alta esta morrendo, e e' aqui que a janela costuma estar");

  // Do lado barato, o DMI denuncia a queda viva antes da estrutura, que
  // depende de pivos e e' lenta. Qualquer um dos dois basta.
  const baratoCaindoDmi = leituraLonga(bloco(80, 100, 2.0, 45, "lateral_contracao", 10, 35, 30));
  ok(baratoCaindoDmi.rotulo === "barato, mas ainda caindo",
    "venda mandando com ADX forte marca queda viva mesmo sem a estrutura confirmar");
  const baratoParado = leituraLonga(bloco(80, 100, 2.0, 45, "lateral_contracao", 18, 17, 14));
  ok(baratoParado.classe === "acumular",
    "sem forca nenhuma, barato continua sendo barato");

  // ADX abaixo do corte significa que NAO ha tendencia. Nomear uma
  // direcao ali seria inventar uma alta que nao existe.
  ok(/sem tendência firme/.test(baratoParado.razao) && !/alta|queda/.test(
      baratoParado.razao.split(",").pop()),
    "com ADX fraco a razao diz 'sem tendencia firme', e nao nomeia direcao");

  ok(forcaTendencia(30, 10, 30).forte === true && forcaTendencia(30, 10, 20).forte === false,
    "o corte de forca e' 25, o mesmo que a linha de eventos ja usava");
  ok(forcaTendencia(undefined, undefined, 30) === null,
    "sem DI a forca e' nula, e a leitura segue sem ela");
  const semDmi = leituraLonga(bloco(130, 100, 2.5, 74, "alta"));
  ok(semDmi.rotulo.length > 0 && !/undefined/.test(semDmi.razao),
    "bloco sem DMI nao quebra a leitura");

  // ---- niveis manuais: a prioridade 1 da lista do prompt ----
  // A faixa nascia apoiada na media longa (prioridade 3) e nos
  // indicadores (prioridade 5), pulando os niveis, que sao o primeiro
  // item. Estar dentro de uma faixa e' o fato mais decisivo da tela.
  const fx = (lo, hi, label) => ({ inferior: lo, superior: hi, label });
  const f78 = fx(78000, 80000, "faixa_78k_80k");
  // A frase NOMEIA a faixa. Sem isso ela afirmava algo sobre "uma faixa"
  // e obrigava quem le a procurar o rotulo no cartao -- e ainda a saber
  // que esta leitura sai do bloco semanal, nao do diario.
  ok(ondeNosNiveis("atual", 0, f78, "alinhado", 2) === "dentro da faixa manual de 78.000 a 80.000",
    "distancia zero quer dizer DENTRO da faixa, e a frase diz QUAL");
  ok(/região de suporte manual de 64.000 a 66.000/.test(
      ondeNosNiveis("atual", 0, fx(64000, 66000, "regiao_suporte_64k_66k"), "alinhado", 2)),
    "faixa de suporte e' nomeada como tal, tambem com os limites");
  ok(/encostando na faixa manual de 78.000 a 80.000/.test(ondeNosNiveis("atual", 0.4, f78, "alinhado", 2)),
    "perto mas fora da faixa: encostando");
  ok(/perto da faixa manual de 78.000 a 80.000/.test(ondeNosNiveis("monitorar", 2, f78, "alinhado", 2)),
    "entre 1 e 3 ATR: perto");
  // Longe de TODAS, nomear uma nao ajudaria.
  ok(ondeNosNiveis("obsoleto", 5, f78, "alinhado", 2) === "longe das faixas manuais",
    "alem de 3 ATR: longe das faixas, sem nomear nenhuma");
  ok(ondeNosNiveis(null, 0, null, null) === null, "sem situacao publicada, nao inventa frase");
  ok(/dentro da faixa manual$/.test(ondeNosNiveis("atual", 0, "faixa_78k_80k", "alinhado", 2)),
    "sem os limites publicados, a frase sai sem o intervalo em vez de quebrar");

  // Casas decimais suficientes, sem zeros a toa: cada par tem a sua escala.
  ok(/de 76.000 a 78.000/.test(ondeNosNiveis("atual", 0, fx(76000, 78000, "f"), "alinhado", 2)),
    "valores inteiros saem sem casas decimais");
  ok(/de 0,00656 a 0,00705/.test(ondeNosNiveis("atual", 0, fx(0.00656, 0.00705, "f"), "alinhado", 8)),
    "e um par de escala pequena sai com as casas que precisa");
  ok(/de 5,12 a 5,16/.test(ondeNosNiveis("atual", 0, fx(5.12, 5.16, "f"), "alinhado", 4)),
    "sem arrastar casas que a faixa nao usa");

  // Uma faixa que as zonas observadas nao corroboram e' um numero velho.
  const desalinhada = ondeNosNiveis("atual", 0, f78, "desalinhado", 2);
  ok(/não vem respeitando/.test(desalinhada),
    "faixa desalinhada e' citada COM a ressalva: o mercado nao a respeita");
  ok(!/não vem respeitando/.test(ondeNosNiveis("obsoleto", 5, f78, "desalinhado", 2)),
    "mas longe da faixa a ressalva nao faz sentido e nao aparece");

  // A razao segue a ordem de prioridade do prompt: niveis antes da media
  // longa, e os indicadores por ultimo.
  const comNivel = leituraLonga(bloco(130, 100, 2.5, 74, "alta", 35, 10, 30, {
    niveis_manuais_situacao: "atual", niveis_manuais_distancia_atr: 0,
    niveis_manuais_faixa_mais_proxima: "faixa_78k_80k",
    niveis_manuais_alinhamento: "alinhado",
  }));
  ok(comNivel.razao.indexOf("faixas") < comNivel.razao.indexOf("média longa"),
    "os niveis vem ANTES da media longa na razao");
  ok(comNivel.razao.indexOf("média longa") < comNivel.razao.indexOf("momentum"),
    "e os indicadores vem por ultimo");
  ok(!/ATR|RSI|ADX|DI\+/.test(comNivel.razao),
    "a linha dos niveis tambem sai sem jargao");

  ok(leituraLonga({ falha: "fonte fora do ar" }).classe === "neutro",
    "bloco em falha nao inventa leitura");
  ok(leituraLonga(null).classe === "neutro", "bloco ausente nao quebra");
  // A razao tem de mostrar os numeros que produziram o rotulo: e' o que
  // torna a linha conferivel por quem nao le o resto da pagina.
  // A razao existe para a leitura ser conferivel por quem NAO sabe
  // analise tecnica. Numero em unidade que a pessoa nao entende nao
  // confere nada, entao nenhum jargao pode vazar para esta linha.
  const todas = [barato, caindo, esticado, subindoSaudavel, emCima];
  ok(todas.every((x) => !/ATR|RSI|EMA|lateral_|_HL|_LL|HH_|LH_/.test(x.razao)),
    "nenhum jargao tecnico aparece na razao: nem ATR, nem RSI, nem EMA");
  ok(todas.every((x) => /%/.test(x.razao)),
    "a distancia sai em porcentagem, que dispensa explicacao");
  ok(/bem abaixo/.test(barato.razao) && /perto/.test(emCima.razao),
    "o criterio de 1 ATR vira palavra: 'bem abaixo' contra 'perto'");
  ok(/esticado/.test(esticado.razao) && /normal/.test(subindoSaudavel.razao),
    "o RSI vira momentum em palavras, com o numero fora da linha");
  const pag = toHTML(r1.texto, relatorioParaJSON(r1.texto, r1.zonas));
  ok(pag.includes('class="leituras"') && /class="leitura"/.test(pag),
    "a faixa de contexto aparece na pagina");
  ok(pag.indexOf('class="leituras"') < pag.indexOf('class="pares"'),
    "e vem ANTES dos cartoes, que e' o lugar de quem so quer a resposta");
}

console.log("\n== leitura de contexto curto: o que aconteceu no diario ==");
{
  // O diario e' o timeframe de TIMING deste monitor -- RSI 21, DMI
  // 28/42, pivos 5/5, janela de reteste de 30 velas --, calibrado para
  // 1 a 6 semanas. Nao e' day trade e nao usa a vela em formacao.
  const cfg = PARES_TESTE.find((c) => !c.semCartao);
  const nv = cfg.niveis;
  const base = (extra) => ({
    ultimo_fechamento_close: 110, ema89_fechada_atual: 100,
    ema89_cruzamento_fechado: "nenhum", deterioracao_tendencia: [],
    ...(extra || {}),
  });
  const comEstado = (estado) =>
    leituraCurta(base({ [`nivel_${nv.resistenciaLabel}_estado`]: estado }), cfg);

  // A maquina de rompimento e reteste e' o nucleo: e' a prioridade 2 da
  // lista do prompt e a sequencia que mais importa para uma entrada.
  ok(/reteste confirmado/.test(comEstado("reteste_confirmado").rotulo),
    "reteste confirmado e' o estado mais decisivo e aparece no rotulo");
  ok(/reteste em curso/.test(comEstado("em_reteste").rotulo), "reteste em curso idem");
  ok(/rompimento falhou/.test(comEstado("rompimento_falhou").rotulo), "rompimento falhou idem");
  ok(/resistência/.test(comEstado("em_reteste").razao),
    "a razao diz de QUAL nivel se trata, e se e' resistencia ou suporte");

  // Ordem de relevancia: com dois niveis em estados diferentes, vence o
  // mais decisivo, nao o primeiro da lista de niveis.
  const dois = leituraCurta(base({
    [`nivel_${nv.resistenciaLabel}_estado`]: "rompido",
    [`nivel_${nv.suporteLabel}_estado`]: "reteste_confirmado",
  }), cfg);
  ok(/reteste confirmado/.test(dois.rotulo),
    "com dois niveis em estados diferentes, vence o mais decisivo");

  // Sem evento de nivel, a travessia da media diaria ainda e' fato do dia.
  const cruzou = leituraCurta(base({ ema89_cruzamento_fechado: "abaixo" }), cfg);
  ok(/cruzou a média diária para baixo/.test(cruzou.rotulo),
    "sem evento de nivel, a travessia da media entra no lugar");
  const fraco = leituraCurta(base({ deterioracao_tendencia: ["rompimento_falhou"] }), cfg);
  ok(/enfraquecimento/.test(fraco.rotulo), "e a deterioracao vem depois dela");
  ok(/sem evento no diário/.test(leituraCurta(base(), cfg).rotulo),
    "sem nada acontecendo, o rotulo diz isso em vez de inventar evento");

  // A cor diz "vale olhar", nunca "e' bom" ou "e' ruim": rompimento e
  // reteste tem o mesmo nome subindo e descendo.
  ok(comEstado("reteste_confirmado").classe === "atencao" &&
     comEstado("rompimento_falhou").classe === "atencao",
    "todo evento sai na mesma cor: ela sinaliza atencao, nao direcao");
  ok(leituraCurta(base(), cfg).classe === "neutro", "sem evento, sem destaque");

  // Sem jargao, como a leitura longa.
  const todas = ["reteste_confirmado", "em_reteste", "rompimento_falhou"].map(comEstado);
  ok(todas.every((x) => !/ATR|RSI|EMA|ADX|DI\+/.test(x.razao)),
    "nenhum jargao tecnico vaza para a razao");
  // Arredondar 0,02% para "0,0% abaixo" afirmaria um lado que o numero
  // nao sustenta.
  ok(/em cima da média diária/.test(
      leituraCurta(base({ ultimo_fechamento_close: 100.02 }), cfg).razao),
    "praticamente em cima da media nao vira '0,0% abaixo'");
  ok(leituraCurta(null, cfg).classe === "neutro" &&
     leituraCurta({ falha: "fonte fora" }, cfg).classe === "neutro",
    "bloco ausente ou em falha nao inventa leitura");

  const pag = toHTML(r1.texto, relatorioParaJSON(r1.texto, r1.zonas));
  // UMA secao, com as duas leituras dentro de cada caixa de par.
  ok((pag.match(/<h2>Contexto<\/h2>/g) || []).length === 1,
    "existe uma unica secao de contexto");
  ok(!/Contexto longo|Contexto curto/.test(pag),
    "as duas secoes separadas nao existem mais");
  const caixa = pag.split('class="leitura"')[1].split("</div></div>")[0];
  ok(caixa.indexOf(">longo<") < caixa.indexOf(">curto<"),
    "dentro da caixa, o longo vem antes do curto: enquadramento antes do evento");
  ok((pag.match(/class="lh /g) || []).length === PARES_TESTE.filter((c) => !c.semCartao).length * 2,
    "duas linhas de leitura por par com cartao");
  ok(pag.indexOf("<h2>Contexto</h2>") < pag.indexOf('class="pares"'),
    "e a secao vem antes dos cartoes");
  ok((pag.match(/class="nota"/g) || []).length === 1,
    "uma nota so: as duas somavam 684 caracteres contra 209 das leituras");
}

console.log("\n== (?) de cada rotulo: a explicacao sem custo de espaco ==");
{
  // O rotulo e' curto por obrigacao de layout. O (?) devolve a
  // explicacao inteira sem ocupar linha -- mas so vale se TODA chave
  // que as leituras sabem produzir tiver texto, senao o botao abre
  // vazio para quem mais precisa dele.
  const bloco = (fech, ema, dist, rsi, estrutura, dp, dm, adx) => ({
    ultimo_fechamento_close: fech, ema89_fechada_atual: ema,
    distancia_ema89_fechada_atr: dist, rsi_fechado: rsi,
    estrutura_tendencia: estrutura,
    di_plus_fechado: dp, di_minus_fechado: dm, adx_fechado: adx,
  });
  const cfg = PARES_TESTE.find((c) => !c.semCartao);
  const nv = cfg.niveis;
  const base = (extra) => ({
    ultimo_fechamento_close: 110, ema89_fechada_atual: 100,
    ema89_cruzamento_fechado: "nenhum", deterioracao_tendencia: [],
    ...(extra || {}),
  });

  const produzidas = new Set();
  const somar = (L) => { produzidas.add(L.chave); return L; };

  somar(leituraLonga(null));
  somar(leituraLonga(bloco(99, 100, 0.15, 50, "lateral_contracao")));
  somar(leituraLonga(bloco(80, 100, 2.0, 45, "lateral_contracao")));
  somar(leituraLonga(bloco(80, 100, 2.0, 45, "baixa")));
  somar(leituraLonga(bloco(130, 100, 2.5, 58, "alta")));
  somar(leituraLonga(bloco(130, 100, 2.5, 74, "alta", 35, 10, 30)));
  somar(leituraLonga(bloco(130, 100, 2.5, 74, "alta", 35, 10, 15)));
  somar(leituraCurta(null, cfg));
  for (const e of ["reteste_confirmado", "em_reteste", "rompimento_falhou",
                   "recuperado", "rompido", "rompimento_candidato"]) {
    somar(leituraCurta(base({ [`nivel_${nv.resistenciaLabel}_estado`]: e }), cfg));
  }
  somar(leituraCurta(base({ ema89_cruzamento_fechado: "acima" }), cfg));
  somar(leituraCurta(base({ ema89_cruzamento_fechado: "abaixo" }), cfg));
  somar(leituraCurta(base({ deterioracao_tendencia: ["rompimento_falhou"] }), cfg));
  somar(leituraCurta(base(), cfg));

  const faltando = [...produzidas].filter((k) => !EXPLICACOES[k]);
  ok(faltando.length === 0, `toda chave de leitura tem explicacao (faltou: ${faltando})`);
  // E o contrario tambem: explicacao que nenhuma leitura produz e' texto
  // morto que ninguem ia notar envelhecendo.
  const sobrando = Object.keys(EXPLICACOES).filter((k) => !produzidas.has(k));
  ok(sobrando.length === 0, `nenhuma explicacao orfa (sobrou: ${sobrando})`);

  // O texto e' para quem NAO sabe analise tecnica: o mesmo criterio da
  // razao, que ja proibe jargao.
  const jargao = /\bATR\b|\bRSI\b|\bADX\b|\bDMI\b|\bEMA\b|pivô|momentum/i;
  const comJargao = Object.entries(EXPLICACOES).filter(([, v]) => jargao.test(v));
  ok(comJargao.length === 0, `explicacao sem jargao (com jargao: ${comJargao.map((x) => x[0])})`);

  const pag = toHTML(r1.texto, relatorioParaJSON(r1.texto, r1.zonas));
  const comCartao = PARES_TESTE.filter((c) => !c.semCartao);
  ok((pag.match(/class="aj"/g) || []).length === comCartao.length * 2,
    "um (?) por linha de leitura: longo e curto de cada par com cartao");

  // O id liga o botao ao texto para leitor de tela. Repetido, o leitor
  // leria a explicacao errada -- e o CSS ainda funcionaria, entao so um
  // teste pega isso.
  const ids = pag.match(/id="aj-[^"]+"/g) || [];
  ok(ids.length === comCartao.length * 2 && new Set(ids).size === ids.length,
    "cada (?) aponta para um id unico");
  for (const id of ids) {
    const alvo = id.slice(4, -1);
    ok(pag.includes(`aria-describedby="${alvo}"`),
      `o (?) de ${alvo} aponta para um texto que existe`);
  }

  // O botao vem DEPOIS do rotulo, que e' o que ele explica.
  const linha = pag.split('class="lh ')[1].split("</div>")[0];
  ok(linha.indexOf('class="lr"') < linha.indexOf('class="aj"'),
    "o (?) vem depois do rotulo, nao antes");

  // Nada disso pode encostar no bloco que o bot le.
  const pre = pag.slice(pag.indexOf("<pre>"), pag.indexOf("</pre>"));
  ok(!/class="aj"|role="tooltip"/.test(pre),
    "o (?) e' so da parte visual: o relatorio do bot sai intacto");
}

console.log("\n== superficie do grafico: uma cor so para faixa, container e embed ==");
{
  const pag = toHTML(r1.texto, relatorioParaJSON(r1.texto, r1.zonas));
  const css = pag.split("<style>")[1].split("</style>")[0];
  const escuro = css.split(":root{")[1].split("}")[0];
  const claro = css.split('html[data-tema="claro"]{')[1].split("}")[0];
  const tok = (bloco, nome) => (bloco.match(new RegExp(nome + ":\\s*([^;]+);")) || [])[1];
  const noite = tok(escuro, "--tv-fundo");
  const dia = tok(claro, "--tv-fundo");
  ok(!!noite && !!dia && noite !== dia, `a superficie do grafico tem cor por tema (${noite} / ${dia})`);

  // Faixa dos botoes e container do grafico na MESMA cor: eram tres
  // tons de escuro empilhados -- cartao, faixa, embed -- e tres escuros
  // em sequencia leem como defeito, nao como desenho.
  const barra = tok(escuro, "--tv-barra");
  const barraClaro = tok(claro, "--tv-barra");
  ok(!!barra && !!barraClaro, `a barra do widget tem cor por tema (${barra} / ${barraClaro})`);
  // BRANCO PURO E' DO EMBED, e de mais nada. No tema claro o embed e'
  // #ffffff; se os paineis tambem forem, as camadas somem e a pagina
  // vira uma chapa branca so. Os paineis ficam num branco levemente
  // azulado, e a escada -- fundo, cartao, painel, embed -- sobe ate o
  // branco puro, que so o grafico usa.
  const painelClaro = tok(claro, "--painel");
  ok(dia.toLowerCase() === "#ffffff", `no claro a superficie do grafico e' branco puro (${dia})`);
  ok(painelClaro.toLowerCase() !== "#ffffff",
    `e os paineis NAO sao branco puro, senao as camadas somem (${painelClaro})`);
  // Dois tokens para duas superficies, mesmo valendo o mesmo hoje: a
  // barra e o grafico sao coisas diferentes do widget, e ja foram
  // pintadas em cores diferentes na paleta anterior dele.
  ok(/\.tv-barra\{[^}]*background:var\(--tv-barra\)/.test(css),
    "a faixa dos botoes usa a cor da BARRA do widget");
  ok(/\.tv\{[^}]*background:var\(--tv-fundo\)/.test(css),
    "e o container do grafico usa a mesma");
  ok(/\.tv-tf\{[^}]*border:1px solid var\(--tv-linha\)/.test(css),
    "a borda dos botoes acompanha, senao some no fundo novo");

  // O botao MARCADO continua azul: e' o unico jeito de saber qual vale.
  // Os botoes sao CINZA, nao azul: moram dentro do bloco do grafico,
  // que e' neutro nos dois temas. Sem o azul, o marcado precisa de
  // PREENCHIMENTO -- so a cor do texto nao diria qual intervalo vale.
  ok(/\.tv-tf\{[^}]*color:var\(--tv-btn\)/.test(css),
    "os botoes do grafico usam o cinza do bloco, nao o azul da pagina");
  ok(/\.tv-tf\[aria-pressed="true"\]\{[^}]*background:var\(--tv-btn-ativo\)/.test(css) &&
     /\.tv-tf\[aria-pressed="true"\]\{[^}]*color:var\(--tv-btn-forte\)/.test(css),
    "e o marcado se distingue por preenchimento, nao so por cor de texto");
  ok(!/\.tv-tf[^}]*var\(--chip-/.test(css),
    "nenhum botao do grafico volta a puxar a cor de destaque da pagina");

  // O widget recebe exatamente a mesma cor. Se o CSS e o widget
  // tivessem hex proprios, um dia alguem mexeria num e nao no outro.
  const script = pag.split("window.desenharGraficos=")[1] || "";
  ok(script.includes(`"${noite}"`) && script.includes(`"${dia}"`),
    "e o widget recebe os MESMOS hex do CSS, nao uma segunda copia");
}

console.log("\n== seletor de par: um par por vez ==");
{
  const pag = toHTML(r1.texto, relatorioParaJSON(r1.texto, r1.zonas));
  const comCartao = PARES_TESTE.filter((c) => !c.semCartao);
  const botoes = pag.match(/data-sel="[^"]+"/g) || [];

  // Um botao que nao faz nada e' pior que nenhum botao.
  ok(botoes.length === (comCartao.length > 1 ? comCartao.length : 0),
    comCartao.length > 1
      ? `o seletor traz um botao por par (${comCartao.length})`
      : "com um par so, nao ha seletor");

  // A caixa de leitura e o cartao carregam o MESMO data-par: e' o que
  // permite filtrar os dois de uma vez.
  for (const c of comCartao) {
    const n = (pag.match(new RegExp(`data-par="${c.label.replace("/", "\\/")}"`, "g")) || []).length;
    ok(n === 2, `${c.label}: a leitura e o cartao levam o mesmo data-par`);
  }

  // O relatorio completo NAO pode ser filtrado: e' o fallback do prompt.
  const pre = pag.slice(pag.indexOf("<pre>"), pag.indexOf("</pre>"));
  ok(!/data-par|oculto/.test(pre),
    "o bloco do bot fica fora do seletor e sai sempre inteiro");

  // Sem JS, nada e' escondido: a classe so e' aplicada pelo script.
  ok(!/class="[^"]*oculto/.test(pag),
    "no HTML servido nada nasce escondido: sem JS a pagina fica completa");

  if (comCartao.length > 1) {
    // Roda o script de verdade, com DOM falso, e confere o efeito.
    const caixas = [];
    for (const c of comCartao) {
      for (const tipo of ["leitura", "cartao"]) {
        caixas.push({
          tipo, par: c.label, classes: new Set(),
          getAttribute: (k) => (k === "data-par" ? c.label : null),
          classList: {
            add: (x) => caixas.find((y) => y === undefined) || null,
            remove: () => null,
          },
        });
      }
    }
    // classList real por caixa
    for (const cx of caixas) {
      cx.classList = {
        add: (x) => cx.classes.add(x),
        remove: (x) => cx.classes.delete(x),
        contains: (x) => cx.classes.has(x),
      };
    }
    const bts = comCartao.map((c) => ({
      pressed: "false",
      getAttribute: (k) => (k === "data-sel" ? c.label : null),
      setAttribute: (k, v) => { if (k === "aria-pressed") bts.find((b) => b.getAttribute("data-sel") === c.label).pressed = v; },
    }));
    let redesenhos = 0;
    const doc = {
      documentElement: { hasAttribute: () => false },
      querySelectorAll: (sel) => (sel === "[data-par]" ? caixas : bts),
      querySelector: () => bts[0],
      addEventListener: () => {},
    };
    const janela = { desenharGraficos: () => { redesenhos++; } };
    const corpo = pag.split("window.mostrarPar=")[1].split("aplica(!r.hasAttribute")[0];
    new Function("window", "document", "r", "aplica", "window.mostrarPar=" + corpo)(
      janela, doc, doc.documentElement, () => {}
    );
    // Na carga, o primeiro par fica visivel e os outros escondidos.
    const visiveis = caixas.filter((c) => !c.classes.has("oculto"));
    ok(visiveis.length === 2 && visiveis.every((c) => c.par === comCartao[0].label),
      `na carga aparece so o primeiro par (${comCartao[0].label}), leitura e cartao`);
    ok(bts[0].pressed === "true" && bts[1].pressed === "false",
      "e o botao dele fica marcado");
    // Na carga o seletor SO esconde. Quem desenha e' o aplica(), uma vez
    // so -- desenhar aqui tambem criava o widget duas vezes por carga.
    ok(redesenhos === 0, "a carga nao redesenha: quem desenha e' o tema, uma vez so");

    janela.mostrarPar(comCartao[1].label);
    const v2 = caixas.filter((c) => !c.classes.has("oculto"));
    ok(v2.length === 2 && v2.every((c) => c.par === comCartao[1].label),
      "trocar de par troca a leitura E o cartao juntos");
    ok(bts[1].pressed === "true" && bts[0].pressed === "false",
      "e a marcacao acompanha");
    // O widget calcula o tamanho na criacao: um container que nasceu
    // escondido sai quebrado. Redesenhar com ele visivel resolve.
    ok(redesenhos === 1, "a troca, essa sim, redesenha o grafico do par que apareceu");
    janela.mostrarPar(comCartao[0].label);
    ok(redesenhos === 2, "e cada troca seguinte tambem");
    // Um par que nao existe nao pode apagar a pagina inteira.
    janela.mostrarPar("PAR/INEXISTENTE");
    ok(caixas.filter((c) => !c.classes.has("oculto")).length === 2,
      "pedir um par inexistente nao esconde tudo");
  }
}

console.log("\n== zona que sumiu do calculo: a ficha dorme, nao e' rasgada ==");
{
  // O desenho das zonas e' refeito do zero a cada execucao. Quando ele
  // sai diferente -- tres regioes estreitas viram uma larga --, sobram
  // fichas sem dona. Elas tem de sobreviver a carencia, senao a zona
  // volta na execucao seguinte como recem-nascida e a maturidade que o
  // radar pressupoe nunca acumula. Foi o que aconteceu seis vezes em
  // 18 dias nos tres monitores, com o codigo parado.
  const zona = (id, lo, hi, extra) => ({
    id, status: "ativa", limites_estruturais: { inferior: lo, superior: hi },
    ultimaVelaAvaliada: 100, velasEnfraquecida: 0, ...(extra || {}),
  });
  const larga = [zona("z9", 10, 16)];
  const estreitas = [zona("z1", 10, 12), zona("z2", 12, 14), zona("z3", 14, 16)];
  const orfas = reconciliarAnteriores(estreitas, larga, "diario", 200);
  ok(orfas.length === 3, "as tres fichas cobertas continuam no estado");
  ok(orfas.map((o) => o.id).join() === "z1,z2,z3",
    "com o id de sempre: e' o id que permite reencontra-las depois");
  ok(orfas.every((o) => o.absorvida === true), "e ficam marcadas como dormentes");
  ok(orfas.every((o) => o.status === "enfraquecida"),
    "entram em enfraquecida, que e' o ciclo normal de quem sumiu do calculo");

  // Fora da regiao coberta o comportamento antigo continua valendo.
  const fora = reconciliarAnteriores([zona("z4", 50, 52)], larga, "diario", 200);
  ok(fora.length === 1 && fora[0].absorvida === false,
    "zona que nenhuma calculada cobre e' orfa comum, nao dormente");

  // A carencia expira. No semanal sao 4 velas.
  const quase = zona("z5", 10, 12, { status: "enfraquecida", velasEnfraquecida: 3 });
  ok(reconciliarAnteriores([quase], larga, "semanal", 200)[0].status === "remover",
    "passada a carencia, a ficha dormente e' descartada de vez");
  // E a contagem so anda quando a vela fechada muda.
  const mesmaVela = zona("z6", 10, 12, { status: "enfraquecida", velasEnfraquecida: 1 });
  ok(reconciliarAnteriores([mesmaVela], larga, "semanal", 100)[0].velasEnfraquecida === 1,
    "reexecucao na mesma vela nao envelhece a ficha");

  // Quem voltou ao calculo nao entra como orfa: ja esta vivo.
  ok(reconciliarAnteriores([zona("z9", 10, 16)], larga, "diario", 200).length === 0,
    "zona reencontrada pelo calculo nao vira orfa");
}

console.log("\n== zona em observacao tambem envelhece ==");
{
  // Antes, candidata so tinha uma saida: virar ativa. Uma regiao que
  // nunca se provou tambem nunca era descartada -- havia zona em
  // observacao sem toque ha 435 semanas no estado do dolar, contando
  // como confluencia do prazo maior.
  const ctx = (semToque) => ({
    tfKey: "diario", ultimaVelaFechada: 2,
    velasDesdeUltimoToque: semToque, confluenciaSemanal: false,
  });
  const nova = (score) => ({ score, episodios: [] });
  const ant = (extra) => ({
    status: "candidata", velasComScoreAlto: 0, velasEnfraquecida: 0,
    ultimaVelaAvaliada: 1, ...(extra || {}),
  });
  ok(atualizarCiclo(nova(60), ant(), ctx(3)).status === "candidata",
    "zona nova, com score bom e toque recente, segue em observacao");
  ok(atualizarCiclo(nova(60), ant(), ctx(400)).status === "enfraquecida",
    "em observacao e sem toque ha muito tempo passa a enfraquecer, igual a ativa");
  ok(atualizarCiclo(nova(20), ant(), ctx(3)).status === "enfraquecida",
    "score abaixo do corte enfraquece, tambem igual a ativa");
  // A promocao continua existindo, e continua exigindo evidencia.
  const comEvidencia = { score: 60, episodios: [{ rejeitado: true }, { rejeitado: false }] };
  ok(atualizarCiclo(comEvidencia, ant({ velasComScoreAlto: 1 }), ctx(3)).status === "ativa",
    "score alto por duas velas e evidencia estrutural ainda promove a ativa");
  // E nada disso anda na mesma vela.
  ok(atualizarCiclo(nova(60), ant({ ultimaVelaAvaliada: 2 }), ctx(400)).status === "candidata",
    "reexecucao na mesma vela nao muda o estado");
}

console.log("\n== radar de promocao: zona madura que nenhuma faixa cobre ==");
{
  const z = (lo, hi, score, toques) => ({
    limites_operacionais: { inferior: lo, superior: hi }, score, numero_toques: toques,
  });
  const niveis = { faixas: [[100, 110, "a"]] };
  // Madura e descoberta: e' o caso que o radar existe para achar.
  const achou = zonasCandidatas([z(200, 210, 82, 8)], niveis, 150, "diario");
  ok(achou.length === 1 && achou[0].score === 82, "zona madura sem faixa entra no radar");
  ok(achou[0].lado === "acima", "e o radar diz de que lado do preco ela esta");
  // Madura mas JA coberta por faixa: promover nao faria sentido.
  ok(zonasCandidatas([z(101, 109, 90, 9)], niveis, 105, "diario").length === 0,
    "zona ja coberta por faixa nao entra");
  // Descoberta mas imatura: e' o caso das zonas de 1 toque, que existem
  // acima do preco em quase todo par e nao significam nada ainda.
  ok(zonasCandidatas([z(200, 210, 35, 1)], niveis, 150, "diario").length === 0,
    "zona de score baixo e um toque nao entra: e' o ruido que o radar filtra");
  ok(zonasCandidatas([z(200, 210, 90, 2)], niveis, 150, "diario").length === 0,
    "score alto com poucos toques tambem nao: exige as duas coisas");
  // No semanal o radar NAO roda. A estrutura semanal fica noutro
  // patamar e um unico conjunto de faixas serve aos dois timeframes,
  // entao ali a lista seria enorme, permanente e inacionavel.
  ok(zonasCandidatas([z(200, 210, 90, 9)], niveis, 150, "semanal").length === 0,
    "no semanal o radar nao roda, para nao virar ruido permanente");
  // Teto de tres, senao o campo vira parede de texto.
  const muitas = [z(200,210,90,9), z(300,310,88,9), z(400,410,86,9), z(500,510,84,9)];
  ok(zonasCandidatas(muitas, niveis, 150, "diario").length === 3,
    "publica no maximo tres, e as de maior score");

  // O campo sai no relatorio, e no bloco DIARIO.
  const linha = blocoTf(r1.texto, "GRAFICO DIARIO", PARES_TESTE[0].label);
  ok(/^zonas_candidatas_a_faixa: /m.test(linha),
    "o bloco diario publica o campo, mesmo quando nao ha candidata");
  const linhaSem = blocoTf(r1.texto, "GRAFICO SEMANAL", PARES_TESTE[0].label);
  ok(/^zonas_candidatas_a_faixa: nenhuma$/m.test(linhaSem),
    "e o semanal publica sempre 'nenhuma', porque la o radar nao roda");
}

console.log("\n== historico: o substrato para medir o que o monitor acerta ==");
{
  // O historico nao decide nada e nao altera o relatorio. Ele grava o
  // que foi PUBLICADO, para um dia dar para responder se cada condicao
  // foi seguida de algum movimento.
  const jsonHist = relatorioParaJSON(r1.texto, r1.zonas);
  const primeira = registrarHistorico(jsonHist, {}, "2026-01-01T00:00:00Z");
  ok(primeira.entradas.length > 0, "a primeira execucao grava uma entrada por par e timeframe");
  ok(primeira.entradas.every((e) => e.par && e.tf && e.vela),
    "toda entrada sabe de que par, timeframe e vela fechada ela fala");
  ok(primeira.entradas.every((e) => typeof e.fech === "number" && e.fech > 0),
    "toda entrada carrega o preco do fechamento: e' dele que sai o retorno futuro");

  // Rodando de hora em hora sobre a MESMA vela fechada, nada muda: sem
  // isso o arquivo cresceria 24 linhas por dia dizendo a mesma coisa.
  const repetida = registrarHistorico(jsonHist, primeira.assinaturas, "2026-01-01T01:00:00Z");
  ok(repetida.entradas.length === 0,
    "reexecucao sobre a mesma vela fechada nao grava linha nova");

  // Mas qualquer condicao nova volta a gravar, na mesma vela.
  const mexido = JSON.parse(JSON.stringify(jsonHist));
  const parAlvo = Object.keys(mexido.diario)[0];
  mexido.diario[parAlvo].alertas_tecnicos = ["condicao_inventada_para_o_teste"];
  const terceira = registrarHistorico(mexido, primeira.assinaturas, "2026-01-01T02:00:00Z");
  ok(terceira.entradas.length === 1 && terceira.entradas[0].par === parAlvo,
    "uma condicao nova na mesma vela grava linha, e so do par que mudou");

  // A assinatura ignora o horario, senao toda execucao pareceria nova.
  const bloco = jsonHist.diario[parAlvo];
  const a1 = assinaturaHistorico(entradaHistorico(parAlvo, "diario", bloco, "2026-01-01T00:00:00Z"));
  const a2 = assinaturaHistorico(entradaHistorico(parAlvo, "diario", bloco, "2026-06-30T23:00:00Z"));
  ok(a1 === a2, "a assinatura nao depende do horario da execucao");

  // Bloco em falha nao entra: registrar uma falha de fonte como se fosse
  // leitura de mercado contaminaria a medicao depois.
  ok(entradaHistorico("X/Y", "diario", { falha: "fonte fora do ar" }, "2026-01-01T00:00:00Z") === null,
    "bloco em FALHA nao vira entrada de historico");
}

console.log("\n== estado entre execucoes ==");
const r2 = await build(fakeFetch(), { niveis: r1.estadoNiveis, zonas: r1.zonasEstado, contadoresZona: r1.contadoresZona });
ok(!/NaN|undefined/.test(r2.texto), "segunda execucao le o estado anterior sem quebrar");

console.log("\n== ancoragem de fuso ==");
ok(ancorarDia(1756425600, 0) === 1756425600, "meia-noite UTC continua na propria data");
ok(ancorarDia(1756436400, -10800) === 1756425600, "carimbo em fuso -03 cai na data local, nao no dia seguinte");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo passou");
process.exit(falhas ? 1 : 0);
