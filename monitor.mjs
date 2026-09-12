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

import { writeFileSync, appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
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
    // DMI/ADX por timeframe. O diario e' a leitura OPERACIONAL de
    // tendencia e forca para swing e position: 28/42 corta o ruido de
    // curto prazo que o 14/14 deixava passar.
    dmi: { diLen: 28, adxLen: 42 },
    // RSI mais longo que o padrao, pelo mesmo motivo do DMI: 14 no
    // diario oscila demais para um horizonte de swing/position. Mas
    // continua MAIS RESPONSIVO que o DMI deste timeframe (21 contra
    // 28/42) -- e' dele que se espera a leitura de momentum, perda de
    // forca e retomada.
    rsi: { length: 21 },
    // Pivos por timeframe, pelo mesmo motivo do RSI e do DMI. Um fractal
    // 5/5 usa cinco velas de contexto de cada lado e so confirma o pivo
    // depois que as cinco velas a direita fecham. A janela local mais
    // larga reduziu as viradas de estrutura em serie sem tendencia e
    // tambem as divergencias recusadas por pivos proximos. Isso nao cria
    // uma "perna minima" fixa entre pivos consecutivos.
    pivos: { esq: 5, dir: 5 },
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
    // O semanal e' CONTEXTO de prazo maior, nao gatilho de entrada: 14/21
    // ja e' lento o bastante nessa escala, e alongar mais so atrasaria a
    // leitura sem ganhar filtragem.
    dmi: { diLen: 14, adxLen: 21 },
    // 14 no semanal: leitura estrutural de momentum, e a mesma relacao
    // de responsividade contra o DMI semanal (14 contra 14/21).
    rsi: { length: 14 },
    // O semanal continua em 2/2: cada vela ja e' uma semana. O candidato
    // usa duas velas de contexto a esquerda e so e' confirmado depois
    // que duas velas semanais a direita fecham. Levar a 5/5 adicionaria
    // cinco semanas de confirmacao a direita, atraso excessivo para a
    // janela util deste monitor.
    pivos: { esq: 2, dir: 2 },
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
//
// A faixa de 5,00-5,05 entrou em 2026-09-12, promovida pelo radar: ele a
// apontou como zona madura (score 73, 6 toques) e descoberta, logo
// abaixo da regiao de suporte que ja existia. Sobreposicao 1,00 sobre a
// zona, e o diario foi a 4 de 4.
const NIVEIS_USD = {
  faixas: [
    [5.25, 5.36, "faixa_5_25_5_36"],
    [5.13, 5.21, "faixa_5_13_5_21"],
    [5.05, 5.12, "regiao_suporte_5_05_5_12"],
    [5.0, 5.05, "regiao_suporte_5_00_5_05"],
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

// O periodo SEMPRE vem de quem chama (tf.rsi.length); o default de 14
// so existe para nao quebrar chamada sem argumento. Metodo inalterado:
// Wilder/RMA, igual desde o inicio.
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

// DOIS periodos, como no DMI do TradingView: diLen suaviza TR, +DM e
// -DM (e portanto os DIs); adxLen suaviza o DX para virar ADX. Ate
// 2026-09-11 havia um so, usado nos dois papeis e nos dois timeframes.
// Chamar com (14, 14) reproduz exatamente o comportamento antigo, e ha
// teste fixando isso.
//
// O metodo nao mudou: Wilder/RMA em todas as etapas.
export function dmiSeries(highs, lows, closes, diLen = PERIOD, adxLen = diLen) {
  const n = closes.length;
  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const adx = new Array(n).fill(null);
  if (n < diLen + adxLen) return { plusDI, minusDI, adx };

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
  for (let i = 1; i <= diLen; i++) {
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

  writeDI(diLen);
  for (let i = diLen + 1; i < n; i++) {
    trS = trS - trS / diLen + tr[i];
    pS = pS - pS / diLen + pDM[i];
    mS = mS - mS / diLen + mDM[i];
    writeDI(i);
  }

  // O DX so existe a partir de diLen; a semente do ADX e' a media dos
  // adxLen primeiros DX, e dai em diante Wilder com adxLen. Com
  // diLen === adxLen isto e' exatamente o 2*period-1 de antes.
  const firstAdx = diLen + adxLen - 1;
  if (n > firstAdx) {
    let sum = 0;
    for (let i = diLen; i <= firstAdx; i++) sum += dx[i];
    adx[firstAdx] = sum / adxLen;
    for (let i = firstAdx + 1; i < n; i++) {
      adx[i] = (adx[i - 1] * (adxLen - 1) + dx[i]) / adxLen;
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
    `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cfg.par)}` +
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
      `?symbol=${encodeURIComponent(cfg.par)}&interval=${tf.intervalos.binance}&limit=1000`,
    parse: parseBinance,
  },
  {
    nome: "mercadobitcoin",
    url: (cfg, tf) => {
      const agora = Math.floor(Date.now() / 1000);
      return (
        "https://api.mercadobitcoin.net/api/v4/candles" +
        `?symbol=${encodeURIComponent(cfg.parMB)}&resolution=${tf.intervalos.mercadobitcoin}` +
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
// A ORDEM MANDA em duas coisas: em que sequencia os pares saem no
// relatorio e, antes desta mudanca, na pagina. O USDT/BRL vem primeiro
// porque e' o instrumento de EXECUCAO -- e' nele que se dolariza e
// desdolariza, e' o unico com volume real e o unico cujo grafico vem da
// mesma fonte do numero. O USD/BRL vem depois, como referencia.
//
// Isso e' ordem de APRESENTACAO, nao de analise: para o agente, o
// prompt continua dizendo que a referencia macro e' o USD/BRL -- e' o
// dolar de verdade, sem o premio que o USDT carrega.
const PAIRS = [
  {
    key: "usdt",
    // O instrumento de EXECUCAO: e' nele que se dolariza e desdolariza
    // rapido. Tem a analise tecnica completa, com uma vantagem sobre o
    // par de cambio -- negocia em corretora, entao tem volume de
    // verdade, e todo o subsistema de volume funciona aqui.
    label: "USDT/BRL",
    par: "USDTBRL",
    grafico: "BINANCE:USDTBRL",
    graficoNota:
      "Série da Binance (BINANCE:USDTBRL) desenhada pelo TradingView — a mesma fonte primária do relatório acima.",
    parMB: "USDT-BRL",
    fontes: FONTES_CRIPTO,
    dec: 4,
    niveis: NIVEIS_USDT,
  },
  {
    key: "usd",
    // O ativo monitorado e' o DOLAR; o real e' a moeda de cotacao. Por
    // isso o par se escreve USD/BRL e o preco sobe quando o dolar sobe.
    label: "USD/BRL",
    par: "USDBRL=X",
    // SEM CARTAO no painel visual: fica so no relatorio completo, abaixo
    // do USDT/BRL. Nao e' descarte -- a analise tecnica dele continua
    // inteira, e o prompt continua tratando o USD/BRL como referencia
    // macro. E' que o painel de cima existe para o que se olha rapido, e
    // o que se olha rapido aqui e' o par de execucao.
    semCartao: true,
    // SEM GRAFICO, de proposito. Nas outras quatro fontes deste projeto
    // o desenho vem da mesma origem do numero -- Kraken nos monitores de
    // cripto, Binance no USDT/BRL. Aqui nao daria: o TradingView nao
    // serve a serie do Yahoo, e as fontes que ele usa para USD/BRL foram
    // sondadas e reprovadas (FX_IDC e' licenciado, OANDA e SAXO pedem
    // conta, FXCM desativou a API, TVC e' composicao interna). Grafico de
    // uma fonte ao lado de numero de outra convida a comparar duas
    // coisas que nao sao a mesma. Preencher `grafico` aqui volta a
    // liga-lo, se um dia a fonte bater.
    fontes: FONTES_CAMBIO,
    // 4 casas: o par se move em milesimos, e 2 casas apagariam a
    // diferenca entre uma vela parada e uma vela de meio por cento.
    dec: 4,
    niveis: NIVEIS_USD,
  },
];

// Busca a configuracao de um par pelo rotulo publicado no relatorio.
// Mesma forma nos tres monitores: e' o que permite ao parser do JSON
// nao ter rotulo nenhum cravado no codigo.
// Exportado para o teste conferir que todo par com grafico tem nota.
export const PARES_TESTE = PAIRS;

// Exportado para o teste conferir os periodos por timeframe.
export const TIMEFRAMES_TESTE = TIMEFRAMES;

function parPorLabel(label) {
  return PAIRS.find((c) => c.label === label) || null;
}

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

const SEMANA = 604800;

// Segunda-feira 00:00 UTC da semana que contem o instante. A epoca
// (1970-01-01) caiu numa quinta; a segunda anterior e' -3 dias.
export function inicioSemana(epochSeconds) {
  const desde = (((epochSeconds + 3 * 86400) % SEMANA) + SEMANA) % SEMANA;
  return epochSeconds - desde;
}

function montarSerie(linhas, { temVolume = false, periodo = null } = {}) {
  // Uma entrada por instante, a ultima vence: o Yahoo repete a vela do
  // dia corrente a cada chamada e o Stooq pode repetir a borda.
  //
  // SEMANA EM PEDACOS. O Yahoo carimba a barra semanal EM ANDAMENTO com
  // a data do dia, nao com a segunda-feira -- e as vezes manda dois
  // pedacos da mesma semana: seg-qua carimbado na segunda e a quinta
  // carimbada na quinta. Tratando cada carimbo como vela propria, a
  // semana corrente saia como FECHADA com o fechamento de quarta e
  // nascia uma "semana" de um dia. O filtro de amplitude zero abaixo
  // nao pega: o pedaco tem amplitude, e' meio pregao de verdade.
  //
  // No semanal a chave passa a ser a segunda-feira da semana, e pedacos
  // da mesma semana se fundem: abertura do primeiro, extremos do
  // conjunto, fechamento do ultimo. E' o unico calendario embutido
  // aqui, e e' o das tres fontes deste monitor -- para barra que ja vem
  // ancorada na segunda (Binance, MB) a chave e' identidade e nada muda.
  const chave = periodo === SEMANA ? inicioSemana : (t) => t;
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
    const k = chave(l.time);
    const ant = porTempo.get(k);
    if (!ant || ant.carimbo === l.time) {
      // mesmo carimbo: repeticao da fonte, a ultima vence (como sempre)
      porTempo.set(k, { ...l, time: k, carimbo: l.time });
    } else {
      const [primeiro, ultimo] = l.time > ant.carimbo ? [ant, l] : [l, ant];
      porTempo.set(k, {
        time: k,
        carimbo: Math.max(ant.carimbo, l.time),
        open: primeiro.open,
        high: Math.max(ant.high, l.high),
        low: Math.min(ant.low, l.low),
        close: ultimo.close,
        volume: (ant.volume || 0) + (l.volume || 0),
        trades: (ant.trades || 0) + (l.trades || 0),
      });
    }
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

export function parseYahoo(texto, tf) {
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
  return montarSerie(linhas, { periodo: tf && tf.segundos });
}

export function parseBinance(texto, tf) {
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
    { temVolume: true, periodo: tf && tf.segundos }
  );
}

export function parseMercadoBitcoin(texto, tf) {
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
    { temVolume: true, periodo: tf && tf.segundos }
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
      const parsed = fonte.parse(await res.text(), tf);
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
  if (tendencia !== "alta" && tendencia !== "baixa") return "neutro";
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

  // Quatro configuracoes reais, nao tres. Antes, contracao, expansao e
  // FALTA DE DADOS saiam todas como "lateral_indefinida":
  //   - LH_HL e' contracao: o range aperta, fundo mais alto. Nao e'
  //     deterioracao, e costuma preceder movimento.
  //   - HH_LL e' expansao: topo mais alto E fundo mais baixo ao mesmo
  //     tempo. O range ABRE -- o oposto de lateral.
  //   - sem dois pivos de cada tipo nao ha estrutura nenhuma a declarar,
  //     e afirmar "lateral" ali era publicar ausencia de dado como
  //     estado de mercado.
  let tendencia;
  if (topo === "HH" && fundo === "HL") tendencia = "alta";
  else if (topo === "LH" && fundo === "LL") tendencia = "baixa";
  else if (topo === "LH" && fundo === "HL") tendencia = "lateral_contracao";
  else if (topo === "HH" && fundo === "LL") tendencia = "lateral_expansao";
  else tendencia = "indefinida";

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
    // O nome promete um fundo mais baixo, entao a condicao compara com
    // o PRIMEIRO fundo, nao so com o do meio: 100 -> 110 -> 105 tem
    // c < b, mas 105 segue acima de 100 e nao ha LL nenhum ali.
    if (b > a && c < a) eventos.push("perda_estrutura_alta_novo_LL");
    if (b < a && c > b) eventos.push("novo_HL_apos_fundo_mais_baixo");
  }
  if (altos.length >= 3) {
    const [a, b, c] = altos.slice(-3).map((p) => highs[p]);
    // Mesma correcao, espelhada: 110 -> 100 -> 105 tem c > b, mas 105
    // esta abaixo de 110 e nao e' topo novo.
    if (b < a && c > a) eventos.push("novo_HH_apos_topo_mais_baixo");
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

export function alertasTecnicos(cfg, d, ind) {
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
    if (fechAtual < S) {
      // Espelho da resistencia: so' e' perda confirmada se o CORPO inteiro
      // fechou abaixo. Fechamento 0,05% abaixo com corpo em cima do nivel
      // e' encostada, nao travessia -- e era publicado como confirmada.
      const corpoAbaixo = Math.max(abertFech, fechAtual) < S;
      a.push(
        corpoAbaixo
          ? `perda_suporte_confirmada_${nv.suporteLabel}`
          : `perda_suporte_confirmada_fraca_${nv.suporteLabel}`
      );
    } else if (d.live.low < S || p < S)
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

// Em ATR, como todo o resto do projeto, e agora IGUAL nos tres
// monitores. Antes era percentual fixo, e um percentual vale coisas
// diferentes em cada ativo: os 0,5%/3% dos monitores de cripto valiam
// 0,592 ATR e 3,55 ATR no USDT/BRL, tao largos que quase toda vela caia
// "na zona" e o ciclo nunca encerrava. A saida tinha sido cortar os
// numeros pela metade so aqui, o que corrigia este monitor e deixava a
// unidade errada. Medidos em ATR, aqueles 0,25%/1,5% ajustados a mao
// davam 0,23-0,30 ATR e 1,36-1,78 ATR -- praticamente os valores
// abaixo, que agora valem para qualquer par sem ajuste por fonte.
const RETEST_TOLERANCIA_ATR = 0.25; // largura da zona em torno do nivel
const RETEST_RESET_ATR = 1.5; // afastamento que encerra o ciclo
// Usados so enquanto nao ha ATR (serie curta demais); sao os valores
// antigos deste monitor, para o comportamento nao mudar nesse canto.
const RETEST_TOLERANCIA_PCT_FALLBACK = 0.25;
const RETEST_RESET_PCT_FALLBACK = 1.5;
const HISTORICO_MAX = 5;

export function chaveNivel(parKey, tfKey, nivel) {
  return `${parKey}|${tfKey}|${nivel}`;
}

// Devolve o novo registro (ou null para descartar).
export function atualizarEstadoNivel(anterior, ctx) {
  const { nivel, direcao, vela, tolAtr, resetAtr, atr, maxCandles, segundos } = ctx;
  const temAtr = atr > 0;
  const tol = temAtr
    ? atr * tolAtr
    : Math.abs(nivel) * (RETEST_TOLERANCIA_PCT_FALLBACK / 100);
  const limiteReset = temAtr
    ? atr * resetAtr
    : Math.abs(nivel) * (RETEST_RESET_PCT_FALLBACK / 100);
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

  // Registro DORMENTE. Enquanto o preco estiver longe, fica parado e nao
  // anuncia nada. Quando o preco VOLTA a encostar no nivel, o ciclo
  // recomeca do estado operacional e o switch abaixo trata esta mesma
  // vela -- um nivel rompido ha meses que e' reencostado esta sendo
  // retestado, e e' isso que o relatorio deve dizer.
  if (e.estado === "arquivado") {
    if (!(naZona || penetrou)) return e;
    e.estado = "rompido";
    e.ultimoContato = vela.time;
    if (!e.dataRompimento) e.dataRompimento = vela.time;
  }

  // Descarte operacional por inatividade: ARQUIVA, nunca apaga.
  // Devolver null apagava o registro, e na vela seguinte o nivel nascia
  // do zero em "rompido" -- que o relatorio anuncia como rompimento
  // NOVO. Um nivel rompido e deixado para tras reanunciava o mesmo
  // rompimento a cada maxCandles velas, indefinidamente: com o preco
  // parado longe, 7 anuncios em 200 dias. O prompt promete o contrario,
  // que um rompimento vira noticia uma vez so.
  const velasSemContato = (vela.time - (e.ultimoContato || e.dataRompimento)) / segundos;
  if (velasSemContato > maxCandles) {
    return {
      estado: "arquivado",
      direcao: e.direcao,
      precoRompimento: e.precoRompimento,
      dataRompimento: e.dataRompimento,
      ultimoContato: e.ultimoContato,
      atualizado: vela.time,
      afastado: true,
      historico: e.historico,
    };
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
  // AFASTADO e' distancia, nao etapa do ciclo. Antes so era marcado ao
  // encerrar um ciclo de reteste, entao um nivel rompido ha semanas e
  // deixado muito para tras seguia publicando afastado: nao -- quem
  // lesse concluiria que o preco ainda estava por perto. Agora vale em
  // qualquer estado.
  const dist = Math.abs(vela.close - nivel);
  e.afastado = dist > limiteReset;
  // O encerramento do ciclo continua valendo so para os dois estados em
  // que ele faz sentido: um reteste confirmado ou uma recuperacao que o
  // preco deixou para tras voltam a ser simplesmente "rompido".
  if (
    dist > limiteReset &&
    (e.estado === "reteste_confirmado" || e.estado === "recuperado")
  ) {
    e.estado = "rompido";
  }

  return e;
}

// ------------------------------------------------------------
// Vigilancia dos niveis manuais
//
// Os niveis manuais sao a espinha da politica de alerta: janela
// agressiva, confirmacao conservadora e a propria revisao de niveis
// partem todos deles. Quando envelhecem, o monitor nao passa a errar --
// ele fica MUDO justamente na parte que mais importa, e nada avisa.
//
// Foi o que aconteceu com o monitor de XMR: o preco subiu 29% acima da
// faixa mais alta configurada e ficou 19 dias assim, republicando de
// hora em hora um rompimento que havia muito deixara de ser noticia.
// Detectar isso estava delegado a quem lesse o relatorio, e e'
// exatamente o tipo de coisa que ninguem nota, porque nada acontece.
//
// A distancia e' medida em ATR, e nao em porcentagem: 5% e' muito num
// par de cambio e pouco num de cripto, enquanto "duas vezes a
// volatilidade diaria" quer dizer a mesma coisa em qualquer um.
// ------------------------------------------------------------

const NIVEIS_ATUAL_ATR = 1; // ate aqui, os niveis cercam o preco
const NIVEIS_OBSOLETO_ATR = 3; // alem daqui, o preco vive noutro lugar

// A situacao mede a distancia do PRECO. Ela nao ve, e nao tem como ver,
// se a faixa continua caindo onde o mercado de fato reage: uma faixa
// pode estar a 0,66 ATR do preco (portanto "atual") e mesmo assim estar
// deslocada da regiao que as zonas automaticas encontram. Era o caso do
// BTC quando isto foi escrito -- as faixas manuais estavam ~1.500 abaixo
// da zona de score 99, e nada no relatorio dizia isso. Esta funcao
// fecha essa lacuna: compara cada faixa manual com as zonas observadas,
// pelo mesmo criterio de sobreposicao usado nas confluencias.
export function alinhamentoNiveis(niveis, zonas) {
  const faixas = (niveis && niveis.faixas) || [];
  const zs = zonas || [];
  if (!faixas.length || !zs.length) {
    return { situacao: "indefinido", corroboradas: 0, total: faixas.length };
  }
  let corroboradas = 0;
  for (const [lo, hi] of faixas) {
    const bate = zs.some((z) => {
      const L = z.limites_operacionais;
      if (!L) return false;
      return (
        sobreposicaoFrac({ inferior: lo, superior: hi }, L) >=
        CONFLUENCIA_SOBREPOSICAO_MIN
      );
    });
    if (bate) corroboradas++;
  }
  const situacao =
    corroboradas === faixas.length
      ? "alinhado"
      : corroboradas === 0
      ? "desalinhado"
      : "parcial";
  return { situacao, corroboradas, total: faixas.length };
}

export function situacaoNiveis(niveis, preco, atr) {
  const faixas = (niveis && niveis.faixas) || [];
  if (!faixas.length || !(preco > 0)) {
    return { situacao: "indefinida", distanciaAtr: null, faixa: null };
  }

  let melhor = null;
  for (const [lo, hi, label] of faixas) {
    const dentro = preco >= lo && preco <= hi;
    const dist = dentro ? 0 : Math.min(Math.abs(preco - lo), Math.abs(preco - hi));
    if (!melhor || dist < melhor.dist) melhor = { dist, label };
  }
  if (!(atr > 0)) {
    return { situacao: "indefinida", distanciaAtr: null, faixa: melhor.label };
  }

  const emAtr = melhor.dist / atr;
  return {
    situacao:
      emAtr <= NIVEIS_ATUAL_ATR
        ? "atual"
        : emAtr <= NIVEIS_OBSOLETO_ATR
        ? "monitorar"
        : "obsoleto",
    distanciaAtr: emAtr,
    faixa: melhor.label,
  };
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

export function sinteses(ctx) {
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
  // tem() e' por prefixo: sem a exclusao, a versao FRACA passaria por
  // confirmada aqui e em deterioracao. So ha um nivel de cada lado por
  // par, entao "existe forte e nao existe fraca" e' exato.
  if (tem("rompimento_confirmado") && !tem("rompimento_confirmado_fraco"))
    entrada.push("rompimento_confirmado_por_fechamento");
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
  if (tem("perda_suporte_confirmada") && !tem("perda_suporte_confirmada_fraca"))
    deterioracao.push("perda_de_suporte_confirmada");
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

    if (parPorLabel(linha)) {
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
      const cfgPar = parPorLabel(par);
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

// ------------------------------------------------------------
// ZONAS ANTERIORES QUE SUMIRAM DO CALCULO
//
// O desenho das zonas e' refeito do zero a cada execucao, e de vez em
// quando ele sai diferente: onde havia tres regioes estreitas, uma
// execucao ve uma larga. O casamento com as fichas antigas e' um para
// um, entao nesse dia sobram fichas sem dona.
//
// Elas NAO morrem na hora. Entram em enfraquecida e seguem o ciclo: se
// o desenho voltar ao normal na execucao seguinte, a ficha e'
// reencontrada com a historia inteira; se o desenho novo veio para
// ficar, ela expira sozinha na carencia do timeframe.
//
// A versao anterior descartava NA HORA a ficha coberta por uma zona
// calculada ("foi absorvida"), para nao publicar a mesma regiao duas
// vezes. O efeito medido foi outro: em 18 dias, seis execucoes apagaram
// de 3 a 18 zonas de uma vez nos tres monitores, sem nenhuma mudanca de
// codigo, e elas voltaram na execucao seguinte como zonas recem
// nascidas, com id novo e maturidade zerada -- justo o que o radar de
// promocao pressupoe que a zona acumulou.
//
// Agora a ficha coberta fica DORMENTE: continua no estado, para poder
// ser reencontrada, mas nao e' publicada nem conta como confluencia
// semanal. A duplicata que o descarte evitava continua nao existindo.
export function reconciliarAnteriores(anteriores, zonasCalculadas, tfKey, ultimaVelaFechada) {
  const par = PARAMS_TF[tfKey] || PARAMS_TF.diario;
  const calculadas = zonasCalculadas || [];
  const idsCalculados = new Set(calculadas.map((z) => z.id));
  const out = [];
  for (const ant of anteriores || []) {
    if (idsCalculados.has(ant.id) || ant.status === "remover") continue;
    const orfa = { ...ant };
    if (orfa.status === "ativa" || orfa.status === "candidata") {
      orfa.status = "enfraquecida";
      orfa.velasEnfraquecida = 0;
    } else if (orfa.status === "enfraquecida") {
      if (ant.ultimaVelaAvaliada !== ultimaVelaFechada) {
        orfa.velasEnfraquecida = (orfa.velasEnfraquecida || 0) + 1;
      }
      if (orfa.velasEnfraquecida >= par.enfraquecidaRemove) orfa.status = "remover";
    }
    orfa.ultimaVelaAvaliada = ultimaVelaFechada;
    orfa.orfa = true;
    orfa.absorvida = calculadas.some(
      (z) => sobreposicaoFrac(z.limites_estruturais, ant.limites_estruturais) >= 0.5
    );
    out.push(orfa);
  }
  return out;
}

function evidenciaEstruturalIndependente(z, confluenciaSemanal) {
  const eps = z.episodios || [];
  const comRejeicao = eps.filter((e) => e.rejeitado).length;
  if (eps.length >= 2 && comRejeicao >= 1) return true;
  if (comRejeicao >= 1 && confluenciaSemanal) return true;
  if (z.role_reversal && z.cruzamento_confirmado) return true;
  return false;
}

export function atualizarCiclo(z, anterior, ctx) {
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
    } else if (z.score < ZONA_SCORE_ENFRAQUECE || semToque > par.semToqueEnfraquece) {
      // MESMO envelhecimento da ativa. Antes, candidata so tinha uma
      // saida -- virar ativa --, entao uma regiao que nunca se provou
      // tambem nunca era descartada: ficava no estado para sempre e
      // continuava contando como confluencia do prazo maior. Havia
      // zona em observacao sem toque ha 435 semanas fazendo isso.
      z.status = "enfraquecida";
      z.velasEnfraquecida = 0;
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
    // Dormente fora: a ficha esta guardada para poder ser reencontrada,
    // nao para servir de confirmacao do prazo maior.
    const confl = (ctx.zonasSemanais || []).some(
      (zs) =>
        !zs.absorvida &&
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

  // Fichas sem dona nesta execucao: dormem, nao sao rasgadas.
  zonas.push(
    ...reconciliarAnteriores(anteriores, [...zonas], tf.key, ultimaVelaFechada)
  );

  // ---- duas colecoes distintas ----
  // zonasEstado: TODAS as vivas. Sustentam identidade, matching e ciclo
  // de vida. Uma zona que hoje nao esta entre as 3 mais proximas nao
  // pode perder o ID e voltar como zona nova amanha.
  // zonasPublicadas: subconjunto visivel no relatorio/JSON.
  const vivas = zonas.filter((z) => z.status !== "remover");
  // TODAS as vivas. Cortar por score aqui faria uma zona perder ID e
  // historico so por nao estar entre as maiores — a remocao deve vir
  // do ciclo de vida, nunca de um corte silencioso.
  // A marca de dormente nao existe em zona calculada, entao so entra
  // no estado: o relatorio publicado continua com os mesmos campos.
  const estado = vivas.map((z) =>
    z.absorvida ? { ...limparZona(z), absorvida: true } : limparZona(z)
  );

  // Dormente nao e' publicada: a regiao dela ja esta na tela, na zona
  // calculada que a cobre. Publicar as duas seria a mesma regiao duas
  // vezes, que e' o que o descarte antigo queria evitar.
  const publicaveis = vivas.filter(
    (z) => z.score >= ZONA_SCORE_MIN_PUBLICAR && !z.absorvida
  );
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
  const rsi = rsiSeries(closes, tf.rsi.length);
  // Periodos do proprio timeframe: os valores diario e semanal nunca se
  // encontram, porque cada bloco calcula a partir do seu tf.
  const { plusDI, minusDI, adx } = dmiSeries(
    highs, lows, closes, tf.dmi.diLen, tf.dmi.adxLen
  );
  const ema = emaSeries(closes);
  // O ATR ja era calculado la dentro das zonas, para dimensionar a
  // largura delas. Aqui ele e' calculado tambem para ser PUBLICADO: e' a
  // leitura de volatilidade do periodo, e sem ela quem consome o
  // relatorio nao tem como dimensionar distancia de stop nem tamanho de
  // posicao sem refazer a conta por fora.
  const atr = atrSeries(highs, lows, closes);

  const i = closes.length - 1;
  const j = i - 1;

  // --- indicadores PROVISORIOS (incluindo a vela em formacao) ---
  const closesP = closes.concat([live.close]);
  const highsP = highs.concat([live.high]);
  const lowsP = lows.concat([live.low]);
  const rsiP = rsiSeries(closesP, tf.rsi.length);
  const dmiP = dmiSeries(highsP, lowsP, closesP, tf.dmi.diLen, tf.dmi.adxLen);
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
  const pivos = acharPivos(highs, lows, tf.pivos.esq, tf.pivos.dir);
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
      tolAtr: RETEST_TOLERANCIA_ATR,
      resetAtr: RETEST_RESET_ATR,
      atr: atr[i],
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
  const emaAnterior = ema[j];
  // Cruzamento por FECHAMENTO. Sao dois pontos de uma serie que o
  // processo ja tem na memoria: nao ha calculo novo, chamada nova nem
  // estado persistido. O relatorio publicava so ema[i], e sem ema[j]
  // quem le nao conseguia decidir a travessia sem lembrar da execucao
  // anterior -- justamente o que este projeto evita.
  const ladoDe = (c, e) => (e === null ? null : c >= e ? "acima" : "abaixo");
  const ladoAtual = ladoDe(closes[i], emaAtual);
  const ladoAnterior = ladoDe(closes[j], emaAnterior);
  const cruzamentoFechado =
    ladoAtual && ladoAnterior && ladoAtual !== ladoAnterior
      ? ladoAtual
      : "nenhum";
  // A margem anti-ruido de que o prompt depende, medida onde deve ser:
  // entre o FECHAMENTO e a media, nunca com o preco vivo.
  const distEmaAtr =
    emaAtual === null || !(atr[i] > 0)
      ? null
      : Math.abs(closes[i] - emaAtual) / atr[i];
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
  // Mesmo tratamento dado ao DMI: o periodo sai declarado ao lado do
  // valor, e o nome perdeu o "14" -- rsi14_fechado guardando um RSI de
  // 21 seria mentira.
  L.push(`rsi_length: ${tf.rsi.length}`);
  L.push(`rsi_fechado: ${num(rsi[i], 2)}`);
  // Os periodos saem ao lado dos valores: o DMI deixou de ser 14/14 em
  // todo lugar, entao quem le o bloco tem de saber com que configuracao
  // aquele numero foi calculado sem precisar consultar o codigo. Os
  // campos perderam o "14" do nome pelo mesmo motivo -- adx14_fechado
  // guardando um ADX de 42 seria mentira.
  L.push(`dmi_di_length: ${tf.dmi.diLen}`);
  L.push(`dmi_adx_smoothing: ${tf.dmi.adxLen}`);
  L.push(`di_plus_fechado: ${num(plusDI[i], 2)}`);
  L.push(`di_minus_fechado: ${num(minusDI[i], 2)}`);
  L.push(`adx_fechado: ${num(adx[i], 2)}`);
  L.push(`ultimo_fechamento_data: ${fmtDia(times[i])}`);
  L.push(`ultimo_fechamento_close: ${num(closes[i], D)}`);
  // Estes quatro tornam a travessia da EMA89 DETERMINISTICA a partir do
  // relatorio: sem `ema89_fechada_anterior` nao da para saber se houve
  // cruzamento sem depender da memoria de quem le.
  L.push(`ema89_fechada_atual: ${num(emaAtual, D)}`);
  L.push(`ema89_fechada_anterior: ${num(emaAnterior, D)}`);
  L.push(`ema89_cruzamento_fechado: ${cruzamentoFechado}`);
  L.push(`distancia_ema89_fechada_atr: ${num(distEmaAtr, 2)}`);
  // Em unidade de preco E em porcentagem. O percentual e' o que permite
  // comparar volatilidade entre pares e entre epocas -- 0,05 nao diz
  // nada sozinho, 1,2% diz.
  L.push(`atr14: ${num(atr[i], D)}`);
  L.push(
    `atr14_pct: ${
      atr[i] !== null && closes[i] ? num((atr[i] / closes[i]) * 100, 2) : "--"
    }`
  );
  L.push("");
  L.push("# PROVISORIOS: incluem a vela em formacao e PODEM MUDAR ate o");
  L.push(`# fechamento ${tf.key}. NAO sao a referencia principal.`);
  L.push(`rsi_provisorio: ${num(rsiP[k], 2)}`);
  L.push(`di_plus_provisorio: ${num(dmiP.plusDI[k], 2)}`);
  L.push(`di_minus_provisorio: ${num(dmiP.minusDI[k], 2)}`);
  L.push(`adx_provisorio: ${num(dmiP.adx[k], 2)}`);
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
  // Vigilancia da obsolescencia: transforma em dado o que antes dependia
  // de alguem reparar. "obsoleto" quer dizer que o preco esta a mais de
  // 3 ATR da faixa manual mais proxima -- os niveis descreveram outro
  // regime de mercado e precisam de revisao.
  //
  // VELA FECHADA nas duas pontas. A primeira versao passava live.close
  // aqui, o que misturava preco da vela em formacao com ATR de vela
  // fechada: nem provisorio nem confirmado, um hibrido sem significado
  // limpo. E contrariava a convencao do proprio monitor, em que o que
  // alimenta decisao usa vela fechada -- e este campo alimenta uma, a
  // revisao dos niveis manuais.
  //
  // O custo e' uma vela de latencia, irrelevante para um sinal que diz
  // "seus niveis sao de outra era": o caso que motivou a vigilancia
  // levou 19 dias para ser notado.
  const sitNiveis = situacaoNiveis(cfg.niveis, closes[i], atr[i]);
  L.push(`niveis_manuais_situacao: ${sitNiveis.situacao}`);
  L.push(`niveis_manuais_faixa_mais_proxima: ${sitNiveis.faixa || "--"}`);
  L.push(`niveis_manuais_distancia_atr: ${num(sitNiveis.distanciaAtr, 2)}`);
  const alinNiveis = alinhamentoNiveis(cfg.niveis, zonasAutomaticas);
  L.push(`niveis_manuais_alinhamento: ${alinNiveis.situacao}`);
  L.push(
    `niveis_manuais_faixas_corroboradas: ${alinNiveis.corroboradas} de ${alinNiveis.total}`
  );
  const candidatas = zonasCandidatas(zonasAutomaticas, cfg.niveis, closes[i], tf.key);
  L.push(
    `zonas_candidatas_a_faixa: ${
      candidatas.length
        ? candidatas
            .map(
              (c) =>
                `${num(c.inferior, D)}-${num(c.superior, D)} score=${c.score} ` +
                `toques=${c.toques}${c.lado ? ` (${c.lado} do preco)` : ""}`
            )
            .join(" | ")
        : "nenhuma"
    }`
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
  // O relatorio declara o fractal usado, como ja faz com RSI e DMI: o
  // numero muda por timeframe e quem le a estrutura precisa saber em que
  // escala ela foi medida.
  L.push(`pivos_fractal: ${tf.pivos.esq}/${tf.pivos.dir}`);
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

// ------------------------------------------------------------
// HISTORICO: o substrato para medir, um dia, o que este monitor acerta.
//
// Nada aqui muda o relatorio nem dispara alerta. E' so um registro
// append-only do que o monitor PUBLICOU, vela fechada a vela fechada.
//
// Por que ele existe: os alertas nao saem daqui. Quem decide alertar e'
// o agente no ChatGPT, que le o prompt e resolve por conta propria --
// e o monitor nao tem como ver essa decisao. O que o monitor VE, e pode
// registrar com precisao, sao as CONDICOES que ele publicou e o preco
// de cada fechamento. Com isso da' para responder depois a pergunta que
// interessa: cada condicao foi seguida de que movimento? Sem esse
// registro, qualquer ajuste de limiar continua sendo chute, porque
// nenhum parametro deste projeto foi medido contra resultado.
//
// Uma entrada por (par, timeframe) sempre que a VELA FECHADA muda ou
// qualquer condicao muda. Rodadas de hora em hora sobre a mesma vela
// fechada nao repetem linha: a assinatura filtra.
export function entradaHistorico(par, tfKey, bloco, agora) {
  if (!bloco || bloco.falha) return null;
  const lista = (x) => (Array.isArray(x) ? x : []);
  const fech = bloco.ultimo_fechamento_close;
  const ema = bloco.ema89_fechada_atual;
  return {
    em: agora,
    par,
    tf: tfKey,
    vela: bloco.ultimo_fechamento_data || null,
    fech: typeof fech === "number" ? fech : null,
    atr: typeof bloco.atr14 === "number" ? bloco.atr14 : null,
    rsi: bloco.rsi_fechado,
    adx: bloco.adx_fechado,
    di: [bloco.di_plus_fechado, bloco.di_minus_fechado],
    estrutura: bloco.estrutura_tendencia || null,
    rotulo: bloco.estrutura_preco || null,
    ema89_lado:
      typeof fech === "number" && typeof ema === "number"
        ? fech >= ema
          ? "acima"
          : "abaixo"
        : null,
    ema89_cruz: bloco.ema89_cruzamento_fechado || null,
    ema89_dist_atr: bloco.distancia_ema89_fechada_atr,
    alertas: lista(bloco.alertas_tecnicos),
    deterioracao: lista(bloco.deterioracao_tendencia),
    conf_entrada: lista(bloco.confluencia_entrada),
    conf_pullback: lista(bloco.confluencia_pullback),
    riscos: lista(bloco.riscos_tecnicos),
    niveis_mud: lista(bloco.niveis_mudancas_nesta_vela),
    niveis_sit: bloco.niveis_manuais_situacao || null,
    niveis_alin: bloco.niveis_manuais_alinhamento || null,
  };
}

// A assinatura NAO inclui "em": e' o que distingue uma condicao nova de
// uma reexecucao sobre a mesma vela. Inclui a vela fechada, entao todo
// fechamento gera linha mesmo sem nenhuma condicao -- e' dessa serie de
// precos que sairao os retornos futuros da analise.
export function assinaturaHistorico(e) {
  return [
    e.vela,
    e.estrutura,
    e.ema89_cruz,
    e.ema89_lado,
    e.alertas.join("|"),
    e.deterioracao.join("|"),
    e.conf_entrada.join("|"),
    e.conf_pullback.join("|"),
    e.riscos.join("|"),
    e.niveis_mud.join("|"),
    e.niveis_sit,
    e.niveis_alin,
  ].join("~");
}

export function registrarHistorico(dadosJSON, assinaturasAnt = {}, agora = new Date().toISOString()) {
  const entradas = [];
  const assinaturas = { ...assinaturasAnt };
  for (const tf of TIMEFRAMES) {
    const porPar = (dadosJSON && dadosJSON[tf.key]) || {};
    for (const par of Object.keys(porPar)) {
      const e = entradaHistorico(par, tf.key, porPar[par], agora);
      if (!e) continue;
      const chave = `${par}|${tf.key}`;
      const assin = assinaturaHistorico(e);
      if (assinaturas[chave] === assin) continue;
      assinaturas[chave] = assin;
      entradas.push(e);
    }
  }
  return { entradas, assinaturas };
}

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
  // Derivado de TIMEFRAMES para o cabecalho nao poder divergir da
  // configuracao de verdade.
  const porTf = (f) => TIMEFRAMES.map((t) => `${t.key} ${f(t)}`).join(", ");
  blocks.push(
    `indicadores: RSI e DMI/ADX por Wilder/RMA com periodos por timeframe ` +
      `(RSI ${porTf((t) => t.rsi.length)}; DMI/ADX ${porTf((t) => `${t.dmi.diLen}/${t.dmi.adxLen}`)}), ` +
      `EMA(89) exponencial`
  );
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
  // Casas decimais do par de CAMBIO, buscadas pela chave: o trilho
  // compara o USDT contra o dolar, e a posicao do par no array e
  // ordem de apresentacao, nao identidade.
  const decCambio = (PAIRS.find((c) => c.key === "usd") || { dec: 4 }).dec;
  for (const l of blocoTrilho(trilho, usdDiario, decCambio)) blocks.push(l);
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

const TITULO_PAGINA = "Monitor USD/BRL";

// ------------------------------------------------------------
// Pagina publicada (docs/index.html)
//
// A REGRA QUE MANDA AQUI: o relatorio inteiro sai VERBATIM dentro de um
// unico <pre>, texto puro, sem uma tag no meio e com o mesmo escape de
// sempre (& e <, nada mais). O prompt usa esta pagina como FALLBACK
// quando o relatorio.json nao responde, e quem le procura linhas
// "campo: valor" no fonte -- qualquer <span> ali dentro quebraria isso.
// Tema, cartoes e graficos sao moldura em volta desse bloco: se o CSS
// nao carregar e o TradingView estiver fora do ar, o dado continua
// inteiro e legivel.
//
// Os cartoes NAO reparseiam o texto. Eles leem o objeto de
// relatorioParaJSON -- o mesmo que vira docs/relatorio.json, gerado uma
// vez so e passado para os dois. Dois leitores do mesmo objeto nao tem
// como discordar.
// ------------------------------------------------------------

// ------------------------------------------------------------
// SUPERFICIE DO GRAFICO
//
// O embed do TradingView pinta a propria moldura -- barra do simbolo,
// eixo de preco, eixo de tempo -- no cinza escuro neutro do tema dele,
// que NAO e' o azul-noite do resto da pagina. Ficavam tres cores
// empilhadas: o degrade do cartao, a faixa dos botoes por cima dele, e
// o embed. Tres tons de escuro em sequencia leem como defeito de
// renderizacao, nao como desenho.
//
// Entao a faixa e o container adotam a cor do EMBED, e nao a do cartao.
// Os botoes nao marcados sao transparentes, entao vao junto; o marcado
// continua azul, que e' o unico jeito de saber qual esta valendo.
//
// A COR VEIO DE CONTA-GOTAS NA TELA, e nao de deducao. Duas tentativas
// erraram por deduzir da paleta CLASSICA do TradingView: #131722, o
// fundo do grafico, mexeu so (3, -1, -7) no pixel pintado e foi
// invisivel; #1e222d, a barra de ferramentas, ficou claro demais. O
// widget que carrega hoje usa o tema escuro NOVO, quase preto e neutro,
// que nao esta naquela paleta. Cor de terceiro se mede, nao se deduz.
//
// O TEMA CLARO tinha o MESMO erro, e passou despercebido mais tempo: a
// faixa ficou em #f1f3f6, a barra de ferramentas da paleta classica.
// Nao era so isso -- as nossas duas superficies ja discordavam entre
// si, porque o widget recebia #ffffff como fundo do grafico enquanto a
// faixa era pintada de cinza ao lado dele. Medido, o embed claro e'
// branco puro.
//
// Os dois tokens seguem separados de proposito, mesmo valendo o mesmo
// nos dois temas hoje: barra e grafico sao superficies diferentes do
// widget e ja foram pintadas em cores diferentes na paleta anterior
// dele. Se voltarem a divergir, muda um token e nao a regra.
//
// UM lugar so: o CSS e as opcoes do widget saem daqui. Duas copias do
// mesmo hex divergem no dia em que alguem mexe numa e esquece da outra.
const TV_FUNDO = { noite: "#0f0f0f", claro: "#ffffff" };
const TV_BARRA = { noite: "#0f0f0f", claro: "#ffffff" };

const PAGINA_CSS = `
/* Tema NOITE e' o padrao. O claro so redefine tokens -- nenhuma regra
   de layout aparece duas vezes, entao os dois temas nao tem como
   divergir de estrutura, so de cor. */
:root{
  color-scheme:dark;
  --bg:#070a12; --painel:#0e1524; --painel2:#111a2c; --linha:#1b2740;
  --txt:#c5d1e6; --txt-forte:#e6edf8; --fraco:#6f7f9b;
  --azul:#5aa9ff; --acento:#8ec6ff;
  --chip-bg:rgba(90,169,255,.08); --chip-borda:#1d3a5f; --chip-txt:#8ec6ff;
  --risco-bg:rgba(248,81,73,.09); --risco-borda:rgba(248,81,73,.30); --risco-txt:#ff8b84;
  --alta:#3fb950; --baixa:#f85149; --atencao:#d29922;
  --pre-txt:#9fbde0; --sombra:none;
  --tv-fundo:${TV_FUNDO.noite}; --tv-barra:${TV_BARRA.noite}; --tv-linha:#2a2e39;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
html[data-tema="claro"]{
  color-scheme:light;
  --bg:#eef2f8; --painel:#ffffff; --painel2:#f7f9fd; --linha:#d5dfed;
  --txt:#1b2534; --txt-forte:#0a1220; --fraco:#5a6b85;
  --azul:#1560c0; --acento:#0d4a94;
  --chip-bg:rgba(21,96,192,.07); --chip-borda:#bcd4f0; --chip-txt:#0d4a94;
  --risco-bg:rgba(192,54,44,.07); --risco-borda:rgba(192,54,44,.28); --risco-txt:#a3271f;
  --alta:#12783a; --baixa:#c0362c; --atencao:#8a5d00;
  --pre-txt:#22364f; --sombra:0 1px 2px rgba(16,32,56,.06);
  --tv-fundo:${TV_FUNDO.claro}; --tv-barra:${TV_BARRA.claro}; --tv-linha:#d5dfed;
}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--azul);text-decoration:none}
a:hover{text-decoration:underline}
.pagina{max-width:1120px;margin:0 auto;padding:28px 18px 72px}
.topo{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;
  padding-bottom:18px;margin-bottom:26px;border-bottom:1px solid var(--linha)}
.topo h1{margin:0;font-size:20px;font-weight:600;color:var(--txt-forte);letter-spacing:.02em}
.topo h1 b{color:var(--azul);font-weight:600}
.carimbo{display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  font:12px/1.5 var(--mono);color:var(--fraco)}
.idade{padding:2px 9px;border-radius:999px;border:1px solid var(--linha)}
.idade.ok{color:var(--alta);border-color:var(--alta)}
.idade.aviso{color:var(--atencao);border-color:var(--atencao)}
.idade.velho{color:var(--baixa);border-color:var(--baixa)}
.btn-tema{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
  width:34px;height:34px;padding:0;border-radius:50%;
  background:var(--painel);border:1px solid var(--linha);color:var(--fraco);
  box-shadow:var(--sombra)}
.btn-tema:hover{color:var(--acento);border-color:var(--acento)}
.btn-tema:focus-visible{outline:2px solid var(--azul);outline-offset:2px}
/* Os dois icones ficam no HTML e quem escolhe e' o CSS, pelo data-tema
   do <html> -- que o script do topo ja pos antes de qualquer pintura.
   Antes isso vinha do aria-pressed, que so e' corrigido por JS no fim
   do body: com o padrao deixando de ser sempre noite, daria para ver o
   icone errado por um instante. O aria-pressed continua existindo para
   leitor de tela, agora sem papel visual. */
.btn-tema svg{width:16px;height:16px;display:none}
.btn-tema .lua{display:block}
html[data-tema="claro"] .btn-tema .lua{display:none}
html[data-tema="claro"] .btn-tema .sol{display:block}
.pares{display:grid;gap:22px;margin-bottom:34px}
.par{background:linear-gradient(180deg,var(--painel2),var(--painel));
  border:1px solid var(--linha);border-radius:14px;overflow:hidden;box-shadow:var(--sombra)}
.par>header{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;
  justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--linha)}
.par h2{margin:0;font:600 15px/1 var(--mono);letter-spacing:.05em;color:var(--acento)}
.preco{font:600 24px/1 var(--mono);color:var(--txt-forte)}
.tfs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--linha)}
.tf{background:var(--painel);padding:16px 18px}
.tf h3{margin:0 0 13px;font:600 11px/1 var(--mono);letter-spacing:.14em;
  text-transform:uppercase;color:var(--fraco)}
dl{margin:0;display:grid;gap:8px}
.m{display:flex;justify-content:space-between;gap:14px;align-items:baseline}
.m dt{color:var(--fraco);font-size:13px;white-space:nowrap}
.m dd{margin:0;font:13px/1.4 var(--mono);color:var(--txt);text-align:right}
.m dd small{color:var(--fraco);font-size:11px;margin-left:6px}
.m dd.alta{color:var(--alta)}
.m dd.baixa{color:var(--baixa)}
.m dd.atencao{color:var(--atencao)}
.m dd.evento{color:var(--acento);font-weight:600}
.m dd.fraco{color:var(--fraco)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px;
  padding-top:13px;border-top:1px dashed var(--linha)}
.chip{font:11px/1 var(--mono);padding:5px 9px;border-radius:6px;
  background:var(--chip-bg);border:1px solid var(--chip-borda);color:var(--chip-txt)}
.chip.risco{background:var(--risco-bg);border-color:var(--risco-borda);color:var(--risco-txt)}
.chip.vazio{background:none;border-color:var(--linha);color:var(--fraco)}
.falha{margin:0;font:13px/1.5 var(--mono);color:var(--baixa)}
.sel-par{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.sel-par button{font:11px/1 var(--mono);padding:7px 13px;border-radius:6px;
  cursor:pointer;background:none;border:1px solid var(--linha);color:var(--fraco)}
.sel-par button[aria-pressed="true"]{background:var(--chip-bg);
  border-color:var(--chip-borda);color:var(--chip-txt)}
/* Sem JS nada fica escondido: a classe so e' aplicada pelo script. */
.oculto{display:none}
.leituras{margin:0 0 22px}
.leituras h2{margin:0 0 12px;font:600 11px/1 var(--mono);letter-spacing:.14em;
  text-transform:uppercase;color:var(--fraco)}
.leitura{padding:12px 16px;border:1px solid var(--linha);border-radius:12px;
  background:var(--painel);margin-bottom:8px}
.leitura .lp{display:block;font:600 13px/1.3 var(--mono);color:var(--txt-forte);
  margin-bottom:4px}
.lh{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;margin-top:7px;
  position:relative}
.lh + .lh{border-top:1px solid var(--linha);margin-top:9px;padding-top:9px}
.lh .lt{font:11px/1.3 var(--mono);color:var(--fraco);min-width:38px}
.lh .lr{font:600 13px/1.3 var(--mono);color:var(--fraco)}
.lh .lz{font:11px/1.5 var(--mono);color:var(--fraco);flex:1 1 100%}
.leitura .lradar{display:block;margin-top:9px;font:11px/1.5 var(--mono);
  color:var(--atencao)}
/* O (?) fica discreto ate alguem procurar por ele: a linha e' para
   ser lida de relance, e um circulo forte ao lado de cada rotulo
   competiria com o proprio rotulo. Abre no hover E no foco -- o
   foco e' o que faz funcionar no toque e no teclado. */
.lh .aj{display:inline-flex;align-items:center;justify-content:center;
  align-self:center;width:15px;height:15px;padding:0;border-radius:50%;
  cursor:help;font:700 10px/1 var(--mono);background:none;
  border:1px solid var(--linha);color:var(--fraco);position:relative}
/* Alvo de toque de 26px sem engordar o circulo: 15px e' confortavel
   no mouse e apertado no dedo. O quadrado invisivel so amplia a area
   clicavel, e nao muda o desenho nem o espaco ocupado na linha. */
.lh .aj::after{content:"";position:absolute;left:50%;top:50%;
  width:26px;height:26px;transform:translate(-50%,-50%)}
.lh .aj:hover{color:var(--acento);border-color:var(--acento)}
.lh .aj:focus-visible{outline:2px solid var(--azul);outline-offset:2px}
/* Ancorado na LINHA e nao no botao: assim a caixa ocupa a largura
   toda e o texto nunca vaza para fora da tela no celular. */
.lh .ajt{display:none;position:absolute;left:0;right:0;top:100%;z-index:5;
  margin-top:6px;padding:10px 12px;border-radius:8px;background:var(--painel2);
  border:1px solid var(--linha);box-shadow:var(--sombra);
  font:11px/1.6 var(--mono);color:var(--txt);text-align:left}
.lh .aj:hover + .ajt,.lh .aj:focus + .ajt{display:block}
.lh.acumular .lr{color:var(--alta)}
.lh.esticado .lr{color:var(--baixa)}
.lh.atencao .lr{color:var(--atencao)}
.leituras .nota{margin:10px 2px 0;font:11px/1.6 var(--mono);color:var(--fraco)}
.grafico{border-top:1px solid var(--linha)}
.tv-barra{display:flex;gap:6px;padding:10px 18px;background:var(--tv-barra);
  border-bottom:1px solid var(--tv-linha)}
.tv-tf{font:11px/1 var(--mono);padding:6px 11px;border-radius:6px;cursor:pointer;
  background:none;border:1px solid var(--tv-linha);color:var(--fraco)}
.tv-tf[aria-pressed="true"]{background:var(--chip-bg);border-color:var(--chip-borda);
  color:var(--chip-txt)}
.tv{height:460px;background:var(--tv-fundo);display:flex;align-items:center;
  justify-content:center}
.tv .tv-off{padding:24px;text-align:center;font-size:13px;color:var(--fraco)}
.grafico>p{margin:0;padding:11px 18px;border-top:1px solid var(--linha);
  font:11px/1.5 var(--mono);color:var(--fraco)}
.relatorio h2{margin:0 0 12px;font:600 11px/1 var(--mono);letter-spacing:.14em;
  text-transform:uppercase;color:var(--fraco)}
.relatorio pre{margin:0;padding:20px;border:1px solid var(--linha);border-radius:14px;
  background:var(--painel);color:var(--pre-txt);font:13px/1.65 var(--mono);
  white-space:pre-wrap;word-break:break-word;box-shadow:var(--sombra)}
.rodape{margin-top:26px;font:11px/1.7 var(--mono);color:var(--fraco)}
@media(max-width:640px){
  .tfs{grid-template-columns:1fr}
  .tv{height:340px}
  .preco{font-size:20px}
}
`;

function pgEsc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Milhar com ponto e decimal com virgula, na mao. toLocaleString
// dependeria do ICU do runner; isto nao depende de nada.
function pgNum(v, dec) {
  if (typeof v !== "number" || !isFinite(v)) return "--";
  const [inteiro, frac] = v.toFixed(dec).split(".");
  const mil = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${mil},${frac}` : mil;
}

function pgLinha(rotulo, valor, classe) {
  return `<div class="m"><dt>${pgEsc(rotulo)}</dt><dd class="${classe || ""}">${valor}</dd></div>`;
}

// Um item aparece UMA vez. alertas_tecnicos e deterioracao_tendencia se
// sobrepoem de proposito -- a segunda e' sintese da primeira --, e
// pintar a mesma string duas vezes em duas cores so confunde. Quem
// esta nas duas sai como risco; quem so esta na sintese entra depois.
function pgChips(alertas, deterioracao) {
  const det = new Set(deterioracao || []);
  const vistos = new Set();
  const out = [];
  for (const x of alertas || []) {
    if (vistos.has(x)) continue;
    vistos.add(x);
    out.push(`<span class="chip${det.has(x) ? " risco" : ""}">${pgEsc(x)}</span>`);
  }
  for (const x of det) {
    if (vistos.has(x)) continue;
    vistos.add(x);
    out.push(`<span class="chip risco">${pgEsc(x)}</span>`);
  }
  if (!out.length) return `<span class="chip vazio">nenhum</span>`;
  return out.join("");
}

function pgTimeframe(titulo, b, dec) {
  if (!b) return `<div class="tf"><h3>${pgEsc(titulo)}</h3><p class="falha">sem bloco</p></div>`;
  if (b.falha)
    return `<div class="tf"><h3>${pgEsc(titulo)}</h3><p class="falha">FALHA: ${pgEsc(b.falha)}</p></div>`;

  // Lado da EMA89 pelo FECHAMENTO, nunca por posicao_vs_ema89 -- aquele
  // campo compara a media fechada com o preco VIVO e muda durante o dia.
  // E' a mesma comparacao que o prompt manda o agente fazer.
  const fech = b.ultimo_fechamento_close;
  const ema = b.ema89_fechada_atual;
  const acima = typeof fech === "number" && typeof ema === "number" ? fech >= ema : null;
  const cruz = b.ema89_cruzamento_fechado;
  // Distancia em PORCENTAGEM no cartao, nao em ATR. Denominador e' a
  // propria EMA, a mesma convencao do distancia_ema89_pct que o
  // relatorio ja publica -- so que aqui com o FECHAMENTO no lugar do
  // preco vivo, para o cartao nao voltar a misturar vela fechada com
  // vela em formacao.
  //
  // Isto e' APRESENTACAO. O relatorio continua publicando
  // distancia_ema89_fechada_atr, e o prompt continua decidindo por ela:
  // 0,25 ATR de margem para a travessia semanal, 1,0 ATR para a
  // corroboracao da perda diaria. ATR e' a unidade certa para comparar
  // pares de volatilidades diferentes; a porcentagem e' a que se le de
  // relance.
  const distPct =
    acima === null || !ema ? null : ((fech - ema) / ema) * 100;
  const emaTxt =
    acima === null
      ? "--"
      : `${acima ? "acima" : "abaixo"}<small>${pgNum(Math.abs(distPct), 2)}%</small>`;

  const tend = b.estrutura_tendencia || "--";
  const sit = b.niveis_manuais_situacao || "--";
  const rsi = b.rsi_fechado;
  const diPlus = b.di_plus_fechado;
  const diMinus = b.di_minus_fechado;

  const L = [];
  L.push(pgLinha("Último fechamento",
    `${pgNum(fech, dec)}<small>${pgEsc(b.ultimo_fechamento_data || "")}</small>`));
  L.push(pgLinha("EMA89 (fechado)", emaTxt, acima === null ? "" : acima ? "alta" : "baixa"));
  if (cruz && cruz !== "nenhum")
    L.push(pgLinha("Cruzou a EMA89", `${pgEsc(cruz)} no fechamento`, "evento"));
  L.push(pgLinha(`RSI(${b.rsi_length || 14})`, pgNum(rsi, 1),
    typeof rsi === "number" && (rsi >= 70 || rsi <= 30) ? "atencao" : ""));
  // Rotulo com os periodos DAQUELE bloco: diario e semanal usam
  // configuracoes diferentes e o cartao mostra os dois lado a lado.
  const dmiCfg =
    b.dmi_di_length && b.dmi_adx_smoothing
      ? ` (${b.dmi_di_length}/${b.dmi_adx_smoothing})`
      : "";
  L.push(pgLinha(`ADX / DI${dmiCfg}`,
    `${pgNum(b.adx_fechado, 1)}<small>+${pgNum(diPlus, 1)} / −${pgNum(diMinus, 1)}</small>`,
    typeof diPlus === "number" && typeof diMinus === "number"
      ? (diPlus > diMinus ? "alta" : "baixa")
      : ""));
  L.push(pgLinha("Estrutura", pgEsc(tend),
    tend === "alta" ? "alta" : tend === "baixa" ? "baixa" : "fraco"));
  L.push(pgLinha("Níveis manuais",
    `${pgEsc(sit)}<small>${pgEsc(b.niveis_manuais_faixa_mais_proxima || "")}</small>`,
    sit === "atual" ? "alta" : sit === "monitorar" ? "atencao" : sit === "obsoleto" ? "baixa" : "fraco"));
  // ATR NAO APARECE NO CARTAO. Ele continua sendo calculado e usado --
  // dimensiona a largura das zonas automaticas, mede a obsolescencia dos
  // niveis manuais e e' a unidade das margens do prompt (0,25 ATR na
  // travessia semanal, 1,0 ATR na corroboracao da perda diaria) --, e
  // continua publicado em atr14 e atr14_pct no relatorio. So nao ocupa
  // linha no resumo: e' unidade de calculo, nao leitura de relance.

  return (
    `<div class="tf"><h3>${pgEsc(titulo)}</h3><dl>${L.join("")}</dl>` +
    `<div class="chips">${pgChips(b.alertas_tecnicos, b.deterioracao_tendencia)}</div>` +
    `</div>`
  );
}

// ------------------------------------------------------------
// LEITURA DE CONTEXTO LONGO
//
// Uma linha em portugues no topo da pagina, para quem acumula e as
// vezes gasta, e nao opera. O relatorio tem 102 campos por bloco; esta
// leitura usa CINCO, todos do bloco SEMANAL, e mostra os numeros que a
// produziram para poder ser conferida sem ler o resto.
//
// Ela DESCREVE onde o preco esta em relacao a propria media longa. Nao
// e' recomendacao, nao e' gatilho e nao vira alerta: e' contexto de
// enquadramento, do tipo que muda de estado poucas vezes por ano.
//
// Nenhuma regra nova de mercado nasce aqui. Os cortes sao os que o
// projeto ja usa em outros lugares: 1 ATR separa "perto" de "longe" na
// obsolescencia dos niveis, e 70/30 e' o par de referencia do RSI em
// todo o prompt.
// Forca e direcao da tendencia, a partir do DMI/ADX. RSI e DMI dizem
// coisas diferentes e a leitura longa so olhava o RSI: "RSI alto"
// significa que subiu bastante, nao que a alta esta viva. Para decidir
// entre comprar mais e converter, quem manda e' a segunda pergunta.
//
// O corte de 25 nao e' novo: e' o mesmo que a linha de eventos ja usa
// para dizer que a tendencia ganhou ou perdeu forca.
const ADX_FORTE = 25;

// ------------------------------------------------------------
// RADAR DE PROMOCAO: zonas que amadureceram e nenhuma faixa cobre.
//
// As zonas automaticas sao CONTEXTO: nao alimentam a maquina de
// rompimento/reteste, nao entram na linha de gatilhos e nao geram
// alerta de entrada em faixa. Isso tudo roda so sobre os niveis
// manuais. Entao uma regiao que o mercado passou a respeitar fica sem
// maquina de estados ate alguem promove-la a faixa manual -- e zonas
// expiram (30 velas sem toque enfraquece, mais 15 remove), enquanto
// faixas manuais nao.
//
// Este radar existe para essa promocao nao depender de alguem reparar
// nela. Nao e' alerta de mercado: e' manutencao de configuracao.
const CANDIDATA_SCORE_MIN = 70;
const CANDIDATA_TOQUES_MIN = 5;

export function zonasCandidatas(zonas, niveis, precoRef, tfKey) {
  // SO no diario. No semanal a estrutura fica num patamar diferente e um
  // unico conjunto de faixas serve aos dois timeframes: promover zona
  // semanal quebraria o alinhamento diario, que e' o operacional.
  // Sinalizar la seria ruido permanente e inacionavel.
  if (tfKey !== "diario") return [];
  const faixas = (niveis && niveis.faixas) || [];
  const out = [];
  for (const z of zonas || []) {
    const L = z.limites_operacionais;
    if (!L) continue;
    if ((z.score || 0) < CANDIDATA_SCORE_MIN) continue;
    if ((z.numero_toques || 0) < CANDIDATA_TOQUES_MIN) continue;
    const coberta = faixas.some(
      ([lo, hi]) =>
        sobreposicaoFrac({ inferior: lo, superior: hi }, L) >=
        CONFLUENCIA_SOBREPOSICAO_MIN
    );
    if (coberta) continue;
    out.push({
      inferior: L.inferior,
      superior: L.superior,
      score: z.score,
      toques: z.numero_toques,
      lado:
        typeof precoRef === "number"
          ? L.inferior > precoRef
            ? "acima"
            : L.superior < precoRef
            ? "abaixo"
            : "no preco"
          : null,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

// Casas decimais suficientes para o valor, sem zeros a toa: 76000 sai
// inteiro, 0,00656 sai com cinco casas, 5,12 com duas. Limitado pelo dec
// do par, para nao inventar precisao que a fonte nao tem.
function casasUteis(v, dec) {
  const t = String(v);
  const i = t.indexOf(".");
  return Math.min(i < 0 ? 0 : t.length - i - 1, dec);
}

// Valor formatado para o olho humano, com as casas que ele precisa.
function pgValor(v, dec) {
  return pgNum(v, casasUteis(v, dec));
}

// Onde o preco esta em relacao as FAIXAS MANUAIS -- as que o dono do
// monitor marcou a mao. A lista de prioridade do prompt poe "preco,
// estrutura e niveis relevantes" em PRIMEIRO lugar e "DMI/ADX + RSI" em
// quinto, e a faixa de contexto longo nascia apoiada no 3 e no 5,
// pulando o 1. Estar dentro de uma faixa e' o fato mais decisivo da
// tela para quem escolhe entre comprar mais e converter.
//
// Sai em palavras, sem jargao, e diz "faixa manual" porque e' o termo
// que o resto do projeto usa: niveis escolhidos a mao, nao calculados.
//
// `faixa` e' o objeto {label, inferior, superior} da faixa mais proxima.
// Nomear os limites aqui evita o vaivem que existia: a frase afirmava
// algo sobre uma faixa sem dizer qual, e quem lia tinha de procurar o
// rotulo no cartao -- e ainda lembrar que esta leitura sai do bloco
// SEMANAL, nao do diario. Agora a linha se basta.
export function ondeNosNiveis(situacao, distAtr, faixa, alinhamento, dec = 2) {
  if (!situacao || situacao === "indefinida") return null;
  const label = faixa && typeof faixa === "object" ? faixa.label : faixa;
  const ehSuporte = typeof label === "string" && /suporte/.test(label);
  const lo = faixa && typeof faixa === "object" ? faixa.inferior : null;
  const hi = faixa && typeof faixa === "object" ? faixa.superior : null;
  const temLimites = typeof lo === "number" && typeof hi === "number";
  const d = temLimites ? Math.max(casasUteis(lo, dec), casasUteis(hi, dec)) : 0;
  const intervalo = temLimites ? ` de ${pgNum(lo, d)} a ${pgNum(hi, d)}` : "";
  let texto;
  if (situacao === "obsoleto") {
    // Longe de todas, nomear uma nao ajuda.
    texto = "longe das faixas manuais";
  } else if (typeof distAtr === "number" && distAtr <= 0) {
    texto = ehSuporte
      ? `dentro da região de suporte manual${intervalo}`
      : `dentro da faixa manual${intervalo}`;
  } else if (situacao === "atual") {
    texto = `encostando na faixa manual${intervalo}`;
  } else {
    texto = `perto da faixa manual${intervalo}`;
  }
  // Uma faixa que as zonas observadas nao corroboram e' um numero velho.
  // Cita-la no lugar de destaque sem dizer isso seria dar peso a um
  // nivel que o mercado nao vem respeitando.
  if (alinhamento === "desalinhado" && situacao !== "obsoleto") {
    texto += " (que o mercado não vem respeitando)";
  }
  return texto;
}

export function forcaTendencia(dp, dm, adx) {
  if (typeof dp !== "number" || typeof dm !== "number") return null;
  const dominante = dp > dm ? "alta" : "baixa";
  const forte = typeof adx === "number" && adx >= ADX_FORTE;
  return { dominante, forte };
}

export function leituraLonga(sem, dec = 2) {
  const nada = {
    classe: "neutro", rotulo: "sem leitura", razao: "bloco semanal indisponível",
    chave: "sem_leitura",
  };
  if (!sem || sem.falha) return nada;
  const fech = sem.ultimo_fechamento_close;
  const ema = sem.ema89_fechada_atual;
  const dist = sem.distancia_ema89_fechada_atr;
  const rsi = sem.rsi_fechado;
  const estrutura = sem.estrutura_tendencia;
  const forca = forcaTendencia(sem.di_plus_fechado, sem.di_minus_fechado, sem.adx_fechado);
  const labelFaixa = sem.niveis_manuais_faixa_mais_proxima;
  const faixaObj =
    (((sem.niveis_manuais || {}).faixas) || []).find((f) => f.label === labelFaixa) ||
    (labelFaixa ? { label: labelFaixa } : null);
  const niveis = ondeNosNiveis(
    sem.niveis_manuais_situacao,
    sem.niveis_manuais_distancia_atr,
    faixaObj,
    sem.niveis_manuais_alinhamento,
    dec
  );
  if (typeof fech !== "number" || typeof ema !== "number" || typeof dist !== "number") return nada;

  const abaixo = fech < ema;

  // LONGE e' 1 ATR, o mesmo corte que o monitor ja usa para separar
  // perto de longe na obsolescencia dos niveis. Sem esse piso, estar
  // 0,15 ATR abaixo da media -- ou seja, EM CIMA dela -- seria anunciado
  // como "barato", que e' falso e e' o tipo de exagero que faz alguem
  // parar de confiar no painel.
  const LONGE_ATR = 1;
  const longe = dist >= LONGE_ATR;

  // A RAZAO NAO USA JARGAO. Quem le esta linha nao sabe o que e' ATR, e
  // um numero em unidade que a pessoa nao entende nao deixa a leitura
  // conferivel -- que era a unica razao de existir da razao.
  //
  // A distancia sai em PORCENTAGEM, que qualquer um entende, e a regra
  // dos 1 ATR vira a palavra "bem" (bem acima / bem abaixo) contra
  // "perto". Assim a palavra carrega o criterio e o numero carrega o
  // tamanho, sem precisar explicar a unidade.
  //
  // O ATR continua sendo o que decide, internamente, e continua inteiro
  // no relatorio para quem consome os campos: aqui ele so nao aparece.
  const pct = ((fech - ema) / ema) * 100;
  // pgNum e nao num: esta linha e' para o olho humano, entao virgula
  // decimal. O relatorio continua com ponto, para quem parseia.
  const quanto = `${pct >= 0 ? "+" : "−"}${pgNum(Math.abs(pct), 1)}%`;
  const forcaRsi =
    typeof rsi !== "number"
      ? null
      : rsi >= 70
      ? "momentum esticado"
      : rsi <= 30
      ? "momentum muito fraco"
      : "momentum normal";
  const onde = longe
    ? `bem ${abaixo ? "abaixo" : "acima"} da média longa (${quanto})`
    : `perto da média longa (${quanto})`;
  // "alta ainda forte" e "alta perdendo força" e' o que o DMI acrescenta,
  // e e' informacao que o RSI nao tem: subiu muito com a compra mandando
  // e' diferente de subiu muito com o movimento morrendo.
  // Abaixo do corte de forca NAO existe tendencia instalada, entao
  // nomear uma direcao ali seria inventar. "Alta perdendo forca" com ADX
  // em 14 e' falso: nao ha alta nenhuma para perder forca.
  const comoVai = !forca
    ? null
    : forca.forte
    ? `${forca.dominante === "alta" ? "alta" : "queda"} ainda forte`
    : "sem tendência firme";
  // Ordem da lista de prioridade do prompt: niveis primeiro, media
  // longa depois, e os indicadores por ultimo.
  const razao = [niveis, onde, forcaRsi, comoVai].filter(Boolean).join(", ");

  if (!longe) {
    return { classe: "neutro", rotulo: "na média longa", razao, chave: "na_media" };
  }
  // ABAIXO da media longa. Barato e barato-ainda-caindo sao coisas
  // diferentes, e juntar as duas seria mentira. Duas coisas denunciam a
  // queda viva: a estrutura semanal ja em baixa, que e' lenta porque
  // depende de pivos, e o DMI com a venda mandando e ADX forte, que
  // responde antes. Qualquer uma das duas basta.
  if (abaixo) {
    const caindo =
      estrutura === "baixa" || (forca && forca.dominante === "baixa" && forca.forte);
    // Sem queda instalada o rotulo volta a ser o simples: estar abaixo da
    // media nao implica que houve queda recente a ceder.
    return caindo
      ? { classe: "atencao", rotulo: "barato, mas ainda caindo", razao, chave: "barato_caindo" }
      : { classe: "acumular", rotulo: "barato ante a média longa", razao, chave: "barato" };
  }
  // ACIMA e longe, sem esticamento: alta saudavel e' o estado normal de
  // uma tendencia, e nao vira alarme.
  if (!(typeof rsi === "number" && rsi >= 70)) {
    return {
      classe: "neutro", rotulo: "acima da média, sem esticamento", razao,
      chave: "acima_normal",
    };
  }
  // ACIMA, longe e esticado. Aqui o RSI sozinho juntava duas situacoes
  // opostas: subiu muito E a compra ainda manda (converter agora costuma
  // ser cedo) contra subiu muito E o movimento esta morrendo (e' onde a
  // janela costuma estar). Quem separa as duas e' o DMI, nao o RSI.
  const altaViva = forca && forca.dominante === "alta" && forca.forte;
  return altaViva
    ? {
        classe: "atencao", rotulo: "esticado, mas a alta ainda tem força", razao,
        chave: "esticado_com_forca",
      }
    : {
        classe: "esticado", rotulo: "esticado e a alta perdendo força", razao,
        chave: "esticado_sem_forca",
      };
}

// ------------------------------------------------------------
// LEITURA DE CONTEXTO CURTO (diario)
//
// A leitura longa diz ONDE o preco esta. Esta diz o que esta
// ACONTECENDO agora no timeframe que o projeto usa para timing.
//
// O diario nao e' day trade: RSI 21, DMI 28/42, pivos 5/5 e janela de
// reteste de 30 velas, tudo calibrado para o horizonte tatico de 1 a 6
// semanas. Nada aqui usa a vela em formacao.
//
// O nucleo e' a MAQUINA DE ROMPIMENTO E RETESTE, que roda so sobre os
// niveis manuais e e' a prioridade 2 da lista do prompt. E' a sequencia
// que mais importa para decidir uma entrada: rompeu, voltou, segurou.
//
// A cor diz "vale olhar", NAO diz "e' bom" nem "e' ruim". Um reteste
// confirmado de resistencia rompida para cima e um de suporte perdido
// para baixo tem o mesmo nome e significados opostos, e inventar a
// direcao aqui seria palpite disfarcado de leitura.
const ESTADOS_CURTO = [
  ["reteste_confirmado", "reteste confirmado"],
  ["em_reteste", "reteste em curso"],
  ["rompimento_falhou", "rompimento falhou"],
  ["recuperado", "nível recuperado"],
  ["rompido", "rompido, sem reteste ainda"],
  ["rompimento_candidato", "rompimento em avaliação"],
];

export function leituraCurta(dia, cfg) {
  const nada = {
    classe: "neutro", rotulo: "sem leitura", razao: "bloco diário indisponível",
    chave: "sem_leitura",
  };
  if (!dia || dia.falha || !cfg) return nada;
  const dec = cfg.dec == null ? 2 : cfg.dec;
  const fech = dia.ultimo_fechamento_close;
  const ema = dia.ema89_fechada_atual;

  const pedacos = [];
  if (typeof fech === "number" && typeof ema === "number" && ema !== 0) {
    const pct = ((fech - ema) / ema) * 100;
    // Abaixo de 0,05% o arredondamento daria "0,0% abaixo", que afirma um
    // lado que o numero nao sustenta. Em cima da media e' em cima dela.
    pedacos.push(
      Math.abs(pct) < 0.05
        ? "em cima da média diária"
        : `${pgNum(Math.abs(pct), 1)}% ${fech >= ema ? "acima" : "abaixo"} da média diária`
    );
  }

  // Qual nivel manual esta no estado mais decisivo. A ordem de
  // ESTADOS_CURTO e' a ordem de relevancia para quem decide entrada.
  let achado = null;
  for (const [estado, texto] of ESTADOS_CURTO) {
    for (const nv of niveisDoPar(cfg)) {
      if (dia[`nivel_${nv.label}_estado`] !== estado) continue;
      achado = {
        chave: estado,
        rotulo: texto,
        alvo: `${nv.direcao === "alta" ? "resistência" : "suporte"} de ${pgValor(nv.nivel, dec)}`,
      };
      break;
    }
    if (achado) break;
  }
  if (achado) {
    return {
      classe: "atencao",
      rotulo: achado.rotulo,
      razao: [achado.alvo, ...pedacos].join(", "),
      chave: achado.chave,
    };
  }

  // Sem evento de nivel, a travessia da media diaria ainda e' fato do dia.
  const cruz = dia.ema89_cruzamento_fechado;
  if (cruz && cruz !== "nenhum") {
    return {
      classe: "atencao",
      rotulo: `cruzou a média diária para ${cruz === "acima" ? "cima" : "baixo"}`,
      razao: pedacos.join(", ") || "sem mais dados no fechamento",
      chave: cruz === "acima" ? "cruzou_acima" : "cruzou_abaixo",
    };
  }

  const det = Array.isArray(dia.deterioracao_tendencia) ? dia.deterioracao_tendencia : [];
  if (det.length) {
    return {
      classe: "atencao",
      rotulo: "sinais de enfraquecimento",
      razao: pedacos.join(", ") || "sem mais dados no fechamento",
      chave: "enfraquecimento",
    };
  }
  return {
    classe: "neutro",
    rotulo: "sem evento no diário",
    razao: pedacos.join(", ") || "sem dados suficientes no fechamento",
    chave: "sem_evento",
  };
}

// ------------------------------------------------------------
// O QUE CADA ROTULO QUER DIZER
//
// O rotulo tem de caber na linha, entao ele e' curto; a explicacao
// inteira nao caberia. O (?) ao lado resolve sem custo de espaco: quem
// ja sabe ignora, quem nao sabe passa o mouse -- e no celular, toca.
//
// A chave vem da propria leitura, e NAO do texto do rotulo. Casar por
// texto faria a explicacao sumir em silencio no dia em que alguem
// reescrevesse um rotulo; o teste cobre que toda chave que as leituras
// sabem produzir tem explicacao, e que nao sobra explicacao morta.
//
// Mesma regra da razao: SEM JARGAO, e sem dizer o que o preco vai
// fazer. A explicacao conta o que o rotulo constatou, nada alem disso.
export const EXPLICACOES = {
  sem_leitura:
    "O bloco deste timeframe não veio nesta execução, então não há o que ler.",
  na_media:
    "O fechamento está colado na média das últimas 89 semanas: nem esticado " +
    "para cima, nem descontado para baixo.",
  barato:
    "O fechamento está bem abaixo da média das últimas 89 semanas, e nada " +
    "indica queda em andamento.",
  barato_caindo:
    "O fechamento está bem abaixo da média das últimas 89 semanas, mas a " +
    "queda ainda está viva. Preço baixo não quer dizer que já parou de cair.",
  acima_normal:
    "O fechamento está bem acima da média das últimas 89 semanas, sem " +
    "exagero: é o estado normal de uma tendência de alta.",
  esticado_com_forca:
    "Subiu bem mais que a média das últimas 89 semanas, mas a compra ainda " +
    "manda no movimento. Esticado não é o mesmo que acabando.",
  esticado_sem_forca:
    "Subiu bem mais que a média das últimas 89 semanas e o movimento está " +
    "perdendo força: quem empurrava a alta está saindo.",
  reteste_confirmado:
    "O preço passou de uma faixa manual, voltou para testá-la e ela segurou. " +
    "É a sequência mais completa que o monitor acompanha.",
  em_reteste:
    "O preço passou de uma faixa manual e voltou para testá-la. Ainda não dá " +
    "para dizer se ela segura.",
  rompimento_falhou:
    "O preço passou de uma faixa manual e voltou para dentro dela: o " +
    "rompimento não se sustentou.",
  recuperado:
    "Uma faixa manual que tinha sido perdida foi retomada no fechamento.",
  rompido:
    "O preço passou de uma faixa manual e ainda não voltou para testá-la.",
  rompimento_candidato:
    "O preço acabou de passar de uma faixa manual, e o rompimento ainda não " +
    "foi confirmado.",
  cruzou_acima:
    "O fechamento diário passou para cima da média das últimas 89 velas do " +
    "diário.",
  cruzou_abaixo:
    "O fechamento diário passou para baixo da média das últimas 89 velas do " +
    "diário.",
  enfraquecimento:
    "O fechamento diário trouxe sinais de perda de força, sem nenhum evento " +
    "nas faixas manuais.",
  sem_evento:
    "Nada aconteceu no fechamento diário que mereça destaque.",
};

// O (?) so sai quando ha o que explicar: um botao que abre vazio e' pior
// que botao nenhum. aria-describedby com um <span role="tooltip"> e nao
// o title nativo, porque title nao abre no toque, nao segue o tema da
// pagina e demora um segundo para aparecer.
function pgAjuda(L, id) {
  const texto = EXPLICACOES[L.chave];
  if (!texto) return "";
  return (
    `<button type="button" class="aj" aria-describedby="${pgEsc(id)}" ` +
    `aria-label="O que significa: ${pgEsc(L.rotulo)}">?</button>` +
    `<span class="ajt" id="${pgEsc(id)}" role="tooltip">${pgEsc(texto)}</span>`
  );
}

// UMA caixa por par, com as duas leituras dentro. Eram duas secoes
// separadas, e as notas explicativas respondiam por 73% do texto do topo
// da pagina -- as leituras em si eram 209 caracteres contra 684 de nota.
// Juntas, some um titulo e uma nota inteira, e as duas linhas passam a
// ser lidas lado a lado, que e' como elas se completam: a longa diz ONDE
// o preco esta, a curta diz o que esta ACONTECENDO.
function pgLinhaLeitura(tag, L, id, extra) {
  return (
    `<div class="lh ${pgEsc(L.classe)}"><span class="lt">${pgEsc(tag)}</span>` +
    `<span class="lr">${pgEsc(L.rotulo)}</span>${pgAjuda(L, id)}` +
    `<span class="lz">${pgEsc(L.razao)}</span>${extra || ""}</div>`
  );
}

function pgLeitura(cfg, dados) {
  const longa = leituraLonga((dados.semanal || {})[cfg.label], cfg.dec);
  const curta = leituraCurta((dados.diario || {})[cfg.label], cfg);
  // O radar de promocao so ocupa espaco quando tem o que dizer. E' aviso
  // de MANUTENCAO, nao leitura de mercado, entao entra discreto e no fim
  // da caixa, separado das duas leituras.
  const dia = (dados.diario || {})[cfg.label] || {};
  const cand = dia.zonas_candidatas_a_faixa;
  const radar =
    cand && cand !== "nenhuma"
      ? `<span class="lradar">região amadurecida sem faixa manual: ${pgEsc(cand)}</span>`
      : "";
  // Longo primeiro: enquadramento antes do evento do dia. A ordem
  // inversa faria o fato de hoje parecer mais importante que a escala em
  // que este monitor decide, que e' o contrario do que ele assume.
  return (
    `<div class="leitura" data-par="${pgEsc(cfg.label)}">` +
    `<span class="lp">${pgEsc(cfg.label)}</span>` +
    pgLinhaLeitura("longo", longa, `aj-${cfg.key}-longo`) +
    pgLinhaLeitura("curto", curta, `aj-${cfg.key}-curto`) +
    `${radar}</div>`
  );
}

function pgCartao(cfg, dados) {
  const dia = (dados.diario || {})[cfg.label];
  const sem = (dados.semanal || {})[cfg.label];
  const preco = dia && typeof dia.preco_atual === "number" ? pgNum(dia.preco_atual, cfg.dec) : "--";
  // Os botoes mudam o timeframe do DESENHO. Sao nossos, e nao da barra
  // do TradingView: o widget publico roda num iframe de outra origem e
  // nao avisa quando alguem troca o intervalo por dentro dele, entao so
  // por aqui da' para levar o RSI junto.
  const grafico = cfg.grafico
    ? `<div class="grafico"><div class="tv-barra" role="group" ` +
      `aria-label="Timeframe do gráfico"><button type="button" class="tv-tf" ` +
      `data-tf="D" aria-pressed="true">Diário</button>` +
      `<button type="button" class="tv-tf" data-tf="W" aria-pressed="false">` +
      `Semanal</button></div>` +
      `<div class="tv" id="tv-${pgEsc(cfg.key)}">` +
      `<span class="tv-off">Gráfico indisponível — abra em ` +
      `<a href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(cfg.grafico)}" ` +
      `target="_blank" rel="noopener">${pgEsc(cfg.grafico)}</a>.</span></div>` +
      `<p>${pgEsc(cfg.graficoNota || "")}</p></div>`
    : "";
  return (
    `<article class="par" data-par="${pgEsc(cfg.label)}">` +
    `<header><h2>${pgEsc(cfg.label)}</h2>` +
    `<div class="preco">${preco}</div></header>` +
    `<div class="tfs">${pgTimeframe("Diário", dia, cfg.dec)}${pgTimeframe("Semanal", sem, cfg.dec)}</div>` +
    grafico +
    `</article>`
  );
}

// "Monitor BTC" -> "Monitor <b>BTC</b>": so a segunda palavra ganha o
// azul, e um titulo de uma palavra so continua saindo inteiro.
function pgMarca() {
  const p = /^(\S+)\s+(.+)$/.exec(TITULO_PAGINA);
  return p ? `${pgEsc(p[1])} <b>${pgEsc(p[2])}</b>` : pgEsc(TITULO_PAGINA);
}

export function toHTML(text, dados) {
  const d = dados || { cabecalho: {}, diario: {}, semanal: {} };
  const ts = String((d.cabecalho && d.cabecalho.timestamp) || "");
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC$/.exec(ts);
  const iso = m ? `${m[1]}T${m[2]}:00Z` : "";
  // Um par com semCartao fica so no relatorio completo, la embaixo. E
  // como o grafico mora DENTRO do cartao, quem nao tem cartao tambem
  // nao tem grafico: as duas listas saem da mesma filtragem, entao nao
  // ha como sobrar um widget apontando para um container inexistente.
  const comCartao = PAIRS.filter((c) => !c.semCartao);
  const comGrafico = comCartao.filter((c) => c.grafico);
  // O grafico abre no diario e troca para o semanal pelos botoes acima
  // dele. Em cada intervalo o RSI do desenho tem de ser o mesmo que o
  // cartao daquele timeframe publica, senao o desenho contradiz o numero
  // ao lado. DERIVADO da configuracao: mudar tf.rsi.length move o
  // desenho junto, sem ninguem lembrar de vir aqui.
  const rsiDoTf = (chave) =>
    (TIMEFRAMES.find((t) => t.key === chave) || { rsi: { length: PERIOD } }).rsi.length;
  const rsiPorIntervalo = { D: rsiDoTf("diario"), W: rsiDoTf("semanal") };

  return (
    "<!doctype html>\n" +
    '<html lang="pt-BR">\n<meta charset=utf-8>\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    `<title>${pgEsc(TITULO_PAGINA)}</title>\n` +
    `<style>${PAGINA_CSS}</style>\n` +
    // Antes do <body>, senao haveria um flash do tema errado a cada
    // carga. A decisao, nesta ordem:
    //
    //   escolha salva no botao   manda, sempre
    //   sem escolha              segue o prefers-color-scheme do SO
    //   sem escolha e sem suporte a matchMedia   noite
    //
    // Nao ha regra por HORARIO de proposito: quem quer tema escuro a
    // noite ja liga o agendamento automatico do proprio sistema, e o
    // prefers-color-scheme entrega isso de graca. Uma regra de horario
    // propria brigaria com quem escolheu claro de proposito, e faria a
    // pagina mudar de cara sozinha conforme a hora de abrir -- que se le
    // como defeito, nao como recurso.
    '<script id="tema-inicial">try{var t=localStorage.getItem("tema");' +
    'if(t==="claro"||(!t&&!matchMedia("(prefers-color-scheme: dark)").matches))' +
    'document.documentElement.setAttribute("data-tema","claro")}catch(e){}</script>\n' +
    '<body>\n<div class="pagina">\n' +
    `<header class="topo"><h1>${pgMarca()}</h1>` +
    `<div class="carimbo"><time datetime="${pgEsc(iso)}">${pgEsc(ts)}</time>` +
    `<span class="idade" id="idade" data-ts="${pgEsc(iso)}"></span>` +
    // Sem texto no botao: entra o par lua/sol, que e' o icone de fato
    // usado para este controle. Como o rotulo visivel sumiu, o nome do
    // botao passa a viver no aria-label e no title.
    '<button type="button" class="btn-tema" id="btn-tema" aria-pressed="true" ' +
    'title="Alternar night mode" aria-label="Alternar night mode">' +
    '<svg class="lua" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg><svg class="sol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>' +
    "</button>" +
    "</div></header>\n" +
    // Seletor de par. So aparece quando ha mais de um com cartao: num
    // monitor de par unico ele seria um botao que nao faz nada.
    //
    // Ele filtra a LEITURA e o CARTAO ao mesmo tempo, entao a pagina
    // inteira passa a falar de um par por vez. O relatorio completo la
    // embaixo NAO e' filtrado: ele e' o fallback do prompt e sai sempre
    // inteiro.
    (comCartao.length > 1
      ? `<div class="sel-par" role="group" aria-label="Par exibido">` +
        comCartao
          .map(
            (c, i) =>
              `<button type="button" data-sel="${pgEsc(c.label)}" ` +
              `aria-pressed="${i === 0 ? "true" : "false"}">${pgEsc(c.label)}</button>`
          )
          .join("") +
        `</div>\n`
      : "") +
    // Vem ANTES dos cartoes de proposito: e' o que responde "e dai?" sem
    // exigir leitura do resto da pagina.
    `<section class="leituras"><h2>Contexto</h2>` +
    comCartao.map((c) => pgLeitura(c, d)).join("") +
    // UMA nota, curta. As duas anteriores somavam 684 caracteres contra
    // 209 das leituras, e viravam parede de texto justo em cima da unica
    // parte da pagina escrita para quem nao sabe analise tecnica. A
    // explicacao inteira mora no README, que e' o lugar dela.
    `<p class="nota"><b>Longo</b> compara o fechamento semanal com a média ` +
    `das últimas 89 semanas. <b>Curto</b> diz o que aconteceu no fechamento ` +
    `diário, o timeframe de timing, calibrado para 1 a 6 semanas e não para ` +
    `o dia. Perto e longe levam em conta o quanto cada par oscila; amarelo ` +
    `quer dizer <b>vale olhar</b>, não bom nem ruim. Não é recomendação.` +
    `</p></section>\n` +
    `<section class="pares">${comCartao.map((c) => pgCartao(c, d)).join("")}</section>\n` +
    '<section class="relatorio"><h2>Relatório completo</h2>\n' +
    // ---- daqui ate o </pre> e' o bloco que o fallback do prompt le ----
    "<pre>" +
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
    "</pre>\n" +
    // ---- fim do bloco lido pelo fallback ----
    "</section>\n" +
    '<p class="rodape">Os cartões acima são um resumo. O relatório completo é a fonte, ' +
    "e sai igual em <a href=\"relatorio.json\">relatorio.json</a> e <a href=\"index.txt\">index.txt</a>.</p>\n" +
    "</div>\n" +
    // Idade do relatorio calculada no navegador: o HTML e' estatico, so
    // quem abre a pagina sabe que horas sao. 90 min e' o mesmo limiar
    // que o fallback do prompt usa para considerar o relatorio velho.
    '<script>(function(){var e=document.getElementById("idade"),t=e&&e.getAttribute("data-ts");' +
    "if(!e||!t)return;var m=Math.round((Date.now()-Date.parse(t))/6e4);if(!isFinite(m))return;" +
    'e.textContent="há "+(m<60?m+" min":Math.floor(m/60)+"h"+String(m%60).padStart(2,"0"));' +
    'e.className="idade "+(m<=90?"ok":m<=240?"aviso":"velho");})();</script>\n' +
    (comGrafico.length
      ? '<script src="https://s3.tradingview.com/tv.js"></script>\n<script>' +
        // Redesenha em vez de so trocar CSS: o grafico mora num iframe do
        // TradingView, e o tema dele e' escolhido na criacao do widget.
        // Intervalo e RSI andam juntos: quem troca o intervalo passa o
        // novo, quem so troca o tema reaproveita o que ja esta valendo.
        `window.rsiPorIntervalo=${JSON.stringify(rsiPorIntervalo)};` +
        'window.intervaloGrafico="D";' +
        "window.desenharGraficos=function(tema,intervalo){if(!window.TradingView)return;" +
        "if(intervalo)window.intervaloGrafico=intervalo;" +
        "var iv=window.intervaloGrafico,rsi=window.rsiPorIntervalo[iv];" +
        'var bs=document.querySelectorAll(".tv-tf");for(var k=0;k<bs.length;k++)' +
        'bs[k].setAttribute("aria-pressed",bs[k].getAttribute("data-tf")===iv?"true":"false");' +
        JSON.stringify(comGrafico.map((c) => ({ id: `tv-${c.key}`, s: c.grafico }))) +
        ".forEach(function(g){var el=document.getElementById(g.id);if(!el)return;el.innerHTML='';" +
        // Container escondido sai com dimensao zero, entao nem vale
        // criar: quem mostra o par redesenha com ele ja visivel.
        "if(el.offsetParent===null)return;" +
        "new TradingView.widget({container_id:g.id,symbol:g.s,interval:iv,theme:tema," +
        'style:"1",locale:"br",timezone:"America/Sao_Paulo",autosize:true,' +
        // EMA89 e RSI carregados no widget; o periodo do RSI acompanha
        // o timeframe selecionado. ADX/DMI fica de fora e se adiciona
        // na hora, pelo proprio widget -- o padrao dele ja serve.
        //
        // O RSI vai como OBJETO, igual a EMA: como string ao lado de um
        // objeto o widget o descartava em silencio. E pede a media movel
        // do proprio RSI desligada (o TradingView a inclui por padrao e
        // ela polui). Dois caminhos ao mesmo tempo, porque so o navegador
        // confirma qual o widget honra: o input smoothingLine="None" e o
        // override escondendo o plot da media. Se nenhum pegar, o RSI sai
        // com a media e se desmarca a mao -- nao quebra nada.
        "allow_symbol_change:false,save_image:false," +
        // O RSI vem da tabela por intervalo montada acima, entao segue o
        // botao: diario usa o periodo do cartao diario, semanal o do
        // semanal. A EMA vem de EMA_PERIOD, que nao e' por timeframe e
        // por isso nao muda com o intervalo.
        `studies:[{id:"MAExp@tv-basicstudies",inputs:{length:${EMA_PERIOD}}},` +
        '{id:"RSI@tv-basicstudies",inputs:{length:rsi,smoothingLine:"None"}}],' +
        'studies_overrides:{"moving average exponential.plot.color":tema==="dark"?"#8ec6ff":"#1560c0",' +
        '"relative strength index.smoothed ma.visible":false},' +
        `backgroundColor:tema==="dark"?"${TV_FUNDO.noite}":"${TV_FUNDO.claro}",` +
        'gridColor:tema==="dark"?"rgba(93,109,140,0.14)":"rgba(90,110,140,0.16)"});});};' +
        "</script>\n"
      : "") +
    // Botao do tema. O <html> ja veio com data-tema aplicado pelo script
    // do topo -- aqui so se liga o botao e se desenha o grafico no tema
    // que ja esta valendo.
    '<script>(function(){var r=document.documentElement,b=document.getElementById("btn-tema");' +
    "function aplica(noite,salvar){if(noite)r.removeAttribute(\"data-tema\");" +
    'else r.setAttribute("data-tema","claro");' +
    'if(b)b.setAttribute("aria-pressed",noite?"true":"false");' +
    'if(salvar){try{localStorage.setItem("tema",noite?"noite":"claro")}catch(e){}}' +
    'if(window.desenharGraficos)window.desenharGraficos(noite?"dark":"light");}' +
    'if(b)b.addEventListener("click",function(){aplica(r.hasAttribute("data-tema"),true)});' +
    // Delegado no documento: os botoes do grafico nascem com o cartao e
    // nao mudam depois, mas assim um cartao a mais nao pede fiacao nova.
    'document.addEventListener("click",function(e){' +
    'var t=e.target,alvo=null;while(t&&t!==document){' +
    'if(t.classList&&t.classList.contains("tv-tf")){alvo=t;break}t=t.parentNode}' +
    'if(!alvo||!window.desenharGraficos)return;' +
    'window.desenharGraficos(r.hasAttribute("data-tema")?"light":"dark",' +
    'alvo.getAttribute("data-tf"));});' +
    // Quem nunca clicou no botao segue o SO tambem enquanto a pagina
    // esta aberta -- trocar o tema do sistema muda a pagina na hora.
    // Quem clicou fica com a propria escolha e ignora o SO.
    'try{var mq=matchMedia("(prefers-color-scheme: dark)");' +
    'mq.addEventListener("change",function(e){var t=null;' +
    'try{t=localStorage.getItem("tema")}catch(_){}' +
    'if(!t)aplica(e.matches,false)})}catch(e){}' +
    // ---- seletor de par ----
    // Mostra UM par por vez: filtra a caixa de leitura e o cartao, que
    // carregam o mesmo data-par. Sem JS nada e' escondido, entao a
    // pagina continua completa se o script nao rodar.
    //
    // Depois de trocar, o grafico e' REDESENHADO. O widget do
    // TradingView calcula o tamanho na criacao, e um container que
    // nasceu escondido sai com dimensao zero e fica quebrado ao
    // aparecer. Recriar com o container ja visivel resolve.
    'window.mostrarPar=function(par,semDesenhar){' +
    'var alvos=document.querySelectorAll("[data-par]");var achou=false;' +
    // Confere ANTES de esconder. Esconder primeiro e desistir depois
    // deixava a pagina em branco quando o par pedido nao existia.
    'for(var i=0;i<alvos.length;i++)' +
    'if(alvos[i].getAttribute("data-par")===par){achou=true;break}' +
    'if(!achou)return;' +
    'for(var j=0;j<alvos.length;j++){' +
    'var meu=alvos[j].getAttribute("data-par")===par;' +
    'if(meu)alvos[j].classList.remove("oculto");else alvos[j].classList.add("oculto")}' +
    'var bs=document.querySelectorAll(".sel-par button");' +
    'for(var k=0;k<bs.length;k++)bs[k].setAttribute("aria-pressed",' +
    'bs[k].getAttribute("data-sel")===par?"true":"false");' +
    'if(!semDesenhar&&window.desenharGraficos)window.desenharGraficos(' +
    'r.hasAttribute("data-tema")?"light":"dark")};' +
    'document.addEventListener("click",function(e){' +
    'var t=e.target,alvo=null;while(t&&t!==document){' +
    'if(t.getAttribute&&t.getAttribute("data-sel")){alvo=t;break}t=t.parentNode}' +
    'if(alvo)window.mostrarPar(alvo.getAttribute("data-sel"));});' +
    // Na carga, seleciona o primeiro. So faz sentido quando ha seletor:
    // com um par unico a pagina fica como sempre foi.
    // Na carga o seletor SO esconde: quem desenha e' o aplica() logo
    // abaixo, uma vez so. Desenhar aqui tambem criava o widget duas
    // vezes por carga -- quatro iframes do TradingView na pagina de
    // dois pares, para um grafico visivel.
    'var prim=document.querySelector(".sel-par button");' +
    'if(prim)window.mostrarPar(prim.getAttribute("data-sel"),true);' +
    'aplica(!r.hasAttribute("data-tema"),false);})();</script>\n' +
    "</body>\n</html>\n"
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

  // UM parse so, servindo a pagina e o JSON. Antes a pagina nao lia
  // nada e o JSON parseava por conta; agora os dois saem do mesmo
  // objeto, e nao ha como o resumo da pagina discordar do relatorio.
  const dadosJSON = relatorioParaJSON(texto, zonas);
  writeFileSync("docs/index.html", toHTML(texto, dadosJSON));
  writeFileSync("docs/index.txt", texto + "\n");
  writeFileSync("docs/relatorio.json", JSON.stringify(dadosJSON, null, 2) + "\n");
  writeFileSync("docs/.nojekyll", "");

  // Historico append-only. Le as assinaturas do estado anterior para nao
  // repetir linha a cada execucao horaria sobre a mesma vela fechada.
  const hist = registrarHistorico(dadosJSON, estadoPrev.historicoAssinaturas || {});
  if (hist.entradas.length) {
    appendFileSync(
      "docs/historico.jsonl",
      hist.entradas.map((e) => JSON.stringify(e)).join("\n") + "\n"
    );
  }
  writeFileSync(
    "docs/estado.json",
    JSON.stringify(
      {
        ativos,
        em: new Date().toISOString(),
        niveis: estadoNiveis,
        zonas: zonasEstado,
        contadoresZona,
        historicoAssinaturas: hist.assinaturas,
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
