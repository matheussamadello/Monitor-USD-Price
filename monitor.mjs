// ============================================================
// Monitor USD/BRL — snapshot tecnico diario e semanal
// Roda no GitHub Actions, gera docs/index.html e docs/index.txt
// Sem dependencias: usa o fetch nativo do Node 20+.
//
// Mesma engenharia dos monitores de BTC e de XMR. Duas coisas mudam, e
// as duas vem do mercado, nao de gosto:
//
//   1. A fonte nao e' uma corretora de cripto. E' OHLC de cambio do
//      Yahoo Finance, buscado em cascata por dois hosts da provedora.
//      Ver o comentario sobre FONTES para o que ja foi sondado e
//      reprovado como segunda provedora.
//   2. Cambio a vista e' balcao: nao existe volume consolidado publico.
//      Tudo que dependia de volume esta DESLIGADO, e nao zerado — ver
//      montarSerie() e pontuarZona().
//
// A linha "eventos:" mantem exatamente a logica e o texto originais,
// porque uma automacao externa depende dela. Alertas novos vao em
// "alertas_tecnicos:".
// ============================================================

import { writeFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PERIOD = 14;
const EMA_PERIOD = 89;

const TIMEFRAMES = [
  {
    key: "diario",
    titulo: "GRAFICO DIARIO",
    // Cada provedora nomeia o mesmo intervalo do seu jeito.
    intervalos: { yahoo: "1d", binance: "1d", mercadobitcoin: "1d" },
    yahooRange: "5y",
    segundos: 86400,
    // Dias CORRIDOS, nao pregoes: o cambio nao negocia fim de semana,
    // entao estes 30 valem ~21 velas diarias reais.
    retestMaxCandles: 30,
    // A automacao externa le a linha "eventos:" do bloco diario.
    // Por isso o semanal usa um nome diferente, para nunca colidir.
    campoEventos: "eventos",
  },
  {
    key: "semanal",
    titulo: "GRAFICO SEMANAL",
    intervalos: { yahoo: "1wk", binance: "1w", mercadobitcoin: "1w" },
    yahooRange: "10y",
    segundos: 604800,
    retestMaxCandles: 8,
    campoEventos: "eventos_semanal",
  },
];

// ------------------------------------------------------------
// NIVEIS MANUAIS — o unico lugar a editar quando o preco andar.
//
// Tres consumidores leem daqui e so daqui: alertasTecnicos (faixas e
// rompimento/perda intradiarios), niveisDoPar (maquina de estados de
// rompimento/reteste) e avaliarGatilhos (a linha GATILHOS ATIVOS).
//
// Os rotulos usam "_" no lugar do ponto decimal (5_60, e nao 5.60):
// eles entram em identificadores como rompimento_confirmado_5_60 e em
// chaves de docs/estado.json, e um ponto ali atrapalha quem consome.
//
// De onde vieram os valores abaixo (primeira execucao real, 2026-08-29,
// USD/BRL fechando a 5.1611):
//
//   resistencia 5.30 — centro da zona automatica mais forte acima do
//     preco (5.2255-5.3604, centro 5.2930) coincidindo com a EMA89
//     SEMANAL em 5.2926. Duas leituras independentes no mesmo lugar.
//   suporte 5.13 — triplice confluencia: EMA89 diaria em 5.1321, borda
//     inferior da zona de score mais alto (5.1306) e o ultimo fundo mais
//     alto da estrutura, o pivo de 2026-08-24 em 5.1308.
//   faixas — as tres regioes que as zonas automaticas ja marcavam:
//     resistencia 5.25-5.36, campo de batalha atual 5.13-5.21 e o
//     suporte de 5.05-5.12.
//
// Sao uma leitura de um dia, nao uma verdade permanente. Reveja quando o
// preco sair dessas regioes — o proprio relatorio sugere isso quando as
// faixas param de conter o preco.
// ------------------------------------------------------------
const NIVEIS_USD = {
  faixas: [
    [5.25, 5.36, "faixa_5_25_5_36"],
    [5.13, 5.21, "faixa_5_13_5_21"],
    [5.05, 5.12, "regiao_suporte_5_05_5_12"],
  ],
  resistencia: 5.30,
  resistenciaLabel: "5_30",
  suporte: 5.13,
  suporteLabel: "5_13",
};

// ------------------------------------------------------------
// Trilho de execucao (USDT/BRL)
//
// O par ANALISADO continua sendo USD/BRL. Este bloco responde a uma
// pergunta diferente: quando a leitura tecnica disser que e' hora de
// dolarizar ou desdolarizar, quanto custa atravessar de fato, e o
// pedagio esta caro ou barato hoje?
//
// O USDT/BRL NAO entra nos indicadores, e a razao foi medida, nao
// suposta. Sobre 518 dias, o premio do USDT/BRL sobre o USD/BRL variou
// de -2,10% a +3,60% (mediana +0,31%), e a correlacao das variacoes
// diarias ficou em 0,43. Alimentar RSI, DMI, EMA e zonas com essa serie
// trocaria a leitura do dolar pela leitura do dolar MAIS o premio do
// balcao cripto -- com niveis calibrados na casa do decimo de por
// cento, isso nao e' detalhe. Aqui ele fica onde serve: no custo de
// execucao.
// ------------------------------------------------------------

const TRILHO_JANELA = 180; // dias de historico do premio
const TRILHO_PCT_CARO = 75;
const TRILHO_PCT_BARATO = 25;

// A serie do trilho e' a MESMA ja buscada para o par USDT/BRL. Buscar
// de novo daria duas chamadas por execucao e, pior, abriria a chance de
// o bloco do par e o trilho publicarem precos de instantes diferentes.
export function serieParaTrilho(d) {
  const linhas = d.times.map((t, i) => ({
    time: t,
    close: d.closes[i],
    volume: d.volumes[i],
  }));
  linhas.push({ time: d.live.time, close: d.live.close, volume: d.live.volume });
  return linhas;
}

function medianaDe(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentilNa(s, f) {
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : null;
}

export function calcularTrilho(usdt, usd) {
  // A serie de premios so usa dias em que as DUAS pontas negociaram. A
  // cripto opera fim de semana e o cambio nao; casar por data evita
  // comparar o sabado do USDT com a sexta do dolar e chamar isso de
  // premio.
  const porDia = new Map(usdt.map((l) => [l.time, l]));
  const premios = [];
  for (let i = 0; i < usd.times.length; i++) {
    const l = porDia.get(usd.times[i]);
    if (!l || !(usd.closes[i] > 0)) continue;
    premios.push(((l.close - usd.closes[i]) / usd.closes[i]) * 100);
  }
  const janela = premios.slice(-TRILHO_JANELA);
  const ord = janela.slice().sort((a, b) => a - b);

  const atual = usdt[usdt.length - 1];
  const precoUsd = usd.live.close;
  const premioAtual = ((atual.close - precoUsd) / precoUsd) * 100;

  // DEFASAGEM. A cripto negocia 24/7 e o cambio nao. Num domingo, o
  // preco do USDT e' de agora e o do dolar e' de sexta -- o "premio"
  // entre os dois carrega dois dias em que uma ponta andou e a outra
  // estava fechada. Isso nao e' pedagio, e' o mercado tendo se mexido.
  // Publicar a defasagem, e dizer quando o numero nao e' comparavel, e'
  // o que impede alguem de agir sobre um premio que nao existe.
  const defasagemDias =
    Number.isFinite(atual.time) && Number.isFinite(usd.live.time)
      ? Math.round((atual.time - usd.live.time) / 86400)
      : null;

  const pct = ord.length
    ? (ord.filter((x) => x <= premioAtual).length / ord.length) * 100
    : null;
  const classificacao =
    pct === null
      ? "indefinido"
      : pct >= TRILHO_PCT_CARO
      ? "caro"
      : pct <= TRILHO_PCT_BARATO
      ? "barato"
      : "normal";

  // VOLUME. A ultima vela e' o dia em formacao, e a cripto nao fecha:
  // as 3h da manha ela tem tres horas de giro. Compara-la com a mediana
  // de dias INTEIROS daria um "volume 100x abaixo da mediana" que so
  // significa que o dia mal comecou. Entao a referencia e' a ultima
  // vela FECHADA, e a mediana exclui a que esta em formacao.
  const fechadas = usdt.slice(0, -1);
  const ultimaFechada = fechadas[fechadas.length - 1] || null;
  const vols = fechadas
    .slice(-30)
    .map((l) => l.volume)
    .filter((v) => Number.isFinite(v) && v > 0);

  return {
    preco: atual.close,
    dia: atual.time,
    premioPct: premioAtual,
    percentil: pct,
    mediana: medianaDe(janela),
    p25: percentilNa(ord, 0.25),
    p75: percentilNa(ord, 0.75),
    classificacao,
    diasComparados: janela.length,
    usdReferencia: precoUsd,
    usdReferenciaDia: usd.live.time,
    defasagemDias,
    comparavel: defasagemDias === 0,
    volumeUltimoFechado: ultimaFechada ? ultimaFechada.volume : null,
    volumeUltimoFechadoDia: ultimaFechada ? ultimaFechada.time : null,
    volumeMediana30: medianaDe(vols),
  };
}

function blocoTrilho(res, usd, dec) {
  const L = ["========== TRILHO DE EXECUCAO ==========", ""];
  if (!res.ok || !usd) {
    L.push("trilho_disponivel: nao");
    L.push(`trilho_falha: ${res.ok ? "sem serie de USD/BRL para comparar" : res.erro}`);
    return L;
  }
  const t = calcularTrilho(res.linhas, usd);
  L.push("# USDT/BRL. NAO entra em nenhum indicador: e' o custo de");
  L.push("# atravessar, nao a leitura tecnica do dolar.");
  L.push("# Premio ALTO encarece dolarizar (comprar USDT) e favorece");
  L.push("# desdolarizar (vender USDT). Premio BAIXO, o contrario.");
  L.push("trilho_disponivel: sim");
  L.push(`trilho_par: USDT/BRL`);
  L.push(`trilho_fonte: ${res.fonte}`);
  L.push(`trilho_preco: ${num(t.preco, dec)}`);
  L.push(`trilho_dia: ${fmtDia(t.dia)}`);
  L.push(`trilho_premio_pct: ${num(t.premioPct, 2)}`);
  L.push(`trilho_usd_referencia: ${num(t.usdReferencia, dec)}`);
  L.push(`trilho_usd_referencia_dia: ${fmtDia(t.usdReferenciaDia)}`);
  L.push(
    `trilho_premio_defasagem_dias: ${t.defasagemDias === null ? "--" : t.defasagemDias}`
  );
  // Fora do pregao de cambio as duas pontas nao sao do mesmo instante.
  // O premio continua publicado, mas marcado como nao comparavel.
  L.push(`trilho_premio_comparavel: ${t.comparavel ? "sim" : "nao"}`);
  L.push(`trilho_premio_janela_dias: ${TRILHO_JANELA}`);
  L.push(`trilho_premio_dias_comparados: ${t.diasComparados}`);
  L.push(`trilho_premio_percentil: ${num(t.percentil, 0)}`);
  L.push(`trilho_premio_mediana: ${num(t.mediana, 2)}`);
  L.push(`trilho_premio_p25: ${num(t.p25, 2)}`);
  L.push(`trilho_premio_p75: ${num(t.p75, 2)}`);
  L.push(`trilho_premio_classificacao: ${t.classificacao}`);
  L.push(`trilho_volume_usdt_ultimo_fechado: ${num(t.volumeUltimoFechado, 0)}`);
  L.push(
    `trilho_volume_usdt_ultimo_fechado_dia: ${
      t.volumeUltimoFechadoDia ? fmtDia(t.volumeUltimoFechadoDia) : "--"
    }`
  );
  L.push(`trilho_volume_usdt_mediana_30d: ${num(t.volumeMediana30, 0)}`);
  return L;
}

// ------------------------------------------------------------
// Indicadores (suavizacao de Wilder / RMA, igual TradingView)
// ------------------------------------------------------------

function rsiFrom(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function rsiSeries(closes, period = PERIOD) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gainSum += d;
    else lossSum -= d;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

export function dmiSeries(highs, lows, closes, period = PERIOD) {
  const n = closes.length;
  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const adx = new Array(n).fill(null);
  if (n < 2 * period) return { plusDI, minusDI, adx };

  const tr = new Array(n).fill(0);
  const pDM = new Array(n).fill(0);
  const mDM = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    pDM[i] = up > down && up > 0 ? up : 0;
    mDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }

  let trS = 0;
  let pS = 0;
  let mS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i];
    pS += pDM[i];
    mS += mDM[i];
  }

  const dx = new Array(n).fill(null);
  const writeDI = (i) => {
    const p = trS === 0 ? 0 : (100 * pS) / trS;
    const m = trS === 0 ? 0 : (100 * mS) / trS;
    plusDI[i] = p;
    minusDI[i] = m;
    dx[i] = p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m);
  };

  writeDI(period);
  for (let i = period + 1; i < n; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + pDM[i];
    mS = mS - mS / period + mDM[i];
    writeDI(i);
  }

  const firstAdx = 2 * period - 1;
  if (n > firstAdx) {
    let sum = 0;
    for (let i = period; i <= firstAdx; i++) sum += dx[i];
    adx[firstAdx] = sum / period;
    for (let i = firstAdx + 1; i < n; i++) {
      adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
    }
  }

  return { plusDI, minusDI, adx };
}

// EMA exponencial padrao: semente SMA no primeiro ponto valido,
// depois close * k + ema_anterior * (1 - k), com k = 2/(n+1).
export function emaSeries(values, period = EMA_PERIOD) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let soma = 0;
  for (let i = 0; i < period; i++) soma += values[i];
  out[period - 1] = soma / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

// ------------------------------------------------------------
// Fontes de OHLC de cambio
//
// Em cascata, e nao uma so: a fonte nao publica SLA, e uma execucao sem
// dado apagaria a leitura do dia. O cabecalho do relatorio sempre diz
// qual elo respondeu.
// ------------------------------------------------------------

const MAX_VELAS = 720; // mesmo horizonte que os monitores de cripto usam

// O Stooq era o segundo elo desta cascata e SAIU em 2026-08-30. Ele
// passou a responder HTTP 200 com um desafio de JavaScript ("This site
// requires JavaScript to verify your browser") em vez do CSV. Um fetch
// de Node nunca vai resolver esse desafio, entao o fallback estava
// morto sem fazer barulho: so falharia junto com o Yahoo, que e'
// exatamente quando ele precisaria funcionar. Nao readicione sem
// verificar com uma sonda que ele voltou a servir CSV.
//
// Foram sondados como substitutos, e todos reprovaram:
//   FXCM candledata      404, servico desativado
//   AwesomeAPI           429 QuotaExceeded a partir de IP de runner
//   Pyth Network         so 1 mes de historico (ranges: 1H, 1D, 1W, 1M)
//   Frankfurter/BCE      so fechamento, sem maxima e minima
//
// O que restou e' um espelho de HOST da mesma provedora. Isso NAO
// protege contra o Yahoo mudar o formato ou tirar o par do ar -- protege
// contra o modo de falha que de fato acontece, que e' um host especifico
// bloquear ou limitar o IP do runner. E' menos redundancia do que havia
// no papel, e mais do que havia na pratica.
const HOSTS_YAHOO = ["query1", "query2"];

const FONTES_CAMBIO = HOSTS_YAHOO.map((host) => ({
  nome: `yahoo/${host}`,
  url: (cfg, tf) =>
    `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cfg.simbolo)}` +
    `?interval=${tf.intervalos.yahoo}&range=${tf.yahooRange}`,
  parse: parseYahoo,
}));

// Cascata do par de cripto. Aqui, ao contrario do cambio, existem duas
// provedoras de verdade e nao um espelho de host.
//
// O api.binance.com devolve HTTP 451 a partir de IP de runner do GitHub
// ("Service unavailable from a restricted location"), que fica nos EUA.
// O data-api.binance.vision e' o espelho publico de dados da propria
// Binance e responde normalmente.
const FONTES_CRIPTO = [
  {
    nome: "binance",
    url: (cfg, tf) =>
      "https://data-api.binance.vision/api/v3/klines" +
      `?symbol=${encodeURIComponent(cfg.simbolo)}&interval=${tf.intervalos.binance}&limit=1000`,
    parse: parseBinance,
  },
  {
    nome: "mercadobitcoin",
    url: (cfg, tf) => {
      const agora = Math.floor(Date.now() / 1000);
      return (
        "https://api.mercadobitcoin.net/api/v4/candles" +
        `?symbol=${encodeURIComponent(cfg.simboloMB)}&resolution=${tf.intervalos.mercadobitcoin}` +
        `&from=${agora - MAX_VELAS * (tf.segundos || 86400)}&to=${agora}`
      );
    },
    parse: parseMercadoBitcoin,
  },
];

// ------------------------------------------------------------
// NIVEIS DO USDT/BRL
//
// Par SEPARADO, com niveis proprios, e nao os do USD/BRL somados de um
// premio fixo: o premio nao e' fixo. Medido em 518 dias, ele foi de
// -2,10% a +3,60% (mediana +0,31%). Um nivel derivado do dolar estaria
// errado justamente nos dias em que o premio se mexe, que sao os dias
// que importam para quem vai atravessar.
//
// Assim como os do USD/BRL, saem das zonas automaticas e das medias da
// primeira execucao real (2026-08-30, USDT/BRL a 5.2133), nao de numero
// redondo escolhido a mao:
//
//   resistencia 5.31 — centro da zona diaria de score 74, a mais
//     testada acima do preco (13 toques, 11 rejeicoes), com a EMA89
//     SEMANAL logo acima em 5.3296 e a zona semanal de score 72
//     cobrindo 5.2755-5.4300. Tres leituras na mesma regiao.
//   suporte 5.15 — triplice confluencia: EMA89 diaria em 5.1549, centro
//     da zona diaria de score 81 em 5.1532, e a zona semanal de score
//     80 (5.1050-5.2300) por dentro.
//   faixas — as tres regioes que as zonas ja marcavam: resistencia
//     5.27-5.35, campo de batalha atual 5.17-5.22 (o preco esta nela) e
//     o suporte 5.12-5.16.
// ------------------------------------------------------------
const NIVEIS_USDT = {
  faixas: [
    [5.27, 5.35, "faixa_5_27_5_35"],
    [5.17, 5.22, "faixa_5_17_5_22"],
    [5.12, 5.16, "regiao_suporte_5_12_5_16"],
  ],
  resistencia: 5.31,
  resistenciaLabel: "5_31",
  suporte: 5.15,
  suporteLabel: "5_15",
};

// A ORDEM IMPORTA: o USD/BRL vem primeiro porque e' a referencia
// analitica, e o bloco diario dele e' o que a automacao externa le.
const PAIRS = [
  {
    key: "usd",
    // O ativo monitorado e' o DOLAR; o real e' a moeda de cotacao. Por
    // isso o par se escreve USD/BRL e o preco sobe quando o dolar sobe.
    label: "USD/BRL",
    simbolo: "USDBRL=X",
    fontes: FONTES_CAMBIO,
    // 4 casas: o par se move em milesimos, e 2 casas apagariam a
    // diferenca entre uma vela parada e uma vela de meio por cento.
    dec: 4,
    niveis: NIVEIS_USD,
  },
  {
    key: "usdt",
    // O instrumento de EXECUCAO: e' nele que se dolariza e desdolariza
    // rapido. Tem a analise tecnica completa, com uma vantagem sobre o
    // par de cambio -- negocia em corretora, entao tem volume de
    // verdade, e todo o subsistema de volume funciona aqui.
    label: "USDT/BRL",
    simbolo: "USDTBRL",
    simboloMB: "USDT-BRL",
    fontes: FONTES_CRIPTO,
    dec: 4,
    niveis: NIVEIS_USDT,
  },
];

const PAR_POR_LABEL = new Map(PAIRS.map((c) => [c.label, c]));

// Toda vela e' ancorada na MEIA-NOITE UTC do proprio dia, venha de onde
// vier. Sem isso as duas fontes cairiam em grades diferentes — o Yahoo
// carimba a vela no fuso da bolsa, o Stooq so manda a data — e o estado
// persistido em docs/estado.json passaria a comparar velas que nao sao
// a mesma vela.
export function ancorarDia(epochSeconds, offsetSegundos = 0) {
  const dia = new Date((epochSeconds + offsetSegundos) * 1000)
    .toISOString()
    .slice(0, 10);
  return Math.floor(Date.parse(`${dia}T00:00:00Z`) / 1000);
}

function montarSerie(linhas, { temVolume = false } = {}) {
  // Uma entrada por instante, a ultima vence: o Yahoo repete a vela do
  // dia corrente a cada chamada e o Stooq pode repetir a borda.
  const porTempo = new Map();
  for (const l of linhas) {
    if (![l.open, l.high, l.low, l.close].every((v) => Number.isFinite(v))) continue;
    // VELA-FANTASMA. Fora do pregao — fim de semana, feriado — o Yahoo
    // acrescenta uma vela carimbada AGORA com o ultimo preco repetido
    // nas quatro pontas, amplitude zero. Nao e' sessao: entrando na
    // serie, ela vira a "vela em formacao" de sabado, faz o relatorio
    // publicar um preco que nao fechou em lugar nenhum e diz
    // vela_atual_em_formacao: sim com o mercado fechado.
    //
    // Amplitude zero e' o criterio porque nao depende de calendario:
    // pega feriado e meio-pregao do mesmo jeito, sem embutir o
    // calendario de nenhuma praca. Um dia inteiro de USD/BRL ou de
    // USDT/BRL sem UM pip de variacao nao existe, entao nao ha vela
    // legitima sendo descartada aqui.
    if (l.high === l.low) continue;
    porTempo.set(l.time, l);
  }
  const rows = [...porTempo.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_VELAS);
  if (rows.length < 2 * PERIOD + 2) {
    throw new Error("velas insuficientes para calcular os indicadores");
  }
  const liveRow = rows[rows.length - 1];
  const closed = rows.slice(0, -1);
  // VOLUME. Quem decide e' a provedora, nao este arquivo. O cambio a
  // vista e' balcao e nao tem tape consolidado publico: as fontes de
  // USD/BRL ou mandam zero ou nao mandam o campo, e temVolume: false e'
  // o que desliga o volume no score das zonas e no relatorio — o
  // contrario seria ler zero como "volume fraco" e penalizar toda zona
  // por um dado que nunca existiu. Ja o USDT/BRL negocia em corretora,
  // com livro e tape: ali o volume e' real e entra na analise.
  return {
    temVolume,
    live: {
      time: liveRow.time,
      open: liveRow.open,
      high: liveRow.high,
      low: liveRow.low,
      close: liveRow.close,
      volume: temVolume ? liveRow.volume : null,
      trades: temVolume && Number.isFinite(liveRow.trades) ? liveRow.trades : null,
    },
    times: closed.map((r) => r.time),
    opens: closed.map((r) => r.open),
    highs: closed.map((r) => r.high),
    lows: closed.map((r) => r.low),
    closes: closed.map((r) => r.close),
    volumes: temVolume ? closed.map((r) => r.volume) : [],
    trades: temVolume ? closed.map((r) => (Number.isFinite(r.trades) ? r.trades : 0)) : [],
  };
}

export function parseYahoo(texto) {
  const json = JSON.parse(texto);
  const erro = json && json.chart && json.chart.error;
  if (erro) throw new Error("Yahoo: " + (erro.description || erro.code || "erro"));
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !Array.isArray(r.timestamp)) throw new Error("Yahoo: resposta sem series");
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  // Feriado e fim de semana chegam como null nas quatro pontas; o filtro
  // de montarSerie descarta essas linhas.
  const off = Number((r.meta && r.meta.gmtoffset) || 0);
  const linhas = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    linhas.push({
      time: ancorarDia(Number(r.timestamp[i]), off),
      open: Number(q.open && q.open[i]),
      high: Number(q.high && q.high[i]),
      low: Number(q.low && q.low[i]),
      close: Number(q.close && q.close[i]),
    });
  }
  return montarSerie(linhas);
}

export function parseBinance(texto) {
  const k = JSON.parse(texto);
  if (!Array.isArray(k)) throw new Error("Binance: resposta nao e' lista de klines");
  return montarSerie(
    // kline: [openTime, open, high, low, close, volume, closeTime,
    //         quoteVolume, trades, ...]
    k.map((x) => ({
      time: ancorarDia(Math.floor(Number(x[0]) / 1000)),
      open: Number(x[1]),
      high: Number(x[2]),
      low: Number(x[3]),
      close: Number(x[4]),
      volume: Number(x[5]),
      trades: Number(x[8]),
    })),
    { temVolume: true }
  );
}

export function parseMercadoBitcoin(texto) {
  const j = JSON.parse(texto);
  if (!Array.isArray(j.t)) throw new Error("Mercado Bitcoin: resposta sem series");
  return montarSerie(
    j.t.map((ts, i) => ({
      time: ancorarDia(Number(ts)),
      open: Number(j.o[i]),
      high: Number(j.h[i]),
      low: Number(j.l[i]),
      close: Number(j.c[i]),
      volume: Number(j.v[i]),
    })),
    { temVolume: true }
  );
}

// Percorre as fontes na ordem e devolve a primeira que responder. Os
// erros de TODAS ficam na mensagem: quando as duas caem, o bloco do
// relatorio precisa dizer por que cada uma caiu, senao a investigacao
// comeca do zero.
export async function buscarSerie(fetchImpl, cfg, tf) {
  const erros = [];
  for (const fonte of cfg.fontes) {
    try {
      const res = await fetchImpl(fonte.url(cfg, tf), {
        headers: { "User-Agent": "usd-monitor/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = fonte.parse(await res.text());
      return { ok: true, parsed, fonte: fonte.nome };
    } catch (err) {
      erros.push(`${fonte.nome}: ${err.message}`);
    }
  }
  return { ok: false, erro: erros.join(" | ") };
}

function fmtUTC(epochSeconds) {
  return (
    new Date(epochSeconds * 1000).toISOString().slice(0, 16).replace("T", " ") +
    " UTC"
  );
}

function fmtDia(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function num(v, dec) {
  return v === null || v === undefined || Number.isNaN(v) ? "--" : v.toFixed(dec);
}

// ------------------------------------------------------------
// Anatomia de vela e padroes
// ------------------------------------------------------------

function anatomia(o, h, l, c) {
  const corpo = Math.abs(c - o);
  const amplitude = h - l;
  return {
    open: o,
    high: h,
    low: l,
    close: c,
    corpo,
    amplitude,
    sombraSup: h - Math.max(o, c),
    sombraInf: Math.min(o, c) - l,
    alta: c > o,
    baixa: c < o,
    corpoRelevante: amplitude > 0 && corpo / amplitude >= 0.5,
  };
}

function velasFechadas(d, quantas) {
  const out = [];
  const n = d.closes.length;
  for (let k = 0; k < quantas; k++) {
    const i = n - 1 - k;
    if (i < 0) break;
    const v = anatomia(d.opens[i], d.highs[i], d.lows[i], d.closes[i]);
    v.time = d.times[i];
    v.volume = d.volumes ? d.volumes[i] : null;
    out.push(v);
  }
  return out; // out[0] = mais recente
}

// Mediana dos corpos das ultimas N velas fechadas. Serve de escala
// relativa: um limiar absoluto de corpo seria arbitrario, e o USD/BRL
// alterna regimes de volatilidade — a mediana acompanha sozinha.
function medianaCorpos(opens, closes, n = 20) {
  const corpos = [];
  for (let i = Math.max(0, closes.length - n); i < closes.length; i++) {
    corpos.push(Math.abs(closes[i] - opens[i]));
  }
  if (!corpos.length) return null;
  corpos.sort((a, b) => a - b);
  const m = Math.floor(corpos.length / 2);
  return corpos.length % 2 ? corpos[m] : (corpos[m - 1] + corpos[m]) / 2;
}

// Criterios geometricos de "vela compradora forte".
// Nao e' Marubozu: sombras sao toleradas, so nao podem dominar.
const CORPO_RANGE_MIN = 0.55; // corpo / (high - low)
const FECHA_PERTO_MAX = 0.70; // (close - low) / (high - low)
const SOMBRA_SUP_MAX = 0.40; // sombra superior / corpo
const CORPO_VS_MEDIANA = 0.75; // corpo / mediana dos ultimos 20 corpos

function compradoraForte(v, mediana) {
  if (!v.alta) return false;
  if (!(v.amplitude > 0) || !(v.corpo > 0)) return false;
  if (v.corpo / v.amplitude < CORPO_RANGE_MIN) return false;
  if ((v.close - v.low) / v.amplitude < FECHA_PERTO_MAX) return false;
  if (v.sombraSup > SOMBRA_SUP_MAX * v.corpo) return false;
  if (mediana && mediana > 0 && v.corpo < CORPO_VS_MEDIANA * mediana) return false;
  return true;
}

function vendedoraForte(v, mediana) {
  if (!v.baixa) return false;
  if (!(v.amplitude > 0) || !(v.corpo > 0)) return false;
  if (v.corpo / v.amplitude < CORPO_RANGE_MIN) return false;
  if ((v.high - v.close) / v.amplitude < FECHA_PERTO_MAX) return false;
  if (v.sombraInf > SOMBRA_SUP_MAX * v.corpo) return false;
  if (mediana && mediana > 0 && v.corpo < CORPO_VS_MEDIANA * mediana) return false;
  return true;
}

// Abertura dentro (ou muito proxima) do corpo real da vela anterior.
function abreNoCorpoAnterior(atual, ant, alta) {
  const topoCorpo = Math.max(ant.open, ant.close);
  const baseCorpo = Math.min(ant.open, ant.close);
  const folga = 0.1 * ant.corpo;
  return alta
    ? atual.open >= baseCorpo && atual.open <= topoCorpo + folga
    : atual.open <= topoCorpo && atual.open >= baseCorpo - folga;
}

function tresSoldados(v, mediana) {
  if (v.length < 3) return false;
  const [c3, c2, c1] = [v[0], v[1], v[2]]; // c1 = mais antiga
  const seq = [c1, c2, c3];
  if (!seq.every((c) => compradoraForte(c, mediana))) return false;
  if (!(c2.close > c1.close && c3.close > c2.close)) return false;
  return abreNoCorpoAnterior(c2, c1, true) && abreNoCorpoAnterior(c3, c2, true);
}

function tresCorvos(v, mediana) {
  if (v.length < 3) return false;
  const [c3, c2, c1] = [v[0], v[1], v[2]];
  const seq = [c1, c2, c3];
  if (!seq.every((c) => vendedoraForte(c, mediana))) return false;
  if (!(c2.close < c1.close && c3.close < c2.close)) return false;
  return abreNoCorpoAnterior(c2, c1, false) && abreNoCorpoAnterior(c3, c2, false);
}

function detectarPadroes(v, mediana) {
  const achados = [];
  if (v.length < 2) return achados;
  const a = v[0]; // mais recente fechada
  const b = v[1]; // anterior

  if (tresSoldados(v, mediana)) achados.push("tres_soldados_brancos");
  if (tresCorvos(v, mediana)) achados.push("tres_corvos_negros");

  if (b.baixa && a.alta && a.close > b.open && a.open < b.close)
    achados.push("bullish_engulfing");
  if (b.alta && a.baixa && a.close < b.open && a.open > b.close)
    achados.push("bearish_engulfing");

  if (a.corpo > 0 && a.sombraInf >= 2 * a.corpo && a.sombraSup <= a.corpo)
    achados.push("hammer");
  if (a.corpo > 0 && a.sombraSup >= 2 * a.corpo && a.sombraInf <= a.corpo)
    achados.push("shooting_star");

  return achados;
}

function padraoEmFormacao(v, live, mediana) {
  // Duas fechadas ja validas como soldados/corvos + a vela em formacao
  // atendendo AGORA aos mesmos criterios geometricos. Se ela perder
  // forca durante o dia, o padrao some sozinho na proxima execucao.
  if (v.length < 2) return [];
  const [c2, c1] = [v[0], v[1]]; // c1 = mais antiga das duas
  const viva = anatomia(live.open, live.high, live.low, live.close);
  const fora = [];

  const duasAltas =
    compradoraForte(c1, mediana) &&
    compradoraForte(c2, mediana) &&
    c2.close > c1.close &&
    abreNoCorpoAnterior(c2, c1, true);
  if (
    duasAltas &&
    compradoraForte(viva, mediana) &&
    viva.close > c2.close &&
    abreNoCorpoAnterior(viva, c2, true)
  ) {
    fora.push("possiveis_tres_soldados_brancos");
  }

  const duasBaixas =
    vendedoraForte(c1, mediana) &&
    vendedoraForte(c2, mediana) &&
    c2.close < c1.close &&
    abreNoCorpoAnterior(c2, c1, false);
  if (
    duasBaixas &&
    vendedoraForte(viva, mediana) &&
    viva.close < c2.close &&
    abreNoCorpoAnterior(viva, c2, false)
  ) {
    fora.push("possiveis_tres_corvos_negros");
  }

  return fora;
}


// ------------------------------------------------------------
// Contexto e degradacoes do padrao de tres velas
//
// Tres Soldados Brancos e' um padrao de REVERSAO na definicao de
// Nison: a forma so tem o significado original quando aparece depois
// de queda ou em regiao de preco deprimida. A mesma geometria no meio
// de uma alta madura e' continuacao — ou exaustao. Por isso a forma e
// o contexto sao reportados em campos separados.
// ------------------------------------------------------------

const CTX_LOOKBACK = 10;

function contextoAntesDoTrio(closes, idxReferencia, lookback = CTX_LOOKBACK) {
  const fim = idxReferencia;
  const ini = fim - lookback;
  if (ini < 0 || fim < 0 || fim >= closes.length) return "indefinido";
  const janela = closes.slice(ini, fim + 1);
  const min = Math.min(...janela);
  const max = Math.max(...janela);
  const amplitude = max - min;
  if (!(amplitude > 0)) return "lateral";

  // Inclinacao por media de metades: menos sensivel a ruido de uma
  // vela isolada do que comparar apenas os dois extremos da janela.
  const meio = Math.floor(janela.length / 2);
  const media = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const m1 = media(janela.slice(0, meio));
  const m2 = media(janela.slice(meio));
  let inclinacao = "lateral";
  if (m2 < m1 * 0.99) inclinacao = "queda";
  else if (m2 > m1 * 1.01) inclinacao = "alta";

  // Posicao usa a media das 3 ultimas, nao um fechamento solto.
  const ref = media(janela.slice(-3));
  const posicao = (ref - min) / amplitude;

  if (inclinacao === "queda" && posicao <= 0.4) return "queda_regiao_baixa";
  if (inclinacao === "queda") return "queda";
  if (posicao <= 0.35) return "regiao_baixa";
  if (inclinacao === "alta" && posicao >= 0.6) return "alta_regiao_alta";
  if (inclinacao === "alta") return "alta";
  if (posicao >= 0.65) return "regiao_alta";
  return "lateral";
}

// Evidencias de que a alta esta perdendo forca. Estar em regiao alta
// NAO e' uma delas: posicao no range diz onde o preco esta, nao que a
// pressao compradora acabou.
function evidenciasFraqueza(trio, enfraquecimento, divergencias, estruturaEventos) {
  const ev = [];
  for (const e of enfraquecimento || []) ev.push(e);

  for (const d of divergencias || []) {
    if (d.tipo.startsWith("bearish")) ev.push(`divergencia_${d.tipo}`);
  }

  if (trio && trio.length >= 3) {
    const [c3, c2, c1] = [trio[0], trio[1], trio[2]];
    if (c2.sombraSup > c1.sombraSup && c3.sombraSup > c2.sombraSup)
      ev.push("sombras_superiores_crescentes");
  }

  for (const e of estruturaEventos || []) {
    if (e === "perda_estrutura_alta_novo_LL" || e === "topo_mais_baixo_apos_HH")
      ev.push(`estrutura_${e}`);
  }

  return ev;
}

function classificarContextoSoldados(ctx, fraqueza = []) {
  if (ctx.includes("queda") || ctx.includes("regiao_baixa"))
    return "reversao_valida";
  if (ctx.includes("alta"))
    return fraqueza.length ? "exaustao_possivel" : "continuacao";
  if (ctx === "lateral") return "lateral_significado_fraco";
  return "indefinido";
}

function classificarContextoCorvosComFraqueza(ctx, forca = []) {
  if (ctx.includes("alta")) return "reversao_valida";
  if (ctx.includes("queda") || ctx.includes("regiao_baixa"))
    return forca.length ? "exaustao_possivel" : "continuacao";
  if (ctx === "lateral") return "lateral_significado_fraco";
  return "indefinido";
}

// A estrutura HH/HL/LH/LL CONFIRMA ou CONTRADIZ a leitura da janela de
// 10 velas. Nao substitui: os dois campos convivem no relatorio.
function confirmacaoEstrutural(ctx, tendencia) {
  if (!tendencia || tendencia === "lateral_indefinida") return "neutro";
  const ctxBaixa = ctx.includes("queda") || ctx.includes("regiao_baixa");
  const ctxAlta = ctx.includes("alta");
  if (ctxBaixa && tendencia === "baixa") return "confirma";
  if (ctxAlta && tendencia === "alta") return "confirma";
  if (ctxBaixa && tendencia === "alta") return "contradiz";
  if (ctxAlta && tendencia === "baixa") return "contradiz";
  return "neutro";
}



// Por que o trio NAO virou padrao. So faz sentido quando a sequencia
// basica (tres altas com fechamentos progressivos) ja existe.
function diagnosticoSoldados(v, mediana) {
  if (v.length < 3) return "velas_insuficientes";
  const [c3, c2, c1] = [v[0], v[1], v[2]];
  const seq = [c1, c2, c3];
  if (!seq.every((c) => c.alta)) return "nao_aplicavel";
  if (!(c2.close > c1.close && c3.close > c2.close))
    return "fechamentos_nao_progressivos";

  const falhas = [];
  seq.forEach((c, idx) => {
    const nome = `c${idx + 1}`;
    if (!(c.amplitude > 0) || !(c.corpo > 0)) falhas.push(`${nome}:sem_corpo`);
    else {
      if (c.corpo / c.amplitude < CORPO_RANGE_MIN)
        falhas.push(`${nome}:corpo_range_${(c.corpo / c.amplitude).toFixed(2)}`);
      if ((c.close - c.low) / c.amplitude < FECHA_PERTO_MAX)
        falhas.push(
          `${nome}:fecha_longe_da_maxima_${((c.close - c.low) / c.amplitude).toFixed(2)}`
        );
      if (c.sombraSup > SOMBRA_SUP_MAX * c.corpo)
        falhas.push(`${nome}:sombra_sup_${(c.sombraSup / c.corpo).toFixed(2)}x_corpo`);
      if (mediana && mediana > 0 && c.corpo < CORPO_VS_MEDIANA * mediana)
        falhas.push(`${nome}:corpo_pequeno_${(c.corpo / mediana).toFixed(2)}x_mediana`);
    }
  });
  if (!abreNoCorpoAnterior(c2, c1, true)) falhas.push("c2:abre_fora_do_corpo_anterior");
  if (!abreNoCorpoAnterior(c3, c2, true)) falhas.push("c3:abre_fora_do_corpo_anterior");

  return falhas.length ? falhas.join(" ") : "nenhuma";
}

// Advance block e stalled pattern: a forma aparece, mas degradando.
// Sao sinais de ENFRAQUECIMENTO da alta, nao de forca.
function detectarEnfraquecimento(v) {
  const out = [];
  if (v.length < 3) return out;
  const [c3, c2, c1] = [v[0], v[1], v[2]];
  const seq = [c1, c2, c3];
  if (!seq.every((c) => c.alta && c.corpo > 0)) return out;
  if (!(c2.close > c1.close && c3.close > c2.close)) return out;

  const corposCaindo = c2.corpo < c1.corpo && c3.corpo < c2.corpo;
  const sombrasCrescendo = c2.sombraSup > c1.sombraSup && c3.sombraSup > c2.sombraSup;
  if (corposCaindo && sombrasCrescendo) out.push("advance_block");

  if (c3.corpo < 0.5 * c2.corpo && c3.sombraSup > c3.corpo)
    out.push("stalled_pattern");

  return out;
}

// ------------------------------------------------------------
// Pivos, estrutura de mercado, divergencias de RSI e volume
//
// METODOLOGIA DE PIVOS (fractal com confirmacao a direita):
// um indice p e' pivo de topo se high[p] for estritamente maior que
// os PIVO_ESQ candles anteriores e MAIOR OU IGUAL aos PIVO_DIR
// posteriores. Pivo de fundo e' o espelho, com low.
// Como sao exigidos PIVO_DIR candles POSTERIORES, um pivo so existe
// depois que essas velas fecharam. Isso elimina look-ahead: os
// ultimos PIVO_DIR candles fechados nunca sao classificados como
// pivo, e a vela em formacao nunca entra nesse calculo.
// ------------------------------------------------------------

const PIVO_ESQ = 2;
const PIVO_DIR = 2;
const DIV_JANELA = 60; // pivos mais antigos que isso sao ignorados
const DIV_SEP_MIN = 5; // distancia minima, em velas, entre os dois pivos
const DIV_MIN_PRECO_PCT = 0.15; // variacao minima de preco entre pivos, em %
const DIV_MIN_RSI = 2; // variacao minima de RSI entre pivos, em pontos
const VOL_MEDIA = 20;

export function acharPivos(highs, lows, esq = PIVO_ESQ, dir = PIVO_DIR) {
  const altos = [];
  const baixos = [];
  const n = highs.length;
  for (let p = esq; p < n - dir; p++) {
    let topo = true;
    let fundo = true;
    for (let k = 1; k <= esq; k++) {
      if (!(highs[p] > highs[p - k])) topo = false;
      if (!(lows[p] < lows[p - k])) fundo = false;
    }
    for (let k = 1; k <= dir; k++) {
      if (!(highs[p] >= highs[p + k])) topo = false;
      if (!(lows[p] <= lows[p + k])) fundo = false;
    }
    if (topo) altos.push(p);
    if (fundo) baixos.push(p);
  }
  return { altos, baixos };
}

// HH/HL/LH/LL a partir dos dois ultimos pivos de cada tipo.
export function classificarEstrutura(highs, lows, pivos) {
  const { altos, baixos } = pivos;
  const topo =
    altos.length >= 2
      ? highs[altos[altos.length - 1]] > highs[altos[altos.length - 2]]
        ? "HH"
        : "LH"
      : null;
  const fundo =
    baixos.length >= 2
      ? lows[baixos[baixos.length - 1]] > lows[baixos[baixos.length - 2]]
        ? "HL"
        : "LL"
      : null;

  let tendencia = "lateral_indefinida";
  if (topo === "HH" && fundo === "HL") tendencia = "alta";
  else if (topo === "LH" && fundo === "LL") tendencia = "baixa";

  const rotulo = topo && fundo ? `${topo}_${fundo}` : "indefinida";
  return { topo, fundo, rotulo, tendencia };
}

// Quebra de estrutura: LL logo depois de uma sequencia de HL, ou
// HH logo depois de uma sequencia de LH.
export function mudancaEstrutura(highs, lows, pivos) {
  const { altos, baixos } = pivos;
  const eventos = [];
  if (baixos.length >= 3) {
    const [a, b, c] = baixos.slice(-3).map((p) => lows[p]);
    if (b > a && c < b) eventos.push("perda_estrutura_alta_novo_LL");
    if (b < a && c > b) eventos.push("novo_HL_apos_fundo_mais_baixo");
  }
  if (altos.length >= 3) {
    const [a, b, c] = altos.slice(-3).map((p) => highs[p]);
    if (b < a && c > b) eventos.push("novo_HH_apos_topo_mais_baixo");
    if (b > a && c < b) eventos.push("topo_mais_baixo_apos_HH");
  }
  return eventos;
}

// ------------------------------------------------------------
// Divergencias de RSI, comparando pivo com pivo
// ------------------------------------------------------------

function variacaoPct(a, b) {
  return b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100;
}

export function detectarDivergencias(highs, lows, rsi, pivos) {
  const achadas = [];
  const n = lows.length;
  const ultimo = n - 1;

  const valido = (p) =>
    rsi[p] !== null && rsi[p] !== undefined && ultimo - p <= DIV_JANELA;

  // --- fundos: bullish regular e bearish oculta ---
  const fundos = pivos.baixos.filter(valido);
  if (fundos.length >= 2) {
    const p2 = fundos[fundos.length - 1];
    const p1 = fundos[fundos.length - 2];
    if (p2 - p1 >= DIV_SEP_MIN) {
      const dPreco = variacaoPct(lows[p2], lows[p1]);
      const dRsi = rsi[p2] - rsi[p1];
      if (Math.abs(dPreco) >= DIV_MIN_PRECO_PCT && Math.abs(dRsi) >= DIV_MIN_RSI) {
        if (dPreco < 0 && dRsi > 0)
          achadas.push(det("bullish_regular", p1, p2, lows, rsi, "fundo"));
        if (dPreco > 0 && dRsi < 0)
          achadas.push(det("bullish_oculta", p1, p2, lows, rsi, "fundo"));
      }
    }
  }

  // --- topos: bearish regular e bullish oculta ---
  const topos = pivos.altos.filter(valido);
  if (topos.length >= 2) {
    const p2 = topos[topos.length - 1];
    const p1 = topos[topos.length - 2];
    if (p2 - p1 >= DIV_SEP_MIN) {
      const dPreco = variacaoPct(highs[p2], highs[p1]);
      const dRsi = rsi[p2] - rsi[p1];
      if (Math.abs(dPreco) >= DIV_MIN_PRECO_PCT && Math.abs(dRsi) >= DIV_MIN_RSI) {
        if (dPreco > 0 && dRsi < 0)
          achadas.push(det("bearish_regular", p1, p2, highs, rsi, "topo"));
        if (dPreco < 0 && dRsi > 0)
          achadas.push(det("bearish_oculta", p1, p2, highs, rsi, "topo"));
      }
    }
  }

  return achadas;
}

function det(tipo, p1, p2, precos, rsi, lado) {
  return {
    tipo,
    lado,
    confirmada: true,
    idxAnterior: p1,
    idxAtual: p2,
    precoAnterior: precos[p1],
    precoAtual: precos[p2],
    rsiAnterior: rsi[p1],
    rsiAtual: rsi[p2],
  };
}

// Divergencia PROVISORIA: compara o ultimo pivo confirmado com a
// vela em formacao. Nunca confirmada — a vela ainda pode mudar.
export function divergenciaProvisoria(highs, lows, rsi, rsiProv, pivos, live) {
  const n = lows.length;
  const idxViva = n; // posicao da vela em formacao na serie estendida
  const out = [];

  const fundos = pivos.baixos.filter((p) => rsi[p] !== null && n - p <= DIV_JANELA);
  if (fundos.length) {
    const p1 = fundos[fundos.length - 1];
    if (idxViva - p1 >= DIV_SEP_MIN && rsiProv !== null) {
      const dPreco = variacaoPct(live.low, lows[p1]);
      const dRsi = rsiProv - rsi[p1];
      if (
        Math.abs(dPreco) >= DIV_MIN_PRECO_PCT &&
        Math.abs(dRsi) >= DIV_MIN_RSI &&
        dPreco < 0 &&
        dRsi > 0
      ) {
        out.push({
          tipo: "bullish_regular",
          lado: "fundo",
          confirmada: false,
          idxAnterior: p1,
          idxAtual: idxViva,
          precoAnterior: lows[p1],
          precoAtual: live.low,
          rsiAnterior: rsi[p1],
          rsiAtual: rsiProv,
        });
      }
    }
  }

  const topos = pivos.altos.filter((p) => rsi[p] !== null && n - p <= DIV_JANELA);
  if (topos.length) {
    const p1 = topos[topos.length - 1];
    if (idxViva - p1 >= DIV_SEP_MIN && rsiProv !== null) {
      const dPreco = variacaoPct(live.high, highs[p1]);
      const dRsi = rsiProv - rsi[p1];
      if (
        Math.abs(dPreco) >= DIV_MIN_PRECO_PCT &&
        Math.abs(dRsi) >= DIV_MIN_RSI &&
        dPreco > 0 &&
        dRsi < 0
      ) {
        out.push({
          tipo: "bearish_regular",
          lado: "topo",
          confirmada: false,
          idxAnterior: p1,
          idxAtual: idxViva,
          precoAnterior: highs[p1],
          precoAtual: live.high,
          rsiAnterior: rsi[p1],
          rsiAtual: rsiProv,
        });
      }
    }
  }

  return out;
}

// ------------------------------------------------------------
// Volume
// ------------------------------------------------------------

export function analisarVolume(volumes, volumeVivo, media = VOL_MEDIA, disponivel = true) {
  // "nao_aplicavel" e "indefinido" dizem coisas diferentes: o primeiro,
  // que a fonte nao publica volume nenhum; o segundo, que ainda faltam
  // velas para uma media. Quem le o relatorio precisa dos dois nomes.
  if (!disponivel) {
    return {
      atual: null,
      ultimaFechada: null,
      media: null,
      vsMediaPct: null,
      classificacao: "nao_aplicavel",
      tendencia: "nao_aplicavel",
    };
  }
  const n = volumes.length;
  if (n < 2) {
    return {
      atual: volumeVivo,
      ultimaFechada: null,
      media: null,
      vsMediaPct: null,
      classificacao: "indefinido",
      tendencia: "indefinida",
    };
  }
  const usa = Math.min(media, n);
  const janela = volumes.slice(n - usa);
  const med = janela.reduce((a, b) => a + b, 0) / usa;
  const ultima = volumes[n - 1];

  // DIA INTEIRO CONTRA DIA INTEIRO. A comparacao usa a ultima vela
  // FECHADA, nunca a que esta em formacao.
  //
  // Volume e' acumulado: as 6h da manha uma vela diaria tem so as horas
  // ja decorridas. Compara-la com a media de dias completos da sempre um
  // numero catastrofico -- num par 24/7 isso publicava "contracao_forte"
  // toda madrugada, e um rompimento real nessa janela sairia carimbado
  // como "volume fraco".
  //
  // Corrigir escalando a media pela fracao decorrida seria supor que o
  // giro se espalha por igual ao longo do dia, o que nao acontece. A
  // vela fechada nao precisa de suposicao nenhuma.
  //
  // Isso tambem resolve uma incoerencia que ja existia: rompimento_
  // confirmado e' avaliado sobre a vela FECHADA, mas buscava a
  // confirmacao de volume na vela VIVA -- duas velas diferentes na
  // mesma frase.
  const vsMedia = med === 0 ? null : ((ultima - med) / med) * 100;

  let classificacao = "normal";
  if (vsMedia !== null) {
    if (vsMedia >= 50) classificacao = "expansao_forte";
    else if (vsMedia >= 20) classificacao = "acima_da_media";
    else if (vsMedia <= -50) classificacao = "contracao_forte";
    else if (vsMedia <= -20) classificacao = "abaixo_da_media";
  }

  // tendencia das ultimas 3 fechadas
  let tendencia = "indefinida";
  if (n >= 3) {
    const [a, b, c] = volumes.slice(-3);
    if (c < b && b < a) tendencia = "decrescente";
    else if (c > b && b > a) tendencia = "crescente";
    else tendencia = "irregular";
  }

  return {
    atual: volumeVivo, // continua publicado, cru, marcado como parcial
    ultimaFechada: ultima,
    media: med,
    periodoMedia: usa,
    vsMediaPct: vsMedia,
    classificacao,
    tendencia,
  };
}

// ------------------------------------------------------------
// Alertas tecnicos (linha NOVA, separada de "eventos")
// ------------------------------------------------------------

function alertasTecnicos(cfg, d, ind) {
  const a = [];
  const nv = cfg.niveis;
  const p = d.live.close;
  const i = d.closes.length - 1;
  const fechAtual = d.closes[i];
  const abertFech = d.opens[i];

  for (const [lo, hi, nome] of nv.faixas || []) {
    if (p >= lo && p <= hi) a.push(nome);
  }
  // Rompimento: intradiario vs confirmado
  if (nv.resistencia !== null && nv.resistencia !== undefined) {
    const R = nv.resistencia;
    if (fechAtual > R) {
      const corpoAcima = Math.min(abertFech, fechAtual) > R;
      a.push(
        corpoAcima
          ? `rompimento_confirmado_${nv.resistenciaLabel}`
          : `rompimento_confirmado_fraco_${nv.resistenciaLabel}`
      );
    } else if (d.live.high > R || p > R) {
      a.push(`rompimento_intradiario_${nv.resistenciaLabel}`);
    }
  }

  // Perda de suporte: intradiaria vs confirmada
  if (nv.suporte !== null && nv.suporte !== undefined) {
    const S = nv.suporte;
    if (fechAtual < S) a.push(`perda_suporte_confirmada_${nv.suporteLabel}`);
    else if (d.live.low < S || p < S)
      a.push(`toque_suporte_intradiario_${nv.suporteLabel}`);
  }

  if (ind.rsi !== null && ind.rsi > 70) a.push("rsi_acima_70");
  if (ind.rsi !== null && ind.rsi < 30) a.push("rsi_abaixo_30");

  if (ind.crossUp) a.push("di_plus_cruzando_acima_di_minus");
  if (ind.crossDown) a.push("di_minus_cruzando_acima_di_plus");

  if (ind.adx !== null && ind.adxAnt !== null) {
    const subindo = ind.adx > ind.adxAnt;
    if (subindo && ind.diPlus > ind.diMinus) a.push("adx_subindo_com_di_plus_dominante");
    if (subindo && ind.diMinus > ind.diPlus) a.push("adx_subindo_com_di_minus_dominante");
  }

  // --- divergencias (so as confirmadas viram alerta) ---
  for (const dv of ind.divergencias || []) {
    a.push(`divergencia_${dv.tipo}_confirmada`);
  }

  // --- estrutura de mercado ---
  for (const ev of ind.estruturaEventos || []) a.push(ev);

  // --- mudancas de estado de nivel (so quando MUDA) ---
  for (const m of ind.mudancasNivel || []) a.push(m);

  // --- volume como CONFIRMACAO, nunca sozinho ---
  const vol = ind.volume;
  const houveRompimento = a.some((x) => x.startsWith("rompimento_"));
  const houvePerda = a.some((x) => x.startsWith("perda_suporte_") || x.startsWith("toque_suporte_"));
  // Nao ha mais o que suprimir por vela parcial: vol.vsMediaPct compara
  // vela FECHADA com media de velas fechadas, entao vale a qualquer hora
  // em que a execucao rode.
  if (vol && vol.vsMediaPct !== null) {
    if (houveRompimento && vol.vsMediaPct >= 20) a.push("rompimento_com_volume_acima_da_media");
    if (houveRompimento && vol.vsMediaPct <= -20) a.push("rompimento_com_volume_fraco");
    if (houvePerda && vol.vsMediaPct >= 50) a.push("queda_com_expansao_de_volume");
  }
  if (
    vol &&
    vol.tendencia === "decrescente" &&
    ind.estruturaTendencia === "alta" &&
    !houveRompimento
  ) {
    a.push("pullback_com_volume_decrescente");
  }

  // --- degradacoes do trio: enfraquecimento, nao forca ---
  for (const e of ind.enfraquecimento || []) a.push(e);
  if (ind.padroes && ind.padroes.includes("tres_soldados_brancos")) {
    if (ind.contextoTrio === "reversao_valida")
      a.push("tres_soldados_em_contexto_de_reversao");
    if (ind.contextoTrio === "continuacao")
      a.push("tres_soldados_em_contexto_de_continuacao");
    // Exaustao exige evidencia de enfraquecimento, nunca so a posicao
    // do preco no range.
    if (ind.contextoTrio === "exaustao_possivel")
      a.push("tres_soldados_com_sinais_de_exaustao");
  }

  // --- confluencia: so quando varios elementos apontam junto ---
  const temHL = (ind.estruturaEventos || []).some((e) => e.includes("HL"));
  const pullbackBullish =
    ind.estruturaTendencia === "alta" &&
    ind.diPlus > ind.diMinus &&
    vol &&
    vol.tendencia === "decrescente" &&
    (temHL || (ind.divergencias || []).some((d) => d.tipo.startsWith("bullish")));
  if (pullbackBullish) a.push("confluencia_pullback_bullish");

  return a;
}


// ------------------------------------------------------------
// Maquina de estados de rompimento / reteste (persistida)
//
// Um registro por par + timeframe + nivel. Avaliada sempre sobre a
// ULTIMA VELA FECHADA, nunca sobre a vela em formacao — o estado nao
// pode oscilar dentro do dia.
//
// Estados: rompimento_candidato -> rompido -> em_reteste
//          -> reteste_confirmado -> rompimento_falhou -> recuperado
//
// DUAS SEVERIDADES, DOIS NOMES. "rompimento_candidato" usa o criterio
// sensivel (ponto medio do corpo alem do nivel) e serve apenas para
// armar a maquina, de modo que um reteste no candle seguinte nao seja
// perdido. "rompido" so e' atribuido quando o criterio RIGOROSO —
// o mesmo de rompimento_confirmado em alertas_tecnicos, corpo inteiro
// alem do nivel — for satisfeito. Assim o relatorio nunca diz
// "sem rompimento confirmado" e "estado: rompido" ao mesmo tempo.
// ------------------------------------------------------------

// Metade dos valores dos monitores de cripto, de proposito. Um dia de
// USD/BRL anda tipicamente 0,3%-0,8%; com a tolerancia de 0,5% do BTC,
// quase toda vela cairia "na zona" do nivel e a maquina de estados
// ficaria presa em em_reteste. E com 3% de afastamento o ciclo
// praticamente nunca encerraria.
const RETEST_TOLERANCE_PCT = 0.25; // largura da zona em torno do nivel
const RETEST_RESET_DISTANCE_PCT = 1.5; // afastamento que encerra o ciclo
const HISTORICO_MAX = 5;

export function chaveNivel(parKey, tfKey, nivel) {
  return `${parKey}|${tfKey}|${nivel}`;
}

// Devolve o novo registro (ou null para descartar).
export function atualizarEstadoNivel(anterior, ctx) {
  const { nivel, direcao, vela, tolPct, resetPct, maxCandles, segundos } = ctx;
  const tol = Math.abs(nivel) * (tolPct / 100);
  const alta = direcao === "alta";

  const acima = vela.close > nivel + tol;
  const abaixo = vela.close < nivel - tol;
  const naZona = !acima && !abaixo;
  const penetrou = alta ? vela.low < nivel : vela.high > nivel;

  // lado "valido" = lado para onde o rompimento apontou
  const ladoValido = alta ? acima : abaixo;
  const ladoContrario = alta ? abaixo : acima;

  const corpoBaixo = Math.min(vela.open, vela.close);
  const corpoAlto = Math.max(vela.open, vela.close);
  const meioCorpo = (vela.open + vela.close) / 2;

  // Criterio RIGOROSO: corpo inteiro alem do nivel. Identico ao usado
  // por rompimento_confirmado em alertas_tecnicos.
  const rompimentoRigoroso = alta
    ? vela.close > nivel && corpoBaixo > nivel
    : vela.close < nivel && corpoAlto < nivel;

  // Criterio SENSIVEL: ponto medio do corpo alem do nivel. So arma a
  // maquina — nunca produz o rotulo "rompido" sozinho.
  const rompimentoCandidato = alta
    ? vela.close > nivel && meioCorpo > nivel
    : vela.close < nivel && meioCorpo < nivel;

  if (!anterior) {
    if (!rompimentoCandidato) return null;
    return {
      estado: rompimentoRigoroso ? "rompido" : "rompimento_candidato",
      direcao,
      precoRompimento: vela.close,
      dataRompimento: vela.time,
      ultimoContato: vela.time,
      atualizado: vela.time,
      historico: [],
    };
  }

  const e = { ...anterior, historico: [...(anterior.historico || [])] };
  if (e.estado === "arquivado") return e;

  // descarte operacional por inatividade
  const velasSemContato = (vela.time - (e.ultimoContato || e.dataRompimento)) / segundos;
  if (velasSemContato > maxCandles) {
    if (!e.historico.length) return null;
    return { estado: "arquivado", historico: e.historico };
  }

  e.atualizado = vela.time;
  if (naZona || penetrou) e.ultimoContato = vela.time;

  const anota = (novo) => {
    if (e.estado !== novo) {
      e.historico.push(`${novo}@${fmtDia(vela.time)}`);
      if (e.historico.length > HISTORICO_MAX) e.historico.shift();
    }
    e.estado = novo;
  };

  switch (e.estado) {
    // Estagio preliminar: promove se o criterio rigoroso aparecer, mas
    // ja aceita evoluir para reteste — um reteste bem-sucedido e'
    // confirmacao estrutural por si mesmo.
    case "rompimento_candidato":
      // Os rotulos de reteste sao mais especificos que a promocao e
      // vem primeiro: uma vela que volta ao nivel conta como reteste,
      // nao como simples confirmacao do rompimento.
      if (ladoContrario) anota("rompimento_falhou");
      else if (naZona) anota("em_reteste");
      else if (ladoValido && penetrou) anota("reteste_confirmado");
      else if (rompimentoRigoroso) anota("rompido");
      break;
    case "rompido":
    case "reteste_confirmado":
    case "recuperado":
      if (ladoContrario) anota("rompimento_falhou");
      else if (naZona) anota("em_reteste");
      else if (ladoValido && penetrou) anota("reteste_confirmado");
      break;
    case "em_reteste":
      if (ladoContrario) anota("rompimento_falhou");
      else if (ladoValido) anota("reteste_confirmado");
      break;
    case "rompimento_falhou":
      if (ladoValido) anota("recuperado");
      break;
  }

  // ciclo encerrado por afastamento: volta ao estado operacional de
  // rompido, sem apagar o historico do que ja aconteceu.
  const distPct = (Math.abs(vela.close - nivel) / Math.abs(nivel)) * 100;
  if (
    distPct > resetPct &&
    (e.estado === "reteste_confirmado" || e.estado === "recuperado")
  ) {
    e.estado = "rompido";
    e.afastado = true;
  } else if (distPct <= resetPct) {
    e.afastado = false;
  }

  return e;
}

function niveisDoPar(cfg) {
  const out = [];
  const nv = cfg.niveis;
  if (nv.resistencia !== null && nv.resistencia !== undefined)
    out.push({ nivel: nv.resistencia, direcao: "alta", label: nv.resistenciaLabel });
  if (nv.suporte !== null && nv.suporte !== undefined)
    out.push({ nivel: nv.suporte, direcao: "baixa", label: nv.suporteLabel });
  return out;
}

// ------------------------------------------------------------
// Volume parcial: fracao do periodo ja decorrida
// ------------------------------------------------------------

function fracaoPeriodo(live, segundos, agora = Math.floor(Date.now() / 1000)) {
  const f = (agora - live.time) / segundos;
  if (!isFinite(f)) return null;
  return Math.max(0, Math.min(1, f));
}

// Comparacao semanal justa: soma os dias JA FECHADOS da semana atual e
// compara com a soma dos mesmos N primeiros dias das semanas anteriores.
// Nao e' projecao — sao dias completos contra dias completos.
function volumeSemanaEquivalente(dadosSemanal, dadosDiario, semanasAtras = 8) {
  if (!dadosDiario || !dadosDiario.times || !(dadosDiario.volumes || []).length)
    return null;
  const inicioSemana = dadosSemanal.live.time;
  const SEMANA = 604800;

  const diasAtuais = [];
  for (let i = 0; i < dadosDiario.times.length; i++) {
    const t = dadosDiario.times[i];
    // limita a janela a UMA semana: protege contra desalinhamento entre
    // a grade diaria e a semanal devolvidas pela fonte.
    if (t >= inicioSemana && t < inicioSemana + SEMANA)
      diasAtuais.push(dadosDiario.volumes[i]);
  }
  const k = diasAtuais.length;
  if (k < 1) return null;
  const somaAtual = diasAtuais.reduce((a, b) => a + b, 0);

  const inicios = dadosSemanal.times.slice(-semanasAtras);
  const somas = [];
  for (const ini of inicios) {
    const dias = [];
    for (let i = 0; i < dadosDiario.times.length; i++) {
      const t = dadosDiario.times[i];
      if (t >= ini && t < ini + SEMANA) dias.push(dadosDiario.volumes[i]);
    }
    if (dias.length >= k) somas.push(dias.slice(0, k).reduce((a, b) => a + b, 0));
  }
  if (!somas.length) return null;
  const media = somas.reduce((a, b) => a + b, 0) / somas.length;
  return {
    dias: k,
    somaAtual,
    mediaEquivalente: media,
    vsPct: media === 0 ? null : ((somaAtual - media) / media) * 100,
    semanasComparadas: somas.length,
  };
}

// ------------------------------------------------------------
// Metricas normalizadas de vela (reaproveitam anatomia)
// ------------------------------------------------------------

function metricasVela(v) {
  if (!v || !(v.amplitude > 0)) return null;
  return {
    corpoPctRange: (v.corpo / v.amplitude) * 100,
    sombraSupPctRange: (v.sombraSup / v.amplitude) * 100,
    sombraInfPctRange: (v.sombraInf / v.amplitude) * 100,
    sombraSupVsCorpo: v.corpo > 0 ? v.sombraSup / v.corpo : null,
    sombraInfVsCorpo: v.corpo > 0 ? v.sombraInf / v.corpo : null,
  };
}


// ------------------------------------------------------------
// Sinteses descritivas
//
// Estes quatro campos NAO produzem sinal novo: apenas reunem, num
// lugar so, itens que ja aparecem em outros campos do relatorio.
// Sao descritivos, nunca prescritivos — nao dizem comprar nem vender.
// ------------------------------------------------------------

function sinteses(ctx) {
  const {
    alertas,
    estrutura,
    estruturaEventos,
    divergencias,
    vol,
    enfraquecimento,
    fraqueza,
    rsiFech,
    rsiAnt,
    diPlus,
    diMinus,
    estadosNivel,
  } = ctx;

  const tem = (p) => alertas.some((x) => x.startsWith(p));
  const entrada = [];
  const pullback = [];
  const riscos = [];
  const deterioracao = [];

  // --- confluencia de entrada ---
  if (tem("rompimento_confirmado")) entrada.push("rompimento_confirmado_por_fechamento");
  if (estadosNivel.includes("reteste_confirmado")) entrada.push("reteste_confirmado");
  if (alertas.includes("rompimento_com_volume_acima_da_media"))
    entrada.push("volume_acima_da_media_no_rompimento");
  if (estrutura.tendencia === "alta") entrada.push("estrutura_de_alta_preservada");
  if (diPlus !== null && diMinus !== null && diPlus > diMinus)
    entrada.push("di_plus_dominante");

  // --- confluencia de pullback ---
  if (estrutura.tendencia === "alta") pullback.push("tendencia_hh_hl_preservada");
  if (estadosNivel.includes("em_reteste")) pullback.push("em_reteste_de_nivel");
  if (estruturaEventos.includes("novo_HL_apos_fundo_mais_baixo"))
    pullback.push("novo_HL_formado");
  if (rsiFech !== null && rsiAnt !== null && rsiFech < rsiAnt && rsiFech > 40)
    pullback.push("rsi_esfriando");
  if (diPlus !== null && diMinus !== null && diPlus > diMinus)
    pullback.push("di_plus_ainda_dominante");
  if (vol && vol.tendencia === "decrescente") pullback.push("volume_decrescente_na_correcao");
  if (divergencias.some((d) => d.tipo.startsWith("bullish")))
    pullback.push("divergencia_bullish_confirmada");

  // --- riscos tecnicos ---
  for (const e of enfraquecimento) riscos.push(e);
  if (fraqueza.includes("sombras_superiores_crescentes"))
    riscos.push("sombras_superiores_crescentes");
  if (divergencias.some((d) => d.tipo.startsWith("bearish")))
    riscos.push("divergencia_bearish_confirmada");
  if (tem("toque_suporte") || tem("perda_suporte")) riscos.push("suporte_sob_pressao");
  if (alertas.includes("queda_com_expansao_de_volume"))
    riscos.push("volume_expandindo_na_queda");
  if (estadosNivel.includes("em_reteste")) riscos.push("nivel_em_teste");

  // --- deterioracao de tendencia (so o estrutural) ---
  if (estruturaEventos.includes("perda_estrutura_alta_novo_LL"))
    deterioracao.push("perda_estrutura_alta_novo_LL");
  if (estrutura.tendencia === "baixa") deterioracao.push("estrutura_de_baixa");
  if (estadosNivel.includes("rompimento_falhou")) deterioracao.push("rompimento_falhou");
  if (tem("perda_suporte_confirmada")) deterioracao.push("perda_de_suporte_confirmada");
  if (
    diPlus !== null &&
    diMinus !== null &&
    diMinus > diPlus &&
    estrutura.tendencia !== "alta"
  )
    deterioracao.push("di_minus_dominante_com_estrutura_nao_altista");

  const j = (arr) => (arr.length ? arr.join(", ") : "nenhuma");
  return {
    entrada: j(entrada),
    pullback: j(pullback),
    riscos: riscos.length ? riscos.join(", ") : "nenhum",
    deterioracao: deterioracao.length ? deterioracao.join(", ") : "nenhuma",
  };
}


// ------------------------------------------------------------
// Endpoint estatico JSON
//
// Construido a partir do TEXTO ja gerado, e nao recalculando nada.
// Assim e' impossivel o JSON divergir da pagina: sao a mesma fonte.
// Nenhum indicador novo, nenhum campo renomeado.
// ------------------------------------------------------------

// Campos cujo valor e' uma lista separada por virgula.
const CAMPOS_LISTA = new Set([
  "alertas_tecnicos",
  "padrao_candles",
  "padrao_em_formacao",
  "padroes_enfraquecimento",
  "estrutura_eventos",
  "divergencia_rsi",
  "divergencia_rsi_provisoria",
  "niveis_mudancas_nesta_vela",
  "confluencia_entrada",
  "confluencia_pullback",
  "riscos_tecnicos",
  "deterioracao_tendencia",
  "padrao_trio_evidencias_fraqueza",
]);

const VAZIOS = new Set(["nenhum", "nenhuma", "nenhuma_mudanca", "--"]);

function valorJSON(campo, bruto) {
  const v = bruto.trim();
  if (v === "--") return null;
  if (CAMPOS_LISTA.has(campo)) {
    if (VAZIOS.has(v)) return [];
    return v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// Solucao B: as zonas vem do MESMO objeto canonico usado pelo resumo
// textual, injetadas apos o parse. Todo o restante do JSON continua
// derivado do texto, preservando a garantia de paridade.
export function relatorioParaJSON(texto, zonas = null) {
  const out = {
    cabecalho: {},
    diario: {},
    semanal: {},
    trilho_execucao: {},
    gatilhos_ativos: [],
  };
  let tfAtual = null;
  let parAtual = null;

  for (const linhaBruta of texto.split("\n")) {
    const linha = linhaBruta.trim();
    if (!linha || linha.startsWith("#")) continue;

    if (linha.startsWith("==========")) {
      // O trilho e' uma secao sem par: se caisse na regra abaixo, os
      // campos dele entrariam no bloco diario de USD/BRL.
      if (/TRILHO/.test(linha)) tfAtual = "trilho";
      else tfAtual = /SEMANAL/.test(linha) ? "semanal" : "diario";
      parAtual = null;
      continue;
    }

    if (linha === "fim do relatorio") continue;

    if (linha.startsWith("GATILHOS ATIVOS:")) {
      const v = linha.slice("GATILHOS ATIVOS:".length).trim();
      out.gatilhos_ativos = VAZIOS.has(v)
        ? []
        : v.split(",").map((x) => x.trim()).filter(Boolean);
      continue;
    }

    if (PAR_POR_LABEL.has(linha)) {
      parAtual = linha;
      if (tfAtual) out[tfAtual][parAtual] = {};
      continue;
    }

    if (linha.startsWith("FALHA:")) {
      const msg = linha.slice("FALHA:".length).trim();
      if (tfAtual && parAtual) out[tfAtual][parAtual].falha = msg;
      continue;
    }

    const sep = linha.indexOf(": ");
    if (sep === -1) continue;
    const campo = linha.slice(0, sep).trim();
    const valor = valorJSON(campo, linha.slice(sep + 2));

    if (tfAtual === "trilho") out.trilho_execucao[campo] = valor;
    else if (tfAtual && parAtual) out[tfAtual][parAtual][campo] = valor;
    else out.cabecalho[campo] = valor;
  }

  // niveis_manuais e zonas_automaticas ficam SEPARADOS por par/timeframe
  for (const tfKey of ["diario", "semanal"]) {
    for (const par of Object.keys(out[tfKey] || {})) {
      const cfgPar = PAR_POR_LABEL.get(par);
      if (!cfgPar) continue;
      const bloco = out[tfKey][par];
      const chave = `${cfgPar.key}|${tfKey}`;
      bloco.niveis_manuais = {};

      // Faixas manuais publicadas como METADADO, derivadas direto das
      // faixas do par. Nao existe copia dos numeros aqui: mexer em
      // NIVEIS_USD ou NIVEIS_USDT muda o JSON sozinho.
      //
      // Vem da configuracao e nao do texto, igual a zonas_automaticas
      // logo abaixo, que tambem e' injetada por fora. A regra de derivar
      // do texto existe para dado CALCULADO, onde texto e JSON poderiam
      // divergir; faixa manual e' constante de configuracao, entao nao ha
      // o que divergir.
      bloco.niveis_manuais.faixas = (cfgPar.niveis.faixas || []).map(
        ([inferior, superior, label]) => ({ inferior, superior, label })
      );

      for (const [campo, valor] of Object.entries(bloco)) {
        if (campo.startsWith("nivel_")) bloco.niveis_manuais[campo] = valor;
      }
      bloco.zonas_automaticas = zonas && zonas[chave] ? zonas[chave] : [];
    }
  }

  out.timestamp = out.cabecalho.timestamp || null;
  return out;
}


// ------------------------------------------------------------
// ZONAS AUTOMATICAS DE SUPORTE E RESISTENCIA
//
// Detectadas a partir dos pivos confirmados que o script ja calcula.
// Nesta primeira versao sao SOMENTE CONTEXTO: nao geram alerta, nao
// entram em gatilhos_ativos, nao tocam a maquina de estados dos niveis
// manuais e nao alteram confluencia_entrada/pullback/deterioracao.
//
// Dois pares de limites, com propositos distintos:
//   - estruturais: derivados dos pivos e da volatilidade DA EPOCA deles.
//     Usados para identidade, matching e merge. Nao mudam quando o ATR
//     atual muda.
//   - operacionais: centro +- 0,35 x ATR fechado ATUAL. Usados para
//     medir distancia e interacao no regime de volatilidade corrente.
//   - episodios historicos: janela reconstruida vela a vela com o ATR
//     DAQUELA epoca. Uma mudanca do ATR de hoje nunca altera
//     retroativamente quantos toques a zona teve no passado.
// ------------------------------------------------------------

const ATR_PERIODO = 14;
const ZONA_MEIA_LARGURA_ATR = 0.35;
// Piso e teto da largura da zona. Quase nunca mordem — a largura real
// sai do ATR — mas ambos foram reduzidos junto com o resto: no cambio o
// piso de 0,15% do BTC ja seria mais largo que meio ATR diario.
const ZONA_LARGURA_MIN_PCT = 0.08;
const ZONA_LARGURA_MAX_PCT = 1.0;
const CLUSTER_DIAMETRO_MAX = 1.0; // distancia normalizada entre QUALQUER par
const MATCH_MAX_ATR = 0.75;
const MERGE_SOBREPOSICAO_MIN = 0.5;
const MATCH_SOBREPOSICAO_MIN = 0.35;
const CONFLUENCIA_SOBREPOSICAO_MIN = 0.35;
const SAIDA_EPISODIO_ATR = 1.0;
const ZONA_SCORE_MIN_PUBLICAR = 25;
const ZONA_SCORE_ATIVA = 45;
const ZONA_SCORE_ENFRAQUECE = 30;
const ZONA_SCORE_REMOVE = 15;
const ZONA_MAX_POR_LADO = 3; // publicadas por lado
const SUAVIZA_CENTRO = 0.7; // peso do centro anterior ao casar

const PARAMS_TF = {
  diario: { meiaVida: 20, semToqueEnfraquece: 30, enfraquecidaRemove: 15 },
  semanal: { meiaVida: 6, semToqueEnfraquece: 8, enfraquecidaRemove: 4 },
};

// ATR(14) de Wilder sobre velas fechadas. Calculo proprio: o dmiSeries
// usa True Range internamente mas nao o expoe, e extrair um helper
// comum exigiria mexer no DMI, que deve permanecer intocado.
export function atrSeries(highs, lows, closes, period = ATR_PERIODO) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  let soma = 0;
  for (let i = 1; i <= period; i++) soma += tr[i];
  out[period] = soma / period;
  for (let i = period + 1; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

// Anexa a volatilidade da epoca a cada pivo confirmado.
export function pivosComAtr(highs, lows, closes, times, pivos, atr) {
  // PRIMEIRO ATR valido, nunca o ultimo: um pivo antigo jamais pode
  // receber a volatilidade de hoje como substituta.
  const fallback = atr.find((x) => x !== null && x > 0) || null;
  const monta = (idx, tipo) => ({
    idx,
    tipo,
    preco: tipo === "topo" ? highs[idx] : lows[idx],
    time: times[idx],
    atr_at_pivot: atr[idx] !== null && atr[idx] > 0 ? atr[idx] : fallback,
  });
  return {
    topos: pivos.altos.map((i) => monta(i, "topo")),
    fundos: pivos.baixos.map((i) => monta(i, "fundo")),
  };
}

// Distancia normalizada pela volatilidade DAS DUAS EPOCAS.
function distNorm(a, b) {
  const escala = ((a.atr_at_pivot || 0) + (b.atr_at_pivot || 0)) / 2;
  if (!(escala > 0)) return Infinity;
  return Math.abs(a.preco - b.preco) / escala;
}

// Clustering guloso com verificacao de TODOS OS PARES: um candidato so
// entra se for compativel com cada membro ja presente. Isso elimina o
// chaining (A~B, B~C, mas A e C distantes).
export function agruparPivos(lista) {
  const ord = [...lista].sort((x, y) => x.preco - y.preco);
  const clusters = [];
  for (const p of ord) {
    const atual = clusters[clusters.length - 1];
    if (atual && atual.every((m) => distNorm(m, p) <= CLUSTER_DIAMETRO_MAX)) {
      atual.push(p);
    } else {
      clusters.push([p]);
    }
  }
  return clusters;
}

function limitesEstruturais(membros) {
  const precos = membros.map((m) => m.preco);
  const atrMedio =
    membros.reduce((s, m) => s + (m.atr_at_pivot || 0), 0) / membros.length;
  const folga = 0.15 * atrMedio;
  return {
    inferior: Math.min(...precos) - folga,
    superior: Math.max(...precos) + folga,
  };
}

function limitesOperacionais(centro, atrAtual) {
  let meia = ZONA_MEIA_LARGURA_ATR * (atrAtual || 0);
  const piso = (ZONA_LARGURA_MIN_PCT / 100) * Math.abs(centro);
  const teto = (ZONA_LARGURA_MAX_PCT / 100) * Math.abs(centro);
  if (meia < piso) meia = piso;
  if (meia > teto) meia = teto;
  return { inferior: centro - meia, superior: centro + meia };
}

function sobreposicaoFrac(a, b) {
  const ini = Math.max(a.inferior, b.inferior);
  const fim = Math.min(a.superior, b.superior);
  if (fim <= ini) return 0;
  const menor = Math.min(a.superior - a.inferior, b.superior - b.inferior);
  return menor > 0 ? (fim - ini) / menor : 0;
}

// ------------------------------------------------------------
// Episodios de toque: varias velas seguidas dentro da zona sao UM toque.
// Um novo toque so conta depois que o preco sai >= 1 ATR e volta.
// ------------------------------------------------------------

// Janela de interacao reconstruida PARA CADA VELA com o ATR daquela
// epoca. Uma mudanca do ATR de hoje nao pode alterar retroativamente
// quantos toques a zona teve em julho.
function meiaLarguraNaEpoca(centro, atrEpoca) {
  let meia = ZONA_MEIA_LARGURA_ATR * (atrEpoca || 0);
  const piso = (ZONA_LARGURA_MIN_PCT / 100) * Math.abs(centro);
  const teto = (ZONA_LARGURA_MAX_PCT / 100) * Math.abs(centro);
  if (meia < piso) meia = piso;
  if (meia > teto) meia = teto;
  return meia;
}

export function calcularEpisodios(zona, dados, atr, idxInicio, volRel) {
  const { highs, lows, closes, times } = dados;
  const centro = zona.centro;
  const eps = [];
  let dentro = false;
  let atualEp = null;
  // Fallback para o warm-up do ATR: o PRIMEIRO valor valido, nunca o
  // ultimo. Usar o ultimo reinjetaria a volatilidade de hoje no passado.
  const primeiroAtr = atr.find((x) => x !== null && x > 0) || 0;

  for (let i = Math.max(1, idxInicio); i < closes.length; i++) {
    const a = atr[i] !== null && atr[i] > 0 ? atr[i] : primeiroAtr;
    const meia = meiaLarguraNaEpoca(centro, a);
    const inf = centro - meia;
    const sup = centro + meia;
    const intersecta = highs[i] >= inf && lows[i] <= sup;

    if (intersecta) {
      if (!dentro) {
        dentro = true;
        atualEp = {
          inicioIdx: i,
          inicio: times[i],
          fimIdx: i,
          fim: times[i],
          lado: closes[i - 1] > sup ? "acima" : closes[i - 1] < inf ? "abaixo" : "dentro",
          velas: 1,
          rejeitado: false,
          excursaoAtr: 0,
          volume_relativo: volRel && volRel[i] !== null ? volRel[i] : null,
        };
      } else {
        atualEp.fimIdx = i;
        atualEp.fim = times[i];
        atualEp.velas += 1;
      }
      continue;
    }

    if (dentro) {
      const distSaida = closes[i] > sup ? closes[i] - sup : inf - closes[i];
      if (a > 0 && distSaida >= SAIDA_EPISODIO_ATR * a) {
        let extremo = closes[i];
        for (let k = i; k < Math.min(i + 3, closes.length); k++) {
          if (closes[i] > sup) extremo = Math.max(extremo, highs[k]);
          else extremo = Math.min(extremo, lows[k]);
        }
        const exc = Math.abs(extremo - (closes[i] > sup ? sup : inf));
        atualEp.excursaoAtr = a > 0 ? exc / a : 0;
        const voltouParaOrigem =
          atualEp.lado === "acima"
            ? closes[i] > sup
            : atualEp.lado === "abaixo"
            ? closes[i] < inf
            : false;
        atualEp.rejeitado = voltouParaOrigem && atualEp.excursaoAtr >= SAIDA_EPISODIO_ATR;
        atualEp.saidaIdx = i;
        eps.push(atualEp);
        dentro = false;
        atualEp = null;
      }
    }
  }
  if (dentro && atualEp) {
    atualEp.aberto = true;
    eps.push(atualEp);
  }
  return eps;
}

// Media movel de 20 do volume, para normalizar cada toque pela EPOCA
// dele. Sem 20 velas anteriores o episodio fica indefinido (neutro),
// nunca "forte".
export function mediaVolMovel(volumes, janela = 20) {
  const out = new Array(volumes.length).fill(null);
  if (!volumes || volumes.length < janela) return out;
  let soma = 0;
  for (let i = 0; i < volumes.length; i++) {
    soma += volumes[i];
    if (i >= janela) soma -= volumes[i - janela];
    if (i >= janela - 1) out[i] = soma / janela;
  }
  return out;
}

// Role reversal EXIGE evidencia cronologica E reacao confirmada no
// lado novo: episodio de um lado -> fechamento confirmado do outro ->
// episodio pelo lado oposto COM rejeicao. Mera presenca do preco do
// outro lado nao inverte o papel da zona.
//
// Devolve a lista de eventos, em ordem. Cada troca de papel futura
// exige um evento NOVO — um role reversal antigo nao autoriza
// alternancia permanente de tipo.
export function eventosRoleReversal(zona, closes) {
  const eps = (zona.episodios || []).filter(
    (e) => e.lado === "acima" || e.lado === "abaixo"
  );
  if (eps.length < 2) return [];
  const est = zona.limites_estruturais;
  const out = [];
  let ladoAtual = eps[0].lado;
  let ultFim = eps[0].fimIdx;

  for (let j = 1; j < eps.length; j++) {
    const e = eps[j];
    if (e.lado === ladoAtual) {
      ultFim = e.fimIdx;
      continue;
    }
    let cruzou = false;
    for (let k = ultFim; k <= e.inicioIdx && k < closes.length; k++) {
      if (ladoAtual === "acima" ? closes[k] < est.inferior : closes[k] > est.superior) {
        cruzou = true;
        break;
      }
    }
    if (cruzou && e.rejeitado) {
      out.push({ em: e.fim, idx: e.fimIdx, ladoNovo: e.lado });
      ladoAtual = e.lado;
    }
    ultFim = e.fimIdx;
  }
  return out;
}

export function detectarRoleReversalCron(zona, closes) {
  return eventosRoleReversal(zona, closes).length > 0;
}

// Lado de aproximacao -> papel da zona. Preco vindo de cima significa
// que a zona esta segurando por baixo: suporte.
function papelPorLado(lado) {
  return lado === "acima" ? "suporte" : "resistencia";
}

// ------------------------------------------------------------
// Score normalizado 0-100 sobre os fatores APLICAVEIS ao timeframe.
// Proximidade do preco NAO entra: ela ordena a exibicao, nao mede forca.
// Penalidades sao MULTIPLICATIVAS, para nunca produzir negativo nem
// achatar a diferenca entre "fraca" e "muito fraca".
// ------------------------------------------------------------

const PESOS = {
  episodios: 25,
  rejeicoes: 21,
  recencia: 15,
  forca_reacao: 15,
  confluencia_semanal: 13,
  role_reversal: 7,
  volume: 4,
};

export function pontuarZona(zona, ctx) {
  const {
    tfKey,
    velasDesdeUltimoToque,
    confluenciaSemanal,
    volumeForte,
    volumeAplicavel = true,
  } = ctx;
  const par = PARAMS_TF[tfKey] || PARAMS_TF.diario;

  const eps = zona.episodios || [];
  const nToques = eps.length;
  const nRej = eps.filter((e) => e.rejeitado).length;
  const excMedia = eps.length
    ? eps.reduce((s, e) => s + (e.excursaoAtr || 0), 0) / eps.length
    : 0;

  const fatores = {
    episodios: { aplicavel: true, valor: Math.min(nToques / 4, 1) },
    rejeicoes: { aplicavel: true, valor: Math.min(nRej / 3, 1) },
    recencia: {
      aplicavel: true,
      valor:
        velasDesdeUltimoToque === null
          ? 0
          : Math.pow(2, -velasDesdeUltimoToque / par.meiaVida),
    },
    forca_reacao: { aplicavel: true, valor: Math.min(excMedia / 2, 1) },
    confluencia_semanal: {
      aplicavel: tfKey === "diario",
      valor: confluenciaSemanal ? 1 : 0,
    },
    role_reversal: { aplicavel: true, valor: zona.role_reversal ? 1 : 0 },
    // Sem volume o fator sai da NORMALIZACAO em vez de entrar valendo
    // zero. Valendo zero ele viraria um desconto fixo em toda zona, e as
    // faixas de score (ativa / enfraquece / remove) parariam de calibrar.
    volume: { aplicavel: volumeAplicavel, valor: volumeForte ? 1 : 0 },
  };

  let obtido = 0;
  let possivel = 0;
  for (const [nome, f] of Object.entries(fatores)) {
    if (!f.aplicavel) continue;
    possivel += PESOS[nome];
    obtido += PESOS[nome] * f.valor;
  }
  const bruto = possivel > 0 ? (obtido / possivel) * 100 : 0;

  // penalidades multiplicativas
  let fator = 1;
  const penalidades = [];
  const rompimentosSemReacao = eps.filter((e) => !e.rejeitado && !e.aberto).length;
  if (rompimentosSemReacao >= 2) {
    fator *= 0.85;
    penalidades.push("rompida_2x_sem_reacao");
  }
  if (nToques <= 1) {
    fator *= 0.8;
    penalidades.push("episodio_unico");
  }
  // wick solto: um unico episodio, de uma vela so, sem rejeicao.
  // Sombra longa COM rejeicao nao e' penalizada — e' justamente o sinal.
  if (nToques === 1 && eps[0] && eps[0].velas === 1 && !eps[0].rejeitado) {
    fator *= 0.75;
    penalidades.push("wick_isolado_sem_rejeicao");
  }

  return {
    score: Math.round(bruto * fator),
    score_bruto: Math.round(bruto),
    fator_penalidade: Number(fator.toFixed(3)),
    penalidades,
    numero_toques: nToques,
    numero_rejeicoes: nRej,
    forca_reacao_atr: Number(excMedia.toFixed(2)),
  };
}

// ------------------------------------------------------------
// Identidade: duas passadas. Mesmo tipo por proximidade; tipos opostos
// so casam com sobreposicao estrutural + cruzamento confirmado, e ai o
// ID e' PRESERVADO — uma resistencia que virou suporte e' a mesma
// regiao do grafico, e trocar o id apagaria o historico que a valoriza.
// ------------------------------------------------------------

// Identidade e' REGIAO DO GRAFICO, nao papel. O casamento usa
// sobreposicao estrutural e proximidade do centro; o tipo entra apenas
// como desempate. Exigir mesmo tipo faria uma zona ganhar ID novo so
// porque o preco intradiario cruzou para o outro lado — e o papel e'
// atributo, nunca identidade.
export function casarZonas(anteriores, novas, atrAtual) {
  const candidatos = [];
  for (const nova of novas) {
    for (const ant of anteriores) {
      const sob = sobreposicaoFrac(
        ant.limites_estruturais,
        nova.limites_estruturais
      );
      const dist = Math.abs(ant.centro - nova.centro);
      const perto = atrAtual > 0 && dist <= MATCH_MAX_ATR * atrAtual;
      if (sob >= MATCH_SOBREPOSICAO_MIN || perto) {
        candidatos.push({
          ant,
          nova,
          sob,
          dist,
          mesmoTipo: ant.tipo === nova.tipo,
        });
      }
    }
  }

  // maior sobreposicao, depois menor distancia, tipo so no desempate
  candidatos.sort(
    (a, b) =>
      b.sob - a.sob ||
      a.dist - b.dist ||
      (a.mesmoTipo === b.mesmoTipo ? 0 : a.mesmoTipo ? -1 : 1)
  );

  const usadasAnt = new Set();
  const usadasNova = new Set();
  const pares = [];
  for (const c of candidatos) {
    if (usadasAnt.has(c.ant.id) || usadasNova.has(c.nova)) continue;
    usadasAnt.add(c.ant.id);
    usadasNova.add(c.nova);
    c.nova._casada = true;
    pares.push({ ant: c.ant, nova: c.nova, trocouTipo: !c.mesmoTipo });
  }
  return pares;
}

// ------------------------------------------------------------
// Merge topo/fundo e montagem das zonas
// ------------------------------------------------------------

function fundirZonasOpostas(zonas) {
  const out = [];
  const consumidas = new Set();
  for (let i = 0; i < zonas.length; i++) {
    if (consumidas.has(i)) continue;
    let z = zonas[i];
    for (let j = i + 1; j < zonas.length; j++) {
      if (consumidas.has(j)) continue;
      const o = zonas[j];
      if (o.origem === z.origem) continue;
      // Merge usa limites ESTRUTURAIS: um pico momentaneo de ATR nao
      // pode fundir zonas que historicamente sempre foram distintas.
      if (sobreposicaoFrac(z.limites_estruturais, o.limites_estruturais) >= MERGE_SOBREPOSICAO_MIN) {
        const membros = [...z.membros, ...o.membros].sort((a, b) => a.time - b.time);
        const est = limitesEstruturais(membros);
        z = {
          ...z,
          membros,
          origem: "misto",
          limites_estruturais: est,
          centro: (est.inferior + est.superior) / 2,
          // NAO marca role_reversal: sobreposicao topo/fundo e' apenas
          // geometria. O papel so inverte com evidencia cronologica.
        };
        consumidas.add(j);
      }
    }
    out.push(z);
  }
  return out;
}

// ------------------------------------------------------------
// Ciclo de vida: histerese contada por VELA FECHADA NOVA, nunca por
// execucao. O workflow roda 24x sobre a mesma vela diaria; contar
// execucoes inflaria tudo por um fator de 24.
// ------------------------------------------------------------

function evidenciaEstruturalIndependente(z, confluenciaSemanal) {
  const eps = z.episodios || [];
  const comRejeicao = eps.filter((e) => e.rejeitado).length;
  if (eps.length >= 2 && comRejeicao >= 1) return true;
  if (comRejeicao >= 1 && confluenciaSemanal) return true;
  if (z.role_reversal && z.cruzamento_confirmado) return true;
  return false;
}

function atualizarCiclo(z, anterior, ctx) {
  const par = PARAMS_TF[ctx.tfKey] || PARAMS_TF.diario;
  const velaNova = !anterior || anterior.ultimaVelaAvaliada !== ctx.ultimaVelaFechada;

  z.status = anterior ? anterior.status : "candidata";
  z.velasComScoreAlto = anterior ? anterior.velasComScoreAlto || 0 : 0;
  z.velasEnfraquecida = anterior ? anterior.velasEnfraquecida || 0 : 0;
  z.ultimaVelaAvaliada = ctx.ultimaVelaFechada;

  if (!velaNova) {
    // mesma vela: mantem o estado, so atualiza os campos calculados
    return z;
  }

  if (z.score >= ZONA_SCORE_ATIVA) z.velasComScoreAlto += 1;
  else z.velasComScoreAlto = 0;

  const semToque =
    ctx.velasDesdeUltimoToque === null ? Infinity : ctx.velasDesdeUltimoToque;

  if (z.status === "candidata") {
    if (
      z.velasComScoreAlto >= 2 &&
      evidenciaEstruturalIndependente(z, ctx.confluenciaSemanal)
    ) {
      z.status = "ativa";
    }
  } else if (z.status === "ativa") {
    if (z.score < ZONA_SCORE_ENFRAQUECE || semToque > par.semToqueEnfraquece) {
      z.status = "enfraquecida";
      z.velasEnfraquecida = 0;
    }
  } else if (z.status === "enfraquecida") {
    z.velasEnfraquecida += 1;
    if (z.score >= ZONA_SCORE_ATIVA && semToque <= par.semToqueEnfraquece) {
      z.status = "ativa";
      z.velasEnfraquecida = 0;
    } else if (
      z.velasEnfraquecida >= par.enfraquecidaRemove ||
      z.score < ZONA_SCORE_REMOVE
    ) {
      z.status = "remover";
    }
  }
  return z;
}

// ------------------------------------------------------------
// Pipeline completo por par/timeframe
// ------------------------------------------------------------

export function calcularZonas(cfg, tf, d, ctx) {
  const { highs, lows, closes, times, opens } = d;
  const anteriores = ctx.zonasAnteriores || [];
  const atr = atrSeries(highs, lows, closes);
  const atrAtual = atr.filter((x) => x !== null).slice(-1)[0] || 0;
  const precoAtual = d.live.close;
  const ultimaVelaFechada = times[times.length - 1];

  const pv = pivosComAtr(highs, lows, closes, times, ctx.pivos, atr);
  if (!pv.topos.length && !pv.fundos.length) {
    // Sem pivos nesta consulta: nao ha o que recalcular, mas as zonas
    // ja conhecidas nao podem ser apagadas por isso.
    return { zonas: [], zonasEstado: anteriores, proximoId: ctx.proximoId };
  }

  const montar = (clusters, origem) =>
    clusters
      .filter((c) => c.length > 0)
      .map((membros) => {
        const est = limitesEstruturais(membros);
        const centro = (est.inferior + est.superior) / 2;
        return {
          membros: membros.map((m) => ({ time: m.time, preco: m.preco, tipo: m.tipo, idx: m.idx })),
          origem,
          limites_estruturais: est,
          centro,
        };
      });

  let zonas = [
    ...montar(agruparPivos(pv.topos), "topo"),
    ...montar(agruparPivos(pv.fundos), "fundo"),
  ];
  zonas = fundirZonasOpostas(zonas);

  // limites operacionais (interacao com o preco AGORA)
  for (const z of zonas) {
    z.limites_operacionais = limitesOperacionais(z.centro, atrAtual);
  }

  // Tipo PROVISORIO antes do casamento. Sem isso, casarZonas compara
  // ant.tipo contra undefined e a passada de mesmo tipo nunca casa.
  for (const z of zonas) {
    z.tipo = z.centro > precoAtual ? "resistencia" : "suporte";
  }

  // casamento com as zonas anteriores (identidade estavel)
  const pares = casarZonas(anteriores, zonas, atrAtual);
  const mapaAnt = new Map(pares.map((p) => [p.nova, p]));
  let proximoId = ctx.proximoId || 1;

  for (const z of zonas) {
    const par = mapaAnt.get(z);
    if (par) {
      z.id = par.ant.id;
      // suaviza o centro para o valor nao oscilar a cada vela
      z.centro = SUAVIZA_CENTRO * par.ant.centro + (1 - SUAVIZA_CENTRO) * z.centro;
      z.limites_operacionais = limitesOperacionais(z.centro, atrAtual);
      z.role_reversal = z.role_reversal || par.ant.role_reversal || par.trocouTipo;
      z.cruzamento_confirmado = par.ant.cruzamento_confirmado || false;
      z._anterior = par.ant;
      z._tipoAnterior = par.ant.tipo;
    } else {
      z.id = `${cfg.key}|${tf.key}|z${proximoId++}`;
      z.role_reversal = z.role_reversal || false;
      z.cruzamento_confirmado = false;
    }
  }

  // volume relativo A EPOCA de cada vela
  const mediaVol = mediaVolMovel(d.volumes || [], 20);
  const volRel = (d.volumes || []).map((v, i) =>
    mediaVol[i] && mediaVol[i] > 0 ? v / mediaVol[i] : null
  );

  // episodios de toque, a partir do primeiro membro da zona
  for (const z of zonas) {
    const idxIni = Math.min(...z.membros.map((m) => m.idx));
    z.episodios = calcularEpisodios(z, d, atr, idxIni, volRel);
    const ultimo = z.episodios.length ? z.episodios[z.episodios.length - 1] : null;
    z.primeiro_toque = z.episodios.length ? z.episodios[0].inicio : null;
    z.ultimo_toque = ultimo ? ultimo.fim : null;
    z.velasDesdeUltimoToque = ultimo ? closes.length - 1 - ultimo.fimIdx : null;

    // cruzamento confirmado: fechamentos dos dois lados do estrutural
    const acima = closes.some((c, i) => i >= idxIni && c > z.limites_estruturais.superior);
    const abaixo = closes.some((c, i) => i >= idxIni && c < z.limites_estruturais.inferior);
    if (acima && abaixo) z.cruzamento_confirmado = true;
    // role reversal so com evidencia cronologica de lado -> cruzamento
    // confirmado -> reacao COM rejeicao pelo lado oposto.
    z._eventosRR = eventosRoleReversal(z, closes);
    z.role_reversal = z._eventosRR.length > 0;
  }

  // tipo e estado_atual
  for (const z of zonas) {
    const dentro =
      precoAtual >= z.limites_operacionais.inferior &&
      precoAtual <= z.limites_operacionais.superior;
    z.estado_atual = dentro
      ? "em_teste"
      : precoAtual > z.limites_operacionais.superior
      ? "acima"
      : "abaixo";

    const inferido = z.estado_atual === "abaixo" ? "resistencia" : "suporte";
    const eventos = z._eventosRR || [];
    const ultimoEvento = eventos.length ? eventos[eventos.length - 1] : null;
    const rrAnterior = z._anterior ? z._anterior.ultimo_role_reversal_em || null : null;

    if (!z._anterior) {
      // zona nova: o ultimo evento manda; sem evento, infere pela posicao
      z.tipo_confirmado = ultimoEvento
        ? papelPorLado(ultimoEvento.ladoNovo)
        : dentro
        ? z.origem === "topo"
          ? "resistencia"
          : "suporte"
        : inferido;
      z.ultimo_role_reversal_em = ultimoEvento ? ultimoEvento.em : null;
    } else {
      z.tipo_confirmado =
        z._anterior.tipo_confirmado || z._anterior.tipo || z._tipoAnterior;
      z.ultimo_role_reversal_em = rrAnterior;
      // So troca com um evento NOVO, posterior ao ultimo ja processado.
      if (ultimoEvento && (rrAnterior === null || ultimoEvento.em > rrAnterior)) {
        z.tipo_confirmado = papelPorLado(ultimoEvento.ladoNovo);
        z.ultimo_role_reversal_em = ultimoEvento.em;
      }
    }
    z.tipo = z.tipo_confirmado;
    z.distancia_preco_atual_pct =
      ((precoAtual - z.centro) / Math.abs(z.centro)) * 100;
  }

  // score
  for (const z of zonas) {
    // volume relativo A EPOCA de cada toque. Sem media20 historica o
    // episodio e' NEUTRO, nunca "forte".
    const rels = z.episodios
      .map((e) => e.volume_relativo)
      .filter((v) => typeof v === "number" && isFinite(v));
    const medianaRel = rels.length
      ? rels.slice().sort((a, b) => a - b)[Math.floor(rels.length / 2)]
      : null;
    const confl = (ctx.zonasSemanais || []).some(
      (zs) =>
        (zs.status === "ativa" || zs.status === "candidata") &&
        sobreposicaoFrac(zs.limites_estruturais, z.limites_estruturais) >=
          CONFLUENCIA_SOBREPOSICAO_MIN
    );
    z.confluenciaSemanal = confl;
    const p = pontuarZona(z, {
      tfKey: tf.key,
      velasDesdeUltimoToque: z.velasDesdeUltimoToque,
      confluenciaSemanal: confl,
      volumeForte: medianaRel !== null && medianaRel >= 1.2,
      volumeAplicavel: !!d.temVolume,
    });
    Object.assign(z, p);
    z.volume_relativo_mediano = medianaRel === null ? null : Number(medianaRel.toFixed(2));
    z.volume_contexto =
      medianaRel === null
        ? d.temVolume
          ? "indefinido"
          : "nao_aplicavel"
        : medianaRel >= 1.2
        ? "acima_da_media_na_epoca"
        : "normal";
    z.timeframes_confirmando = confl ? [tf.key, "semanal"] : [tf.key];
    // LEGADO — nao mexer: ponto dentro dos limites ESTRUTURAIS, olhando
    // apenas os niveis que possuem maquina de estados persistente.
    z.confluencia_nivel_manual = (ctx.niveisManuais || []).some(
      (n) => n >= z.limites_estruturais.inferior && n <= z.limites_estruturais.superior
    );

    // NOVOS — faixa x faixa sobre os limites OPERACIONAIS. O operacional
    // e' estreito por construcao (centro +- 0,35 ATR), entao nao produz
    // o artefato de uma zona estrutural larga "engolir" a faixa manual.
    const sobrepoeFaixa = (faixa) =>
      sobreposicaoFrac(z.limites_operacionais, {
        inferior: faixa[0],
        superior: faixa[1],
      }) >= CONFLUENCIA_SOBREPOSICAO_MIN;

    z.confluencia_faixa_manual = (ctx.faixasManuais || []).some(sobrepoeFaixa);

    const macro = ctx.resistenciaMacro;
    z.confluencia_resistencia_macro = macro
      ? sobrepoeFaixa([macro.inferior, macro.superior])
      : false;

    // Conveniencia para consumidores externos. Nao entra em score,
    // alerta, gatilho nem ciclo de vida.
    z.confluencia_manual_qualquer =
      z.confluencia_nivel_manual ||
      z.confluencia_faixa_manual ||
      z.confluencia_resistencia_macro;
  }

  // ciclo de vida
  for (const z of zonas) {
    atualizarCiclo(z, z._anterior || null, {
      tfKey: tf.key,
      ultimaVelaFechada,
      velasDesdeUltimoToque: z.velasDesdeUltimoToque,
      confluenciaSemanal: z.confluenciaSemanal,
    });
  }

  // zonas anteriores que sumiram do calculo nao morrem de imediato:
  // entram em enfraquecida e seguem o ciclo normal.
  const idsCalculados = new Set(zonas.map((z) => z.id));
  const zonasCalculadas = [...zonas];
  for (const ant of anteriores) {
    if (idsCalculados.has(ant.id) || ant.status === "remover") continue;
    // se ja existe zona calculada cobrindo a mesma regiao, a antiga foi
    // absorvida — nao reinserir como orfa, senao duplica.
    const absorvida = zonasCalculadas.some(
      (z) => sobreposicaoFrac(z.limites_estruturais, ant.limites_estruturais) >= 0.5
    );
    if (absorvida) continue;
    const orfa = { ...ant };
    if (orfa.status === "ativa" || orfa.status === "candidata") {
      orfa.status = "enfraquecida";
      orfa.velasEnfraquecida = 0;
    } else if (orfa.status === "enfraquecida") {
      const par = PARAMS_TF[tf.key] || PARAMS_TF.diario;
      if (ant.ultimaVelaAvaliada !== ultimaVelaFechada) {
        orfa.velasEnfraquecida = (orfa.velasEnfraquecida || 0) + 1;
      }
      if (orfa.velasEnfraquecida >= par.enfraquecidaRemove) orfa.status = "remover";
    }
    orfa.ultimaVelaAvaliada = ultimaVelaFechada;
    orfa.orfa = true;
    zonas.push(orfa);
  }

  // ---- duas colecoes distintas ----
  // zonasEstado: TODAS as vivas. Sustentam identidade, matching e ciclo
  // de vida. Uma zona que hoje nao esta entre as 3 mais proximas nao
  // pode perder o ID e voltar como zona nova amanha.
  // zonasPublicadas: subconjunto visivel no relatorio/JSON.
  const vivas = zonas.filter((z) => z.status !== "remover");
  // TODAS as vivas. Cortar por score aqui faria uma zona perder ID e
  // historico so por nao estar entre as maiores — a remocao deve vir
  // do ciclo de vida, nunca de um corte silencioso.
  const estado = vivas.map((z) => limparZona(z));

  const publicaveis = vivas.filter((z) => z.score >= ZONA_SCORE_MIN_PUBLICAR);
  const acima = publicaveis
    .filter((z) => z.centro > precoAtual)
    .sort((a, b) => a.centro - b.centro)
    .slice(0, ZONA_MAX_POR_LADO);
  const abaixo = publicaveis
    .filter((z) => z.centro <= precoAtual)
    .sort((a, b) => b.centro - a.centro)
    .slice(0, ZONA_MAX_POR_LADO);

  return {
    zonas: [...acima, ...abaixo].map((z) => limparZona(z)),
    zonasEstado: estado,
    proximoId,
  };
}

// Objeto CANONICO. Texto e JSON derivam exatamente daqui.
function limparZona(z) {
  return {
    id: z.id,
    tipo: z.tipo,
    tipo_confirmado: z.tipo_confirmado || z.tipo,
    ultimo_role_reversal_em: z.ultimo_role_reversal_em ?? null,
    status: z.status,
    estado_atual: z.estado_atual,
    centro: z.centro,
    limites_estruturais: z.limites_estruturais,
    limites_operacionais: z.limites_operacionais,
    score: z.score,
    score_bruto: z.score_bruto,
    fator_penalidade: z.fator_penalidade,
    penalidades: z.penalidades || [],
    numero_toques: z.numero_toques,
    numero_rejeicoes: z.numero_rejeicoes,
    forca_reacao_atr: z.forca_reacao_atr,
    primeiro_toque: z.primeiro_toque,
    ultimo_toque: z.ultimo_toque,
    velas_desde_ultimo_toque: z.velasDesdeUltimoToque,
    timeframes_confirmando: z.timeframes_confirmando || [],
    role_reversal: !!z.role_reversal,
    cruzamento_confirmado: !!z.cruzamento_confirmado,
    volume_contexto: z.volume_contexto || "indefinido",
    volume_relativo_mediano: z.volume_relativo_mediano ?? null,
    distancia_preco_atual_pct: z.distancia_preco_atual_pct,
    confluencia_nivel_manual: !!z.confluencia_nivel_manual,
    confluencia_faixa_manual: !!z.confluencia_faixa_manual,
    confluencia_resistencia_macro: !!z.confluencia_resistencia_macro,
    confluencia_manual_qualquer: !!z.confluencia_manual_qualquer,
    membros: (z.membros || []).map((m) => ({ time: m.time, preco: m.preco, tipo: m.tipo })),
    velasComScoreAlto: z.velasComScoreAlto || 0,
    velasEnfraquecida: z.velasEnfraquecida || 0,
    ultimaVelaAvaliada: z.ultimaVelaAvaliada || null,
  };
}

// Resumo textual DERIVADO do mesmo objeto canonico.
export function zonaParaEstado(z) {
  const { membros, ...resto } = z;
  return resto;
}

export function zonasParaTexto(zonas, dec, fmtDiaFn) {
  if (!zonas.length) return ["zonas_automaticas: nenhuma"];
  const L = [`zonas_automaticas_total: ${zonas.length}`];
  zonas.forEach((z, i) => {
    L.push(
      `zona_auto_${i + 1}: id=${z.id} tipo=${z.tipo} status=${z.status} ` +
        `estado=${z.estado_atual} score=${z.score} ` +
        `estrutural=${z.limites_estruturais.inferior.toFixed(dec)}-${z.limites_estruturais.superior.toFixed(dec)} ` +
        `operacional=${z.limites_operacionais.inferior.toFixed(dec)}-${z.limites_operacionais.superior.toFixed(dec)} ` +
        `centro=${z.centro.toFixed(dec)} toques=${z.numero_toques} ` +
        `rejeicoes=${z.numero_rejeicoes} role_reversal=${z.role_reversal ? "sim" : "nao"} ` +
        `dist_pct=${z.distancia_preco_atual_pct.toFixed(2)} ` +
        `confluencia_manual=${z.confluencia_nivel_manual ? "sim" : "nao"} ` +
        `confluencia_faixa=${z.confluencia_faixa_manual ? "sim" : "nao"} ` +
        `confluencia_macro=${z.confluencia_resistencia_macro ? "sim" : "nao"} ` +
        `confluencia_qualquer=${z.confluencia_manual_qualquer ? "sim" : "nao"}`
    );
  });
  return L;
}

// ------------------------------------------------------------
// Bloco de texto por par
// ------------------------------------------------------------

function descrevePivos(idxs, precos, times, dec) {
  if (!idxs.length) return "nenhum";
  return idxs
    .slice(-3)
    .map((p) => `${fmtDia(times[p])}=${num(precos[p], dec)}`)
    .join(" ");
}

function detalheDiv(x, times, dec, timeViva) {
  const dataAnt = fmtDia(times[x.idxAnterior]);
  const dataAtual =
    x.idxAtual < times.length ? fmtDia(times[x.idxAtual]) : fmtDia(timeViva);
  return (
    `tipo=${x.tipo} lado=${x.lado} ` +
    `status=${x.confirmada ? "confirmada" : "PROVISORIA"} ` +
    `pivo_anterior=${dataAnt} preco_anterior=${num(x.precoAnterior, dec)} ` +
    `rsi_anterior=${num(x.rsiAnterior, 2)} ` +
    `pivo_atual=${dataAtual} preco_atual=${num(x.precoAtual, dec)} ` +
    `rsi_atual=${num(x.rsiAtual, 2)}`
  );
}

function readPair(cfg, d, tf, opts = {}) {
  const estadoAnt = opts.estadoNiveis || {};
  const estadoNovo = {};
  const { highs, lows, closes, opens, times, live } = d;
  const D = cfg.dec;

  // --- indicadores com velas FECHADAS (referencia principal) ---
  const rsi = rsiSeries(closes);
  const { plusDI, minusDI, adx } = dmiSeries(highs, lows, closes);
  const ema = emaSeries(closes);

  const i = closes.length - 1;
  const j = i - 1;

  // --- indicadores PROVISORIOS (incluindo a vela em formacao) ---
  const closesP = closes.concat([live.close]);
  const highsP = highs.concat([live.high]);
  const lowsP = lows.concat([live.low]);
  const rsiP = rsiSeries(closesP);
  const dmiP = dmiSeries(highsP, lowsP, closesP);
  const k = closesP.length - 1;

  // --- linha "eventos": logica e texto ORIGINAIS, nao mexer ---
  const crossUp = plusDI[j] <= minusDI[j] && plusDI[i] > minusDI[i];
  const crossDown = plusDI[j] >= minusDI[j] && plusDI[i] < minusDI[i];
  const notes = [];
  if (crossUp) notes.push("DI+ cruzou ACIMA de DI- nesta vela");
  if (crossDown) notes.push("DI+ cruzou ABAIXO de DI- nesta vela");
  if (rsi[i] >= 70 && rsi[j] < 70) notes.push("RSI entrou em sobrecompra (>=70)");
  if (rsi[i] <= 30 && rsi[j] > 30) notes.push("RSI entrou em sobrevenda (<=30)");
  if (adx[i] !== null && adx[j] !== null) {
    if (adx[i] >= 25 && adx[j] < 25)
      notes.push("ADX cruzou 25 (tendencia ganhando forca)");
    if (adx[i] < 25 && adx[j] >= 25)
      notes.push("ADX caiu abaixo de 25 (tendencia perdendo forca)");
  }
  const linhaEventos = notes.length
    ? notes.join(" | ")
    : "nenhum cruzamento nesta vela";

  // --- velas fechadas recentes e padroes ---
  const ult = velasFechadas(d, 3);
  const medCorpo = medianaCorpos(opens, closes, 20);
  const padroes = detectarPadroes(ult, medCorpo);
  const formacao = padraoEmFormacao(ult, live, medCorpo);


  // --- pivos, estrutura, divergencias e volume (SO velas fechadas) ---
  const pivos = acharPivos(highs, lows);
  const estrutura = classificarEstrutura(highs, lows, pivos);
  const estruturaEventos = mudancaEstrutura(highs, lows, pivos);
  const divergencias = detectarDivergencias(highs, lows, rsi, pivos);
  const divProvisorias = divergenciaProvisoria(
    highs,
    lows,
    rsi,
    rsiP[k],
    pivos,
    live
  );
  const vol = analisarVolume(d.volumes || [], live.volume, VOL_MEDIA, !!d.temVolume);

  // contexto do trio: o de velas fechadas comeca em closes.length-3,
  // entao a referencia e' a vela imediatamente anterior a ele.
  const ctxFechado = contextoAntesDoTrio(closes, closes.length - 4);
  const ctxFormacao = contextoAntesDoTrio(closes, closes.length - 3);
  const enfraquecimento = detectarEnfraquecimento(ult);
  const diagSoldados = diagnosticoSoldados(ult, medCorpo);

  const fraqueza = evidenciasFraqueza(
    ult,
    enfraquecimento,
    divergencias,
    estruturaEventos
  );

  let ctxSoldados = "nao_aplicavel";
  let ctxUsado = ctxFechado;
  if (padroes.includes("tres_soldados_brancos"))
    ctxSoldados = classificarContextoSoldados(ctxFechado, fraqueza);
  else if (padroes.includes("tres_corvos_negros"))
    ctxSoldados = classificarContextoCorvosComFraqueza(ctxFechado, fraqueza);
  else if (formacao.includes("possiveis_tres_soldados_brancos")) {
    ctxUsado = ctxFormacao;
    ctxSoldados = classificarContextoSoldados(ctxFormacao, fraqueza);
  } else if (formacao.includes("possiveis_tres_corvos_negros")) {
    ctxUsado = ctxFormacao;
    ctxSoldados = classificarContextoCorvosComFraqueza(ctxFormacao, fraqueza);
  }
  const confEstrutural = confirmacaoEstrutural(ctxUsado, estrutura.tendencia);

  // ---- maquina de estados dos niveis (sobre a ULTIMA VELA FECHADA) ----
  const velaFechada = {
    open: opens[i],
    high: highs[i],
    low: lows[i],
    close: closes[i],
    time: times[i],
  };
  const mudancasNivel = [];
  const linhasNivel = [];
  for (const nv of niveisDoPar(cfg)) {
    const chave = chaveNivel(cfg.key, tf.key, nv.nivel);
    const antes = estadoAnt[chave] || null;
    const depois = atualizarEstadoNivel(antes, {
      nivel: nv.nivel,
      direcao: nv.direcao,
      vela: velaFechada,
      tolPct: RETEST_TOLERANCE_PCT,
      resetPct: RETEST_RESET_DISTANCE_PCT,
      maxCandles: tf.retestMaxCandles,
      segundos: tf.segundos,
    });
    if (depois) estadoNovo[chave] = depois;
    if (depois && antes && depois.estado !== antes.estado)
      mudancasNivel.push(`${depois.estado}_${nv.label}`);
    if (depois && !antes && depois.estado === "rompido")
      mudancasNivel.push(`rompido_${nv.label}`);

    linhasNivel.push(
      `nivel_${nv.label}_estado: ${depois ? depois.estado : "sem_registro"}`
    );
    if (depois && depois.estado !== "arquivado") {
      linhasNivel.push(`nivel_${nv.label}_direcao: ${depois.direcao}`);
      linhasNivel.push(
        `nivel_${nv.label}_preco_rompimento: ${num(depois.precoRompimento, D)}`
      );
      linhasNivel.push(
        `nivel_${nv.label}_rompeu_em: ${fmtDia(depois.dataRompimento)}`
      );
      linhasNivel.push(
        `nivel_${nv.label}_ultimo_contato: ${fmtDia(depois.ultimoContato)}`
      );
      linhasNivel.push(`nivel_${nv.label}_afastado: ${depois.afastado ? "sim" : "nao"}`);
    }
    linhasNivel.push(
      `nivel_${nv.label}_historico: ${
        depois && depois.historico && depois.historico.length
          ? depois.historico.join(" ")
          : "nenhum"
      }`
    );
  }

  // ---- volume parcial ----
  const fracao = fracaoPeriodo(live, tf.segundos);
  const parcial = fracao !== null && fracao < 0.98;
  const volSemana =
    tf.key === "semanal" ? volumeSemanaEquivalente(d, opts.dadosDiario) : null;

  // ---- metricas normalizadas das velas ----
  const mFechada = metricasVela(ult[0]);
  const mViva = metricasVela(anatomia(live.open, live.high, live.low, live.close));

  // --- alertas tecnicos (linha nova) ---
  const alertas = alertasTecnicos(cfg, d, {
    rsi: rsi[i],
    adx: adx[i],
    adxAnt: adx[j],
    diPlus: plusDI[i],
    diMinus: minusDI[i],
    crossUp,
    crossDown,
    divergencias,
    estruturaEventos,
    estruturaTendencia: estrutura.tendencia,
    volume: vol,
    enfraquecimento,
    padroes,
    contextoTrio: ctxSoldados,
    mudancasNivel,
  });

  // ---- zonas automaticas (SO contexto: nao geram alerta) ----
  const zonasRes = calcularZonas(cfg, tf, d, {
    pivos,
    zonasAnteriores: opts.zonasAnteriores || [],
    zonasSemanais: opts.zonasSemanais || [],
    proximoId: opts.proximoIdZona || 1,
    volumeMedia20: vol.media,
    niveisManuais: niveisDoPar(cfg).map((n) => n.nivel),
    faixasManuais: cfg.niveis.faixas || [],
    resistenciaMacro: cfg.niveis.resistenciaMacro || null,
  });
  const zonasAutomaticas = zonasRes.zonas;
  const zonasEstadoPar = zonasRes.zonasEstado || [];

  const estadosNivel = Object.values(estadoNovo).map((x) => x.estado);
  const sint = sinteses({
    alertas,
    estrutura,
    estruturaEventos,
    divergencias,
    vol,
    enfraquecimento,
    fraqueza,
    rsiFech: rsi[i],
    rsiAnt: rsi[j],
    diPlus: plusDI[i],
    diMinus: minusDI[i],
    estadosNivel,
  });

  const emaAtual = ema[i];
  const varAbertura = ((live.close - live.open) / live.open) * 100;
  const distEma =
    emaAtual === null ? null : ((live.close - emaAtual) / emaAtual) * 100;

  const L = [];
  L.push(cfg.label);
  L.push(`timeframe: ${tf.key}`);
  L.push(`preco_atual: ${num(live.close, D)}`);
  L.push(`candle_atual_data: ${fmtDia(live.time)}`);
  L.push(`candle_atual_open: ${num(live.open, D)}`);
  L.push(`candle_atual_high: ${num(live.high, D)}`);
  L.push(`candle_atual_low: ${num(live.low, D)}`);
  L.push(`candle_atual_close_provisorio: ${num(live.close, D)}`);
  L.push(`candle_atual_var_pct_desde_abertura: ${num(varAbertura, 2)}`);
  L.push(`ema89: ${num(emaAtual, D)}`);
  L.push(
    `posicao_vs_ema89: ${
      emaAtual === null ? "--" : live.close >= emaAtual ? "acima" : "abaixo"
    }`
  );
  L.push(`distancia_ema89_pct: ${num(distEma, 2)}`);
  L.push("");
  L.push(`# principais: calculados SOMENTE com velas ${tf.key === "semanal" ? "semanais " : ""}fechadas`);
  L.push(`rsi14_fechado: ${num(rsi[i], 2)}`);
  L.push(`di_plus14_fechado: ${num(plusDI[i], 2)}`);
  L.push(`di_minus14_fechado: ${num(minusDI[i], 2)}`);
  L.push(`adx14_fechado: ${num(adx[i], 2)}`);
  L.push(`ultimo_fechamento_data: ${fmtDia(times[i])}`);
  L.push(`ultimo_fechamento_close: ${num(closes[i], D)}`);
  L.push("");
  L.push("# PROVISORIOS: incluem a vela em formacao e PODEM MUDAR ate o");
  L.push(`# fechamento ${tf.key}. NAO sao a referencia principal.`);
  L.push(`rsi14_provisorio: ${num(rsiP[k], 2)}`);
  L.push(`di_plus14_provisorio: ${num(dmiP.plusDI[k], 2)}`);
  L.push(`di_minus14_provisorio: ${num(dmiP.minusDI[k], 2)}`);
  L.push(`adx14_provisorio: ${num(dmiP.adx[k], 2)}`);
  L.push("");
  ult.forEach((v, idx) => {
    L.push(
      `candle_fechado_${idx + 1}: data=${fmtDia(v.time)} open=${num(v.open, D)} ` +
        `high=${num(v.high, D)} low=${num(v.low, D)} close=${num(v.close, D)} ` +
        `direcao=${v.alta ? "alta" : v.baixa ? "baixa" : "neutra"} ` +
        `corpo=${num(v.corpo, D)} sombra_sup=${num(v.sombraSup, D)} ` +
        `sombra_inf=${num(v.sombraInf, D)}` +
        (d.temVolume ? ` volume=${num(v.volume, 4)}` : "")
    );
  });
  L.push("");
  // ---- estado dos niveis (rompimento / reteste) ----
  L.push("");
  linhasNivel.forEach((x) => L.push(x));
  L.push(
    `niveis_mudancas_nesta_vela: ${mudancasNivel.length ? mudancasNivel.join(", ") : "nenhuma"}`
  );

  // ---- periodo e volume ----
  L.push("");
  L.push(`fracao_periodo_decorrida: ${fracao === null ? "--" : fracao.toFixed(3)}`);
  // Fora do pregao (fim de semana, feriado, ou fonte fim-de-dia) a
  // "vela atual" ja e' uma vela fechada. Esta linha e' o que separa os
  // dois casos para quem le so o JSON.
  L.push(`vela_atual_em_formacao: ${parcial ? "sim" : "nao"}`);
  if (d.temVolume) {
    L.push(`volume_parcial: ${parcial ? "sim" : "nao"}`);
    L.push(`volume_atual: ${num(vol.atual, 4)}`);
    L.push(`volume_ultima_fechada: ${num(vol.ultimaFechada, 4)}`);
    L.push(`volume_media${vol.periodoMedia || VOL_MEDIA}: ${num(vol.media, 4)}`);
    L.push(`volume_vs_media_pct: ${num(vol.vsMediaPct, 2)}`);
    // A comparacao e' sempre entre velas FECHADAS, entao nao existe mais
    // um estado "inconclusivo por inicio de periodo".
    L.push(`volume_referencia: ultima_vela_fechada`);
    L.push(`volume_classificacao: ${vol.classificacao}`);
    L.push(`volume_tendencia_3_fechadas: ${vol.tendencia}`);
    L.push(`trades_vela_atual: ${num(live.trades, 0)}`);
    if (volSemana) {
      L.push(`volume_semana_dias_fechados: ${volSemana.dias}`);
      L.push(`volume_semana_soma_dias_fechados: ${num(volSemana.somaAtual, 4)}`);
      L.push(
        `volume_semanas_anteriores_mesmos_dias_media: ${num(volSemana.mediaEquivalente, 4)}`
      );
      L.push(`volume_semana_vs_equivalente_pct: ${num(volSemana.vsPct, 2)}`);
      L.push(`volume_semana_semanas_comparadas: ${volSemana.semanasComparadas}`);
    }
  } else {
    // Um campo so, e negativo de proposito. Publicar volume_vs_media_pct
    // como "--" faria um consumidor concluir que o dado existe e falhou
    // hoje; "nao" diz que ele nao existe neste par, nunca.
    L.push(`volume_disponivel: nao`);
  }

  // ---- estrutura de mercado ----
  L.push("");
  L.push(`estrutura_preco: ${estrutura.rotulo}`);
  L.push(`estrutura_tendencia: ${estrutura.tendencia}`);
  L.push(`estrutura_ultimo_topo: ${estrutura.topo || "--"}`);
  L.push(`estrutura_ultimo_fundo: ${estrutura.fundo || "--"}`);
  L.push(
    `estrutura_eventos: ${estruturaEventos.length ? estruturaEventos.join(", ") : "nenhum"}`
  );
  L.push(`pivos_topos_recentes: ${descrevePivos(pivos.altos, highs, times, D)}`);
  L.push(`pivos_fundos_recentes: ${descrevePivos(pivos.baixos, lows, times, D)}`);

  // ---- divergencias de RSI ----
  L.push("");
  L.push(
    `divergencia_rsi: ${
      divergencias.length
        ? divergencias.map((x) => `${x.tipo}_confirmada`).join(", ")
        : "nenhuma"
    }`
  );
  divergencias.forEach((x, idx) => {
    L.push(`divergencia_rsi_detalhe_${idx + 1}: ${detalheDiv(x, times, D)}`);
  });
  L.push(
    `divergencia_rsi_provisoria: ${
      divProvisorias.length
        ? divProvisorias.map((x) => `${x.tipo}_PROVISORIA`).join(", ")
        : "nenhuma"
    }`
  );
  divProvisorias.forEach((x, idx) => {
    L.push(
      `divergencia_rsi_provisoria_detalhe_${idx + 1}: ${detalheDiv(x, times, D, live.time)}`
    );
  });

  L.push("");
  if (mFechada) {
    L.push(`corpo_pct_range: ${num(mFechada.corpoPctRange, 2)}`);
    L.push(`sombra_sup_pct_range: ${num(mFechada.sombraSupPctRange, 2)}`);
    L.push(`sombra_inf_pct_range: ${num(mFechada.sombraInfPctRange, 2)}`);
    L.push(`sombra_sup_vs_corpo: ${num(mFechada.sombraSupVsCorpo, 2)}`);
    L.push(`sombra_inf_vs_corpo: ${num(mFechada.sombraInfVsCorpo, 2)}`);
  }
  if (mViva) {
    L.push(`candle_atual_corpo_pct_range: ${num(mViva.corpoPctRange, 2)}`);
    L.push(`candle_atual_sombra_sup_pct_range: ${num(mViva.sombraSupPctRange, 2)}`);
    L.push(`candle_atual_sombra_inf_pct_range: ${num(mViva.sombraInfPctRange, 2)}`);
    L.push(`candle_atual_sombra_sup_vs_corpo: ${num(mViva.sombraSupVsCorpo, 2)}`);
    L.push(`candle_atual_sombra_inf_vs_corpo: ${num(mViva.sombraInfVsCorpo, 2)}`);
  }

  L.push("");
  L.push(`${tf.campoEventos}: ${linhaEventos}`);
  L.push(`mediana_corpo_20: ${num(medCorpo, Math.max(D, 6))}`);
  L.push(`contexto_antes_do_trio: ${ctxFechado}`);
  L.push(`padrao_trio_contexto: ${ctxSoldados}`);
  L.push(`padrao_trio_confirmacao_estrutural: ${confEstrutural}`);
  L.push(
    `padrao_trio_evidencias_fraqueza: ${fraqueza.length ? fraqueza.join(", ") : "nenhuma"}`
  );
  L.push(
    `padroes_enfraquecimento: ${
      enfraquecimento.length ? enfraquecimento.join(", ") : "nenhum"
    }`
  );
  L.push(`tres_soldados_diagnostico: ${diagSoldados}`);
  L.push(`padrao_candles: ${padroes.length ? padroes.join(", ") : "nenhum"}`);
  L.push(
    `padrao_em_formacao: ${formacao.length ? formacao.join(", ") : "nenhum"}`
  );
  L.push(`alertas_tecnicos: ${alertas.length ? alertas.join(", ") : "nenhum"}`);
  L.push("");
  zonasParaTexto(zonasAutomaticas, Math.max(D, 6), fmtDia).forEach((x) => L.push(x));
  L.push("");
  L.push(`confluencia_entrada: ${sint.entrada}`);
  L.push(`confluencia_pullback: ${sint.pullback}`);
  L.push(`riscos_tecnicos: ${sint.riscos}`);
  L.push(`deterioracao_tendencia: ${sint.deterioracao}`);

  return {
    texto: L.join("\n"),
    estadoNiveis: estadoNovo,
    zonasAutomaticas,
    zonasEstadoPar,
    proximoIdZona: zonasRes.proximoId,
  };
}

// ------------------------------------------------------------
// Gatilhos do alerta
//
// Mesmos criterios dos outros dois monitores: rompimento so com o corpo
// inteiro alem do nivel, perda de suporte so com dois fechamentos
// seguidos abaixo. As mensagens saem com 4 casas porque o USD/BRL se
// move em milesimos.
// ------------------------------------------------------------

function avaliarGatilhos(dados) {
  const out = [];
  const add = (id, msg) => out.push({ id, msg });

  // Um par por vez, cada um com os proprios niveis e o proprio prefixo
  // de id. Os ids do USD/BRL continuam sendo usd_*, byte por byte iguais
  // aos de antes: quem ja consome a linha GATILHOS ATIVOS nao percebe a
  // chegada do segundo par, so ve ids usdt_* novos aparecerem.
  for (const cfg of PAIRS) {
    const d = dados[cfg.key];
    if (!d) continue;

    const nv = cfg.niveis;
    const D = cfg.dec;
    const p = d.live.close;
    const i = d.closes.length - 1;
    if (i < 0) continue;
    const fech = d.closes[i];
    const abert = d.opens[i];
    const corpoBaixo = Math.min(abert, fech);

    for (const [lo, hi, nome] of nv.faixas || []) {
      if (p >= lo && p <= hi)
        add(
          `${cfg.key}_${nome}`,
          `${cfg.label} entrou na regiao ${lo.toFixed(2)}-${hi.toFixed(2)} (agora ${p.toFixed(D)})`
        );
    }

    // Rompimento so conta com o corpo real acima do nivel — mesmo
    // criterio estrito dos monitores de BTC e XMR.
    if (nv.resistencia !== null && nv.resistencia !== undefined) {
      if (fech > nv.resistencia && corpoBaixo > nv.resistencia) {
        add(
          `${cfg.key}_rompe_${nv.resistenciaLabel}`,
          `${cfg.label} fechou o diario acima de ${nv.resistencia.toFixed(2)} com corpo confirmando (fech ${fech.toFixed(D)}, abert ${abert.toFixed(D)})`
        );
      }
    }

    // Perda de suporte exige dois fechamentos seguidos abaixo.
    if (nv.suporte !== null && nv.suporte !== undefined && i >= 1) {
      const ant = d.closes[i - 1];
      if (fech < nv.suporte && ant < nv.suporte) {
        add(
          `${cfg.key}_perde_${nv.suporteLabel}`,
          `${cfg.label} perdeu ${nv.suporte.toFixed(2)} com dois fechamentos diarios seguidos (${ant.toFixed(D)} e ${fech.toFixed(D)})`
        );
      }
    }
  }

  return out;
}


// ------------------------------------------------------------
// Montagem da pagina
// ------------------------------------------------------------

export async function build(fetchImpl = fetch, estadoAnterior = {}) {
  const blocks = [];
  const dados = {};
  const estadoNiveis = {};
  const estadoAnt = (estadoAnterior && estadoAnterior.niveis) || {};
  const zonasAnt = (estadoAnterior && estadoAnterior.zonas) || {};
  const contadoresZona = { ...((estadoAnterior && estadoAnterior.contadoresZona) || {}) };
  const zonasNovas = {};
  const zonasPublicadas = {};

  blocks.push(`timestamp: ${fmtUTC(Math.floor(Date.now() / 1000))}`);

  // Busca TUDO primeiro. As zonas semanais precisam existir antes das
  // diarias (confluencia), e a linha "fonte:" so pode ser escrita depois
  // de saber qual das fontes da cascata respondeu — por isso o cabecalho
  // termina de ser montado abaixo, e nao aqui.
  const brutos = {};
  const fontesPorPar = {};
  for (const tf of TIMEFRAMES) {
    dados[tf.key] = {};
    brutos[tf.key] = {};
    for (const cfg of PAIRS) {
      const r = await buscarSerie(fetchImpl, cfg, tf);
      brutos[tf.key][cfg.key] = r;
      if (r.ok) dados[tf.key][cfg.key] = r.parsed;
      (fontesPorPar[cfg.key] || (fontesPorPar[cfg.key] = [])).push(
        `${tf.key}=${r.ok ? r.fonte : "indisponivel"}`
      );
    }
  }

  blocks.push(
    `fonte: ${PAIRS.map(
      (c) => `${c.label} ${(fontesPorPar[c.key] || []).join(" ")}`
    ).join(" | ")}`
  );
  blocks.push(
    `fontes_em_cascata: ${PAIRS.map(
      (c) => `${c.label} ${c.fontes.map((f) => f.nome).join(" -> ")}`
    ).join(" | ")} (vale a primeira que responder)`
  );
  blocks.push(`indicadores: RSI(14) e DMI/ADX(14) por Wilder/RMA, EMA(89) exponencial`);
  blocks.push(
    `volume: USD/BRL nao_aplicavel (cambio a vista e' balcao, sem tape publico) | ` +
      `USDT/BRL real (negocia em corretora)`
  );
  blocks.push(`nota: campos *_fechado usam apenas velas fechadas; *_provisorio inclui a vela em formacao`);
  blocks.push(`nota: a linha "eventos:" existe so no bloco diario; no semanal ela se chama "eventos_semanal:"`);
  blocks.push("");

  const blocosPorTf = {};
  const zonasSemanaisPorPar = {};
  // semanal primeiro (calculo), diario depois — a exibicao mantem a
  // ordem original.
  const ordemCalculo = [...TIMEFRAMES].sort((a, b) =>
    a.key === "semanal" ? -1 : b.key === "semanal" ? 1 : 0
  );

  for (const tf of ordemCalculo) {
    blocosPorTf[tf.key] = [];
    for (const cfg of PAIRS) {
      const bruto = brutos[tf.key][cfg.key];
      if (!bruto.ok) {
        blocosPorTf[tf.key].push(
          `${cfg.label}\ntimeframe: ${tf.key}\nFALHA: ${bruto.erro}`
        );
        // Sem vela nova nao ha o que avaliar: preserva estados e zonas
        // ANTERIORES deste par/timeframe. As duas fontes caindo na mesma
        // execucao nao pode apagar memoria.
        const prefixo = `${cfg.key}|${tf.key}|`;
        for (const [chave, valor] of Object.entries(estadoAnt)) {
          if (chave.startsWith(prefixo)) estadoNiveis[chave] = valor;
        }
        const chaveZ = `${cfg.key}|${tf.key}`;
        if (zonasAnt[chaveZ]) {
          zonasNovas[chaveZ] = zonasAnt[chaveZ];
          // confluencia continua usando o estado preservado
          if (tf.key === "semanal") zonasSemanaisPorPar[cfg.key] = zonasAnt[chaveZ];
        }
        // Nada e' publicado numa execucao que falhou: o bloco ja informa
        // FALHA, e exibir zonas antigas as apresentaria como se
        // tivessem sido recalculadas agora.
        zonasPublicadas[chaveZ] = [];
        blocosPorTf[tf.key].push("");
        continue;
      }
      const chaveZ = `${cfg.key}|${tf.key}`;
      const r = readPair(cfg, bruto.parsed, tf, {
        estadoNiveis: estadoAnt,
        dadosDiario: (dados.diario || {})[cfg.key],
        zonasAnteriores: zonasAnt[chaveZ] || [],
        zonasSemanais: tf.key === "diario" ? zonasSemanaisPorPar[cfg.key] || [] : [],
        proximoIdZona: (contadoresZona[chaveZ] || 0) + 1,
      });
      blocosPorTf[tf.key].push(r.texto);
      blocosPorTf[tf.key].push("");
      Object.assign(estadoNiveis, r.estadoNiveis || {});
      zonasPublicadas[chaveZ] = r.zonasAutomaticas || [];
      zonasNovas[chaveZ] = (r.zonasEstadoPar || []).map(zonaParaEstado);
      contadoresZona[chaveZ] = Math.max(
        (contadoresZona[chaveZ] || 0),
        (r.proximoIdZona || 1) - 1
      );
      // confluencia usa o ESTADO semanal (todas as vivas), nao o
      // subconjunto publicado: uma zona semanal valida fora das 3 mais
      // proximas ainda pode confirmar uma zona diaria.
      if (tf.key === "semanal") zonasSemanaisPorPar[cfg.key] = r.zonasEstadoPar || [];
    }
  }

  for (const tf of TIMEFRAMES) {
    blocks.push(`========== ${tf.titulo} ==========`);
    blocks.push("");
    for (const b of blocosPorTf[tf.key]) blocks.push(b);
  }

  // Trilho de execucao: auxiliar, e falha sozinho. Ele reaproveita as
  // series JA buscadas dos dois pares, entao nao ha chamada extra nem
  // risco de publicar precos de instantes diferentes dos blocos acima.
  // Faltando qualquer uma das duas pontas, a secao sai marcada e o
  // resto do relatorio segue inteiro.
  const usdDiario = (dados.diario || {}).usd;
  const usdtDiario = (dados.diario || {}).usdt;
  const faltando = [
    usdDiario ? null : "USD/BRL",
    usdtDiario ? null : "USDT/BRL",
  ].filter(Boolean);
  const trilho = faltando.length
    ? { ok: false, erro: `serie indisponivel nesta execucao: ${faltando.join(" e ")}` }
    : {
        ok: true,
        linhas: serieParaTrilho(usdtDiario),
        fonte: (brutos.diario.usdt || {}).fonte || "--",
      };
  for (const l of blocoTrilho(trilho, usdDiario, PAIRS[0].dec)) blocks.push(l);
  blocks.push("");

  // Gatilhos do alerta continuam olhando SOMENTE o diario.
  const gatilhos = avaliarGatilhos(dados.diario || {});
  blocks.push(
    gatilhos.length
      ? "GATILHOS ATIVOS: " + gatilhos.map((g) => g.id).join(", ")
      : "GATILHOS ATIVOS: nenhum"
  );
  blocks.push("");
  blocks.push("fim do relatorio");
  return {
    texto: blocks.join("\n"),
    gatilhos,
    estadoNiveis,
    zonas: zonasPublicadas,
    zonasEstado: zonasNovas,
    contadoresZona,
  };
}

function toHTML(text) {
  return (
    "<!doctype html>\n<meta charset=utf-8>\n<title>Monitor USD/BRL</title>\n" +
    '<pre style="font:14px/1.5 ui-monospace,monospace;padding:1rem;white-space:pre-wrap">' +
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
    "</pre>\n"
  );
}

// So executa quando chamado direto (nao durante os testes).
// Compara o caminho REAL do arquivo em execucao com o deste modulo, em
// vez do nome do arquivo: assim o script continua funcionando com
// qualquer nome, e um "import" para teste continua nao executando nada.
const executadoDireto = (() => {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (executadoDireto) {
  let estadoPrev = {};
  try {
    estadoPrev = JSON.parse(readFileSync("docs/estado.json", "utf8"));
  } catch {
    estadoPrev = {};
  }
  const anteriores = estadoPrev.ativos || [];

  const { texto, gatilhos, estadoNiveis, zonas, zonasEstado, contadoresZona } =
    await build(fetch, estadoPrev);
  mkdirSync("docs", { recursive: true });
  const ativos = gatilhos.map((g) => g.id);
  const novos = gatilhos.filter((g) => !anteriores.includes(g.id));

  writeFileSync("docs/index.html", toHTML(texto));
  writeFileSync("docs/index.txt", texto + "\n");
  writeFileSync(
    "docs/relatorio.json",
    JSON.stringify(relatorioParaJSON(texto, zonas), null, 2) + "\n"
  );
  writeFileSync("docs/.nojekyll", "");
  writeFileSync(
    "docs/estado.json",
    JSON.stringify(
      {
        ativos,
        em: new Date().toISOString(),
        niveis: estadoNiveis,
        zonas: zonasEstado,
        contadoresZona,
      },
      null,
      2
    ) + "\n"
  );

  if (novos.length) {
    writeFileSync(
      "alerta.txt",
      "ALERTA USD/BRL\n\n" + novos.map((g) => "- " + g.msg).join("\n") + "\n"
    );
    console.log("NOVOS GATILHOS:", novos.map((g) => g.id).join(", "));
  } else {
    console.log("nenhum gatilho novo");
  }

  console.log(texto);
}
