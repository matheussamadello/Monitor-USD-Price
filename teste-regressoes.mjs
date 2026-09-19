// Reproducoes dos defeitos da auditoria. Sem rede; executavel sozinho
// ou pelo teste-fumaca.mjs usado no workflow.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as m from "./monitor.mjs";

const DIA = 86400;
const epoch = (s) => Date.parse(s) / 1000;
const clone = (x) => JSON.parse(JSON.stringify(x));
let falhas = 0;
let grupos = 0;
async function teste(nome, fn) {
  grupos++;
  try { await fn(); console.log(`OK regressao: ${nome}`); }
  catch (e) { falhas++; console.error(`FALHA regressao: ${nome}\n${e.stack}`); }
}
async function noInstante(iso, fn) {
  const original = Date.now;
  Date.now = () => Date.parse(iso);
  try { return await fn(); } finally { Date.now = original; }
}

await teste("uma vela nao retesta o proprio rompimento", () => {
  for (const direcao of ["alta", "baixa"]) {
    const vela = direcao === "alta"
      ? { open: 101, high: 104, low: 99, close: 103 }
      : { open: 99, high: 101, low: 96, close: 97 };
    const ctx = { nivel: 100, direcao, vela: { ...vela, time: 1788825600 },
      atr: 4, tolAtr: 0.25, resetAtr: 1.5, maxCandles: 30, segundos: DIA };
    const primeiro = m.atualizarEstadoNivel(null, ctx);
    assert.equal(primeiro.estado, "rompido");
    const salvo = clone(primeiro);
    for (let i = 0; i < 5; i++) {
      const repetido = m.atualizarEstadoNivel(clone(primeiro), ctx);
      assert.equal(repetido.estado, "rompido");
      assert.deepEqual(repetido.historico, []);
      assert.equal(repetido.atualizado, ctx.vela.time);
    }
    const antigo = m.atualizarEstadoNivel(primeiro,
      { ...ctx, vela: { ...ctx.vela, time: ctx.vela.time - DIA, close: 100 } });
    assert.equal(antigo.estado, "rompido");
    assert.equal(antigo.atualizado, ctx.vela.time);
    assert.deepEqual(primeiro, salvo, "entrada persistida nao e' mutada");
    const reteste = m.atualizarEstadoNivel(primeiro,
      { ...ctx, vela: { ...ctx.vela, time: ctx.vela.time + DIA } });
    assert.equal(reteste.estado, "reteste_confirmado", "uma vela posterior pode retestar");
    assert.equal(reteste.historico.length, 1);
  }
});

await teste("sinteses preservam a direcao do nivel", () => {
  const ctx = { alertas: [], estrutura: { tendencia: "indefinida" },
    estruturaEventos: [], divergencias: [], vol: null, enfraquecimento: [],
    fraqueza: [], rsiFech: null, rsiAnt: null, diPlus: null, diMinus: null };
  const resumo = (estado, direcao) => m.sinteses({ ...ctx, estadosNivel: [{ estado, direcao }] });
  assert.equal(resumo("rompimento_falhou", "baixa").deterioracao, "nenhuma");
  assert.match(resumo("rompimento_falhou", "alta").deterioracao, /rompimento_falhou/);
  assert.equal(resumo("reteste_confirmado", "baixa").entrada, "nenhuma");
  assert.match(resumo("reteste_confirmado", "alta").entrada, /reteste_confirmado/);
  assert.equal(resumo("em_reteste", "baixa").pullback, "nenhuma");
  assert.match(resumo("em_reteste", "alta").pullback, /em_reteste_de_nivel/);
  assert.match(resumo("em_reteste", "baixa").riscos, /nivel_em_teste/);
  assert.equal(m.sinteses({ ...ctx, estadosNivel: ["reteste_confirmado"] }).entrada, "nenhuma");
});

await teste("zonas nao derivam quando a vela fechada e' a mesma", () => {
  const tf = m.TIMEFRAMES_TESTE.find((t) => t.key === "diario");
  const cfg = { key: "audit", dec: 2, niveis: { faixas: [] } };
  const dados = (n) => {
    const closes = Array.from({ length: n }, (_, i) => 100 + i * .014 + 9 * Math.sin(i * .29) + 3 * Math.sin(i * .077));
    return { closes, opens: closes.map((c, i) => closes[i - 1] ?? c),
      highs: closes.map((c, i) => Math.max(c, closes[i - 1] ?? c) + .7),
      lows: closes.map((c, i) => Math.min(c, closes[i - 1] ?? c) - .7),
      times: closes.map((_, i) => 1704067200 + i * DIA),
      volumes: closes.map(() => 1000), temVolume: true,
      live: { close: closes.at(-1), volume: 500, time: 1704067200 + n * DIA } };
  };
  let anterior = [], proximoId = 1, comparadas = 0;
  for (let n = 150; n <= 165; n++) {
    const d = dados(n);
    const calcular = (zonasAnteriores) => m.calcularZonas(cfg, tf, d, {
      pivos: m.acharPivos(d.highs, d.lows, tf.pivos.esq, tf.pivos.dir),
      zonasAnteriores, zonasSemanais: [], proximoId });
    const novo = calcular(anterior);
    proximoId = novo.proximoId;
    let repetido = novo;
    for (let i = 0; i < 4; i++) {
      d.live.close = d.closes.at(-1) + i - 2;
      repetido = calcular(clone(repetido.zonasEstado.map(m.zonaParaEstado)));
      assert.equal(repetido.proximoId, proximoId, "retry nao cria identidade");
      for (const z of repetido.zonasEstado) {
        const antes = novo.zonasEstado.find((a) => a.id === z.id);
        assert.ok(antes, `zona ${z.id} preservada`);
        assert.equal(z.centro, antes.centro);
        assert.equal(z.score, antes.score);
        comparadas++;
      }
    }
    anterior = novo.zonasEstado;
  }
  assert.ok(comparadas > 0, "fixture precisa produzir zonas");
});

await teste("volume confirma apenas o rompimento/perda da mesma vela fechada", () => {
  const alertas = (d, vsMediaPct, suporte = false) => m.alertasTecnicos({ niveis: {
    resistencia: suporte ? null : 100, resistenciaLabel: "100",
    suporte: suporte ? 100 : null, suporteLabel: "100", faixas: [] } }, d,
    { rsi: null, adx: null, adxAnt: null, volume: { vsMediaPct, tendencia: "irregular" } });
  const viva = { opens: [98], closes: [99], live: { open: 99, high: 102, low: 98, close: 101 } };
  for (const vol of [60, -60]) {
    const a = alertas(viva, vol);
    assert.ok(a.includes("rompimento_intradiario_100"));
    assert.ok(!a.some((x) => /volume/.test(x)), a.join(","));
    const b = alertas({ opens: [102], closes: [101],
      live: { open: 101, high: 102, low: 98, close: 99 } }, vol, true);
    assert.ok(!b.some((x) => /volume/.test(x)), b.join(","));
  }
  // Corpo inteiro alem do nivel: rompimento FORTE, e o volume confirma.
  assert.ok(alertas({ ...viva, opens: [101], closes: [103] }, 60).includes("rompimento_com_volume_acima_da_media"));
  assert.ok(alertas({ ...viva, opens: [99], closes: [97] }, 60, true).includes("queda_com_expansao_de_volume"));

  // Versao FRACA -- so o fechamento passou, o corpo ficou em cima do
  // nivel -- nao ganha confirmacao de volume. O prompt manda le-la como
  // um toque intradiario que por acaso caiu no fechamento, e toque
  // intradiario nao ganha volume (o laco acima prova isso). O prefixo
  // "rompimento_confirmado_" casa com "rompimento_confirmado_fraco_",
  // entao a exclusao precisa ser explicita.
  const fraco = alertas({ ...viva, opens: [99], closes: [103] }, 60);
  assert.ok(fraco.includes("rompimento_confirmado_fraco_100"), fraco.join(","));
  assert.ok(!fraco.some((x) => /volume/.test(x)),
    "rompimento fraco nao recebe confirmacao de volume: " + fraco.join(","));
  const fraca = alertas({ ...viva, opens: [101], closes: [99] }, 60, true);
  assert.ok(fraca.includes("perda_suporte_confirmada_fraca_100"), fraca.join(","));
  assert.ok(!fraca.some((x) => /volume/.test(x)),
    "perda fraca nao recebe expansao de volume: " + fraca.join(","));
});

function respostaYahoo(rows, meta = {}) {
  return JSON.stringify({ chart: { error: null, result: [{ meta: { gmtoffset: 0, ...meta },
    timestamp: rows.map((r) => r.time), indicators: { quote: [{
      open: rows.map((r) => r.open), high: rows.map((r) => r.high),
      low: rows.map((r) => r.low), close: rows.map((r) => r.close) }] } }] } });
}
function respostaBinance(rows, passo) {
  return JSON.stringify(rows.map((r) => [r.time * 1000, r.open, r.high, r.low, r.close,
    r.volume, (r.time + passo) * 1000 - 1, 0, 100]));
}
function mockFetch() {
  return async (raw) => {
    const url = new URL(raw);
    const yahoo = url.hostname.includes("yahoo");
    const binance = url.hostname.includes("binance");
    const intervalo = url.searchParams.get("interval");
    const passo = ["10080", "1w", "1wk"].includes(intervalo) ? DIA * 7 : DIA;
    const cfg = yahoo ? m.PARES_TESTE.find((p) => p.key === "usd")
      : binance ? m.PARES_TESTE.find((p) => p.key === "usdt")
      : m.PARES_TESTE.find((p) => p.par === url.searchParams.get("pair"));
    assert.ok(cfg, `fonte inesperada no mock: ${url.hostname}`);
    const agora = Math.floor(Date.now() / 1000);
    const fim = passo === DIA ? Math.floor(agora / DIA) * DIA
      : Math.floor((agora + 3 * DIA) / passo) * passo - 3 * DIA;
    const rows = [];
    for (let i = 0; i < 170; i++) {
      const time = fim - (169 - i) * passo;
      if (yahoo && passo === DIA && [0, 6].includes(new Date(time * 1000).getUTCDay())) continue;
      const R = cfg.niveis.resistencia;
      const close = R * (1.05 + .002 * Math.sin(i * .3));
      rows.push({ time, open: R * 1.045, high: close + .02 * R,
        low: R * 1.035, close, volume: 1000 + i });
    }
    const text = yahoo ? respostaYahoo(rows) : binance ? respostaBinance(rows, passo)
      : JSON.stringify({ error: [], result: { candles: rows.map((r) =>
        [r.time, r.open, r.high, r.low, r.close, r.close, r.volume, 100]), last: fim } });
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  };
}
// Espelha o que o bloco de execucao grava em docs/estado.json. Se um
// campo persistido faltar aqui, os testes de build passam a simular um
// monitor que o perde a cada execucao -- e o defeito fica invisivel.
const estadoDe = (r) => clone({ ema89Semanal: r.estadoEma89Semanal, niveis: r.estadoNiveis, zonas: r.zonasEstado, contadoresZona: r.contadoresZona, ultimaVelaProcessada: r.ultimaVelaProcessada });
const jsonDe = (r) => m.relatorioParaJSON(r.texto, r.zonas);

await teste("eventos persistem entre execucoes e expiram na vela seguinte", async () => {
  let salvo;
  await noInstante("2026-09-10T12:00:00Z", async () => {
    const primeiro = await m.build(mockFetch(), {});
    assert.doesNotMatch(primeiro.texto, /FALHA:/);
    const j1 = jsonDe(primeiro);
    salvo = estadoDe(primeiro);
    const reinicio = await m.build(mockFetch(), clone(salvo));
    const j2 = jsonDe(reinicio);
    for (const tf of ["diario", "semanal"]) for (const p of m.PARES_TESTE) {
      assert.ok(j1[tf][p.label].niveis_mudancas_nesta_vela.length > 0);
      assert.deepEqual(j2[tf][p.label].niveis_mudancas_nesta_vela, j1[tf][p.label].niveis_mudancas_nesta_vela);
      assert.deepEqual(j2[tf][p.label].alertas_tecnicos, j1[tf][p.label].alertas_tecnicos);
    }
    assert.deepEqual(estadoDe(reinicio), salvo);
    const falha = await m.build(async () => ({ ok: false, status: 503 }), clone(salvo));
    assert.deepEqual(falha.estadoNiveis, salvo.niveis, "falha de fonte nao apaga eventos persistidos");
    const legado = clone(salvo);
    for (const n of Object.values(legado.niveis)) delete n.mudancasNaVela;
    const migrado = jsonDe(await m.build(mockFetch(), legado));
    for (const p of m.PARES_TESTE)
      assert.deepEqual(migrado.diario[p.label].niveis_mudancas_nesta_vela, [], "sem anuncio retroativo no estado legado");
  });
  await noInstante("2026-09-11T12:00:00Z", async () => {
    const proximo = jsonDe(await m.build(mockFetch(), salvo));
    for (const p of m.PARES_TESTE) {
      assert.deepEqual(proximo.diario[p.label].niveis_mudancas_nesta_vela, []);
      assert.ok(proximo.semanal[p.label].niveis_mudancas_nesta_vela.length > 0, "semana ainda e' a mesma");
    }
  });
});

await teste("historico conta condicao e referencia uma vez por vela", () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-regressao-"));
  try {
    mkdirSync(join(dir, "docs"));
    const medir = (rows) => {
      writeFileSync(join(dir, "docs/historico.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      const r = spawnSync(process.execPath, [fileURLToPath(new URL("./analisar-historico.mjs", import.meta.url)), "1"],
        { cwd: dir, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    const precos = [100, 110, 109, 107, 108, 106, 111];
    const serie = (par, tf) => precos.map((fech, i) => ({ par, tf, vela: `2026-01-0${i + 1}`,
      fech, atr: 1, alertas: ["rsi_acima_70"], deterioracao: [], conf_entrada: [],
      ema89_confirmacao: "acima", ema89_evento_id: `${par}|${tf}|${i}`,
      conf_pullback: [], niveis_mud: [], estrutura: "alta", ema89_cruz: "nenhum" }));
    const rows = [];
    for (const [par, tf] of [["P/Q", "diario"], ["R/Q", "diario"], ["P/Q", "semanal"]]) {
      for (const e of serie(par, tf)) {
        rows.push(e, { ...e, alertas: ["rsi_acima_70", "di_plus_cruzando_acima_di_minus"] });
        if (e.vela === "2026-01-01") for (let i = 0; i < 10; i++) rows.push(e);
      }
    }
    const texto = medir(rows);
    for (const [par, tf] of [["P/Q", "diario"], ["R/Q", "diario"], ["P/Q", "semanal"]])
      for (const condicao of ["alerta:rsi_acima_70", "alerta:di_plus_cruzando_acima_di_minus", "ema89_confirmou=acima", "TODAS AS VELAS (referencia)"]) {
        const linha = texto.split("\n").find((l) => l.startsWith(`${par} | ${tf} | ${condicao}`));
        assert.ok(linha, `${par}/${tf}/${condicao} presente`);
        assert.match(linha, /\s6\s+0\.00\s+50%$/, linha);
      }
    const curta = serie("P/Q", "diario").slice(0, 2);
    assert.match(medir([...Array(20).fill(curta[0]), curta[1]]), /Ainda nao ha amostras suficientes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// O monitor USD acrescenta abaixo os cenarios de fechamento das fontes.
await teste("USD inclui o ultimo pregao encerrado sem duplicar a vela", async () => {
  const diario = m.TIMEFRAMES_TESTE.find((t) => t.key === "diario");
  const semanal = m.TIMEFRAMES_TESTE.find((t) => t.key === "semanal");
  const vela = (time, i) => ({
    time,
    open: 5 + i * .001, high: 5.03 + i * .001, low: 4.97 + i * .001,
    close: 5.01 + i * .001, volume: 1000 + i,
  });
  const rows = (ultimo, passo = DIA) =>
    Array.from({ length: 120 }, (_, i) => vela(epoch(ultimo) - (119 - i) * passo, i));
  // O cambio a vista nao negocia sabado nem domingo, e a serie que o
  // Yahoo devolve nao tem essas barras. A fixture tambem nao pode ter:
  // com uma serie corrida de 120 dias o teste media o filtro de fim de
  // semana em vez de medir a regra que ele existe para provar.
  const diasUteis = (ultimo, n = 120) => {
    const out = [];
    let t = epoch(ultimo);
    while (out.length < n) {
      const dow = new Date(t * 1000).getUTCDay();
      if (dow !== 0 && dow !== 6) out.unshift(t);
      t -= DIA;
    }
    return out.map((time, i) => vela(time, i));
  };
  const sexta = diasUteis("2026-09-11T00:00:00Z");
  const semana = rows("2026-09-07T00:00:00Z", 7 * DIA);
  for (const instante of ["2026-09-12T12:00:00Z", "2026-09-13T12:00:00Z"]) {
    await noInstante(instante, () => {
      for (const [serie, tf] of [[sexta, diario], [semana, semanal]]) {
        const d = m.parseYahoo(respostaYahoo(serie), tf);
        assert.equal(d.emFormacao, false);
        assert.equal(d.times.at(-1), serie.at(-1).time);
        assert.equal(d.closes.length, serie.length);
      }
      // Uma repeticao plana de domingo nao inventa um pregao.
      const fantasma = { time: epoch(instante), open: 9, high: 9, low: 9, close: 9 };
      assert.equal(m.parseYahoo(respostaYahoo([...sexta, fantasma]), diario).times.at(-1), sexta.at(-1).time);
      // E nem uma repeticao QUASE plana. Caso real de 2026-09-13, um
      // domingo: o Yahoo mandou 5.1262/5.1270/5.1262/5.1270 -- amplitude
      // de 0,0008 contra ~0,04 de um pregao, diferente de zero, entao o
      // filtro de amplitude nao pegava. Quando o periodo dessa barra
      // venceu, ela entrou na serie FECHADA: virou candle_fechado_1,
      // empurrou a sexta para tras e levou um true range de 0,0008 para
      // dentro do ATR.
      // Mesma forma do caso real (amplitude de 0,0008), com precos fora
      // da faixa da fixture para o teste nao colidir com um fechamento
      // legitimo da serie.
      const quaseplano = {
        time: epoch(instante), open: 9.1262, high: 9.1270, low: 9.1262, close: 9.1270,
      };
      const comQuasePlano = m.parseYahoo(respostaYahoo([...sexta, quaseplano]), diario);
      assert.equal(comQuasePlano.times.at(-1), sexta.at(-1).time,
        "barra de fim de semana com amplitude minuscula nao vira a ultima vela");
      assert.equal(comQuasePlano.closes.length, sexta.length,
        "e nao entra na serie fechada");
      assert.ok(!comQuasePlano.closes.includes(9.1270),
        "a cotacao de domingo nao aparece entre os fechamentos");
      // No semanal era pior: inicioSemana(domingo) cai na segunda da
      // MESMA semana, entao a cotacao de domingo virava o fechamento da
      // semana inteira.
      const semComQuasePlano = m.parseYahoo(respostaYahoo([...semana, quaseplano]), semanal);
      assert.equal(semComQuasePlano.closes.at(-1), semana.at(-1).close,
        "a barra de fim de semana nao vira o fechamento da semana");
    });
  }
  const sessao = (dia) => ({ gmtoffset: -3 * 3600, currentTradingPeriod: { regular: {
    start: epoch(`2026-09-${dia}T12:00:00Z`), end: epoch(`2026-09-${dia}T21:00:00Z`),
  } } });
  const locais = (serie) => serie.map((r) => ({ ...r, time: r.time + 3 * 3600 }));
  for (const [instante, formando] of [["2026-09-11T20:00:00Z", true], ["2026-09-11T21:00:00Z", false]]) {
    await noInstante(instante, () => {
      for (const [serie, tf] of [[sexta, diario], [semana, semanal]]) {
        const d = m.parseYahoo(respostaYahoo(locais(serie), sessao("11")), tf);
        assert.equal(d.emFormacao, formando);
        assert.equal(d.closes.length, serie.length - Number(formando));
      }
    });
  }
  await noInstante("2026-09-10T22:00:00Z", () => {
    const quinta = rows("2026-09-10T00:00:00Z");
    assert.equal(m.parseYahoo(respostaYahoo(locais(quinta), sessao("10")), diario).emFormacao, false);
    assert.equal(m.parseYahoo(respostaYahoo(locais(semana), sessao("10")), semanal).emFormacao, true,
      "fechar a quinta nao fecha a semana");
  });
  for (const [instante, formando] of [["2026-09-12T02:00:00Z", true], ["2026-09-12T03:00:00Z", false]]) {
    await noInstante(instante, () => {
      for (const [serie, tf] of [[sexta, diario], [semana, semanal]])
        assert.equal(m.parseYahoo(respostaYahoo(locais(serie), { gmtoffset: -10800 }), tf).emFormacao, formando,
          "fallback respeita a virada do dia no fuso da fonte");
    });
  }
  await noInstante("2026-09-11T12:00:00Z", () => {
    const quinta = rows("2026-09-10T00:00:00Z");
    assert.equal(m.parseYahoo(respostaYahoo(quinta), diario).times.at(-1), quinta.at(-1).time,
      "ausencia de pregao novo nao elimina o fechamento disponivel");
  });
  const cripto = rows("2026-09-12T00:00:00Z");
  Object.assign(cripto.at(-1), { open: 5, high: 5, low: 5, close: 5 });
  for (const [instante, formando] of [["2026-09-12T23:59:59.999Z", true], ["2026-09-13T00:00:00Z", false]]) {
    await noInstante(instante, () => {
      const d = m.parseBinance(respostaBinance(cripto, DIA), diario);
      assert.equal(d.live.time, cripto.at(-1).time, "cripto plana e' valida");
      assert.equal(d.emFormacao, formando, "closeTime e' inclusivo em milissegundos");
      assert.equal(d.times.length, cripto.length - Number(formando));
      const trilho = m.serieParaTrilho(d);
      assert.equal(trilho.length, cripto.length, "cotacao fechada nao duplica o trilho");
      assert.equal(new Set(trilho.map((r) => r.time)).size, trilho.length);
      const usd = m.parseYahoo(respostaYahoo(sexta), diario);
      const completo = m.calcularTrilho(trilho, usd);
      const referencia = cripto.at(formando ? -2 : -1);
      assert.equal(completo.volumeUltimoFechado, referencia.volume);
      assert.equal(completo.volumeUltimoFechadoDia, referencia.time);
    });
  }
  await noInstante("2026-09-13T12:00:00Z", async () => {
    assert.equal(m.parseBinance(respostaBinance(semana, 7 * DIA), semanal).emFormacao, true,
      "a semana cripto continua no domingo");
    const mb = m.parseMercadoBitcoin(JSON.stringify({ t: cripto.map((r) => r.time),
      o: cripto.map((r) => r.open), h: cripto.map((r) => r.high), l: cripto.map((r) => r.low),
      c: cripto.map((r) => r.close), v: cripto.map((r) => r.volume) }), diario);
    assert.equal(mb.times.at(-1), cripto.at(-1).time);
    const resultado = await m.build(mockFetch(), {});
    assert.doesNotMatch(resultado.texto, /FALHA:|NaN|undefined/);
    const j = jsonDe(resultado);
    for (const tf of ["diario", "semanal"]) {
      const b = j[tf]["USD/BRL"];
      assert.equal(b.vela_atual_em_formacao, "nao");
      assert.equal(b.ultimo_fechamento_data, tf === "diario" ? "2026-09-11" : "2026-09-07");
      assert.equal(b.rsi_fechado, b.rsi_provisorio, "nao anexa o mesmo fechamento duas vezes");
      assert.equal(b.di_plus_fechado, b.di_plus_provisorio);
      assert.equal(b.di_minus_fechado, b.di_minus_provisorio);
      assert.equal(b.adx_fechado, b.adx_provisorio);
      assert.deepEqual(b.padrao_em_formacao, []);
      assert.deepEqual(b.divergencia_rsi_provisoria, []);
    }
    assert.equal(j.diario["USDT/BRL"].vela_atual_em_formacao, "sim");
    const a = m.alertasTecnicos({ niveis: { resistencia: 100, suporte: 98,
      resistenciaLabel: "100", suporteLabel: "98", faixas: [] } }, {
      opens: [99], closes: [99], emFormacao: false,
      live: { open: 99, high: 101, low: 97, close: 99 },
    }, { rsi: null, adx: null, adxAnt: null });
    assert.ok(!a.some((x) => /intradiario/.test(x)), "sombra de pregao encerrado nao e' toque intradiario novo");
  });
  await noInstante("2026-09-14T12:00:00Z", async () => {
    const fonte = mockFetch();
    const semSemanaNova = async (url) => {
      const res = await fonte(url);
      if (!url.includes("binance") || !url.includes("interval=1w")) return res;
      const velas = JSON.parse(await res.text()).slice(0, -1);
      return { ok: true, text: async () => JSON.stringify(velas) };
    };
    const r = jsonDe(await m.build(semSemanaNova, {}));
    const s = r.semanal["USDT/BRL"];
    assert.equal(s.vela_atual_em_formacao, "nao");
    assert.equal(s.ultimo_fechamento_data, "2026-09-07");
    assert.equal(s.volume_semana_dias_fechados, 7);
    // Volumes diarios do mock: 1000+i. A semana encerrada soma i=162..168;
    // a base usa as oito anteriores (i=106..161), sem incluir a propria.
    assert.equal(s.volume_semana_soma_dias_fechados, 7 * 1165);
    assert.equal(s.volume_semanas_anteriores_mesmos_dias_media, 7 * 1133.5);
    assert.equal(s.volume_semana_semanas_comparadas, 8);
  });
});


await teste("estado e historico persistidos excluem o pregao fantasma do cambio", () => {
  const ler = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const estado = JSON.parse(ler("./docs/estado.json"));
  const ehFimDeSemana = (time) => Number.isFinite(time) &&
    [0, 6].includes(new Date(time * 1000).getUTCDay());
  for (const [chave, nivel] of Object.entries(estado.niveis || {})) {
    if (!chave.startsWith("usd|diario|")) continue;
    for (const campo of ["atualizado", "dataRompimento", "ultimoContato"])
      assert.ok(!ehFimDeSemana(nivel[campo]), chave + " " + campo + " precisa ser pregao");
    for (const transicao of nivel.historico || [])
      assert.ok(!ehFimDeSemana(epoch(transicao.split("@")[1] + "T00:00:00Z")),
        chave + " nao pode conservar transicao de fim de semana");
  }
  for (const z of estado.zonas?.["usd|diario"] || [])
    assert.ok(!ehFimDeSemana(z.ultimaVelaAvaliada), "zona diaria precisa de avaliacao em pregao");
  const linhas = (path) => ler(path).trim().split("\n").filter(Boolean).map(JSON.parse);
  const historico = linhas("./docs/historico.jsonl");
  const invalidados = linhas("./docs/historico-invalidado.jsonl");
  const chave = (e) => JSON.stringify([e.em, e.par, e.tf]);
  const idsInvalidos = new Set(invalidados.map(chave));
  for (const e of historico) {
    assert.ok(!idsInvalidos.has(chave(e)), "snapshot invalidado nao pode voltar para a medicao");
    if (e.par === "USD/BRL" && e.tf === "diario")
      assert.ok(!ehFimDeSemana(epoch(e.vela + "T00:00:00Z")),
        "historico do cambio nao pode contar domingo como vela fechada");
  }
});

await teste("USD restaurado nao cria reteste ao atravessar o fim de semana", async () => {
  const cfg = m.PARES_TESTE.find((p) => p.key === "usd");
  const nivel = cfg.niveis.suporte;
  const rotulo = cfg.niveis.suporteLabel;
  const chave = m.chaveNivel("usd", "diario", nivel);
  const sexta = epoch("2026-09-11T00:00:00Z");
  const rows = [];
  for (let t = sexta; rows.length < 120; t -= DIA) {
    if ([0, 6].includes(new Date(t * 1000).getUTCDay())) continue;
    const close = nivel - .03 + .001 * Math.sin(rows.length);
    rows.unshift({ time: t, open: close, high: close + .02, low: close - .02, close });
  }
  // Estado valido antes do incidente: o reteste ja tinha sido confirmado
  // na quarta. Restaurar isso nao e' motivo para anunciar outra confirmacao.
  let salvo = { niveis: { [chave]: {
    estado: "reteste_confirmado", direcao: "baixa",
    precoRompimento: nivel - .04, dataRompimento: epoch("2026-09-03T00:00:00Z"),
    ultimoContato: epoch("2026-09-09T00:00:00Z"), atualizado: sexta,
    historico: ["reteste_confirmado@2026-09-09"], afastado: false, mudancasNaVela: [],
  } } };
  const falsa = { time: sexta + 2 * DIA, open: nivel - .0038,
    high: nivel - .003, low: nivel - .0038, close: nivel - .003 };
  const fonte = () => {
    const outras = mockFetch();
    return async (url) => {
      if (url.includes("yahoo") && url.includes("interval=1d"))
        return { ok: true, text: async () => respostaYahoo([...rows, falsa]) };
      return outras(url);
    };
  };
  const rodar = async (instante) => noInstante(instante, async () => {
    const entrada = clone(salvo);
    const r = await m.build(fonte(), salvo);
    assert.deepEqual(salvo, entrada, "build nao altera o estado recebido");
    assert.doesNotMatch(r.texto, /FALHA:/);
    salvo = estadoDe(r);
    return jsonDe(r).diario["USD/BRL"];
  });
  for (let i = 0; i < 2; i++) {
    const b = await rodar("2026-09-14T12:00:00Z");
    assert.equal(b.ultimo_fechamento_data, "2026-09-11", "domingo continua fora das fechadas");
    assert.equal(salvo.niveis[chave].estado, "reteste_confirmado");
    assert.equal(salvo.niveis[chave].ultimoContato, epoch("2026-09-09T00:00:00Z"));
    assert.deepEqual(b.niveis_mudancas_nesta_vela, [], "restauracao e retry nao criam evento");
  }
  const adicionar = (dia, close, high = nivel - .02) => rows.push({
    time: epoch(dia + "T00:00:00Z"), open: nivel - .03,
    high: Math.max(high, close), low: nivel - .05, close,
  });
  adicionar("2026-09-14", nivel - .03);
  const segunda = await rodar("2026-09-15T12:00:00Z");
  assert.equal(segunda.ultimo_fechamento_data, "2026-09-14");
  assert.equal(salvo.niveis[chave].estado, "reteste_confirmado");
  assert.deepEqual(segunda.niveis_mudancas_nesta_vela, [],
    "fechamento novo sem contato nao confirma um reteste inexistente");
  adicionar("2026-09-15", nivel);
  const terca = await rodar("2026-09-16T12:00:00Z");
  assert.ok(terca.niveis_mudancas_nesta_vela.includes("em_reteste_" + rotulo),
    "um contato real posterior continua gerando evento");
  adicionar("2026-09-16", nivel - .03);
  const quarta = await rodar("2026-09-17T12:00:00Z");
  assert.ok(quarta.niveis_mudancas_nesta_vela.includes("reteste_confirmado_" + rotulo),
    "a confirmacao posterior do reteste real continua disponivel");
});


await teste("rompimento falhado nao suprime a leitura de pullback", () => {
  const cfg = { ...m.PARES_TESTE[0],
    niveis: { resistencia: 200, resistenciaLabel: "200", suporte: 50, suporteLabel: "50", faixas: [] } };
  // Preco parado longe dos dois niveis: nada aqui gera rompimento por si.
  const d = { live: { close: 100 }, closes: [100, 100], opens: [100, 100],
    highs: [101, 101], lows: [99, 99], times: [1, 2] };
  const ind = { volume: { vsMediaPct: 0, tendencia: "decrescente" }, divergencias: [],
    estruturaEventos: [], enfraquecimento: [], padroes: [], estruturaTendencia: "alta" };
  const pullback = (mudancasNivel) =>
    m.alertasTecnicos(cfg, d, { ...ind, mudancasNivel }).includes("pullback_com_volume_decrescente");

  // "rompimento_" casa por prefixo com "rompimento_falhou_", que e' o
  // OPOSTO de um rompimento: o preco voltou para o lado de origem. Nessa
  // vela -- estrutura de alta, volume caindo, tentativa rejeitada --
  // pullback e' justamente a descricao correta.
  assert.equal(pullback(["rompimento_falhou_200"]), true,
    "rompimento falhado descreve um pullback, nao um rompimento");
  assert.equal(pullback([]), true, "sem evento nenhum a leitura sai normalmente");
  // Candidato e' rompimento acontecendo: continua suprimindo.
  assert.equal(pullback(["rompimento_candidato_200"]), false,
    "rompimento em curso nao e' pullback tranquilo");
  // Os demais rotulos da maquina nunca comecaram com "rompimento_".
  for (const rotulo of ["rompido", "em_reteste", "reteste_confirmado", "recuperado", "arquivado"])
    assert.equal(pullback([`${rotulo}_200`]), true, `${rotulo} nao suprime`);

  // E o rompimento de verdade, vindo do proprio nivel, continua suprimindo
  // nas tres formas: forte, fraca e intradiaria.
  const alerta = (dd) => m.alertasTecnicos({ ...m.PARES_TESTE[0],
    niveis: { resistencia: 100, resistenciaLabel: "100", suporte: null, faixas: [] } }, dd, ind);
  for (const [nome, dd] of [
    ["forte", { live: { close: 103 }, closes: [95, 103], opens: [95, 101], highs: [96, 104], lows: [94, 100], times: [1, 2] }],
    ["fraco", { live: { close: 101 }, closes: [95, 101], opens: [95, 99], highs: [96, 102], lows: [94, 98], times: [1, 2] }],
    ["intradiario", { live: { close: 101 }, closes: [95, 95], opens: [95, 95], highs: [96, 96], lows: [94, 94], times: [1, 2] }],
  ]) {
    const a = alerta(dd);
    assert.ok(a.some((x) => x.startsWith("rompimento_")), `${nome}: a fixture precisa mesmo romper`);
    assert.ok(!a.includes("pullback_com_volume_decrescente"), `${nome} continua suprimindo o pullback`);
  }
});

await teste("estrutura: novidade pertence a confirmacao do pivo, nao aos fechamentos seguintes", () => {
  for (const tf of m.TIMEFRAMES_TESTE) for (const lado of ["topo", "fundo"]) {
    const n = 155, times = Array.from({ length: n }, (_, i) => 1704067200 + i * tf.segundos);
    const highs = Array(n).fill(110), lows = Array(n).fill(100);
    const valores = lado === "topo" ? [120, 115, 125] : [90, 95, 85];
    [110, 125, 140].forEach((idx, j) => (lado === "topo" ? highs : lows)[idx] = valores[j]);
    const dados = (fim) => ({ times: times.slice(0, fim), highs: highs.slice(0, fim), lows: lows.slice(0, fim),
      opens: Array(fim).fill(105), closes: Array(fim).fill(105), volumes: Array(fim).fill(100),
      live: { time: times[fim], open: 105, high: 110, low: 100, close: 105, volume: 10 } });
    const cfg = { ...m.PARES_TESTE[0], niveis: { faixas: [], resistencia: null, suporte: null } };
    const fim = 141 + tf.pivos.dir;
    const evento = lado === "topo" ? "novo_HH_apos_topo_mais_baixo" : "perda_estrutura_alta_novo_LL";
    const campo = (r) => r.texto.match(/^estrutura_eventos: (.*)$/m)[1];
    const atual = m.readPair(cfg, dados(fim), tf);
    assert.ok(campo(atual).includes(evento), `${tf.key}: confirma nesta vela`);
    assert.equal(campo(m.readPair(cfg, dados(fim), tf)), campo(atual), "retry mantem o evento da mesma vela");
    assert.equal(campo(m.readPair(cfg, dados(fim + 1), tf)), "nenhum", "sem pivo novo, sem repetir evento antigo");
  }
});

await teste("empates de estrutura nao produzem baixa nem deterioracao por baixa", () => {
  for (const [highs, lows, rotulo] of [
    [[110, 110], [90, 90], "EH_EL"], [[110, 110], [90, 95], "EH_HL"],
    [[110, 110], [95, 90], "EH_LL"], [[110, 120], [90, 90], "HH_EL"],
    [[120, 110], [90, 90], "LH_EL"],
  ]) {
    const e = m.classificarEstrutura(highs, lows, { altos: [0, 1], baixos: [0, 1] });
    assert.equal(e.tendencia, "lateral_empate"); assert.equal(e.rotulo, rotulo);
    const s = m.sinteses({ alertas: [], estrutura: e, estruturaEventos: [], divergencias: [],
      enfraquecimento: [], fraqueza: [], rsiFech: null, rsiAnt: null, diPlus: null, diMinus: null });
    assert.doesNotMatch(s.deterioracao, /estrutura_de_baixa/);
  }
  assert.equal(m.classificarEstrutura([110, null], [90, 90], { altos: [0, 1], baixos: [0, 1] }).tendencia, "indefinida");
});

await teste("retomada dos niveis equivale ao processamento vela a vela", () => {
  for (const tf of m.TIMEFRAMES_TESTE) {
    const cfg = { ...m.PARES_TESTE[0], niveis: { resistencia: 100, resistenciaLabel: "100", suporte: null, faixas: [] } };
    const chave = `${cfg.key}|${tf.key}|100`;
    const closes = [...Array(150).fill(106), 90, 106, 106];
    const dados = (n) => ({ times: Array.from({ length: n }, (_, i) => 1704067200 + i * tf.segundos),
      opens: closes.slice(0, n), closes: closes.slice(0, n), highs: closes.slice(0, n).map(x => x + 5),
      lows: closes.slice(0, n).map(x => x - 5), volumes: Array(n).fill(100),
      live: { time: 1704067200 + n * tf.segundos, open: 106, high: 111, low: 101, close: 106, volume: 10 } });
    const inicial = m.readPair(cfg, dados(150), tf).estadoNiveis;
    const falhou = m.readPair(cfg, dados(151), tf, { estadoNiveis: inicial });
    assert.equal(falhou.estadoNiveis[chave].estado, "rompimento_falhou");
    const recuperou = m.readPair(cfg, dados(152), tf, { estadoNiveis: falhou.estadoNiveis });
    const retomou = m.readPair(cfg, dados(152), tf, { estadoNiveis: inicial });
    assert.equal(retomou.estadoNiveis[chave].estado, "recuperado");
    assert.deepEqual(retomou.estadoNiveis, recuperou.estadoNiveis, "mesmo ATR historico e mesmas transicoes");
    assert.deepEqual(m.readPair(cfg, dados(152), tf, { estadoNiveis: retomou.estadoNiveis }).estadoNiveis,
      retomou.estadoNiveis, "retry nao reaplica transicoes");
    const tarde = m.readPair(cfg, dados(153), tf, { estadoNiveis: inicial });
    assert.equal(tarde.estadoNiveis[chave].estado, "recuperado");
    assert.match(tarde.texto, /^niveis_mudancas_nesta_vela: nenhuma$/m, "recuperacao anterior nao vira evento atual");
    assert.ok(tarde.estadoNiveis[chave].historico.some(x => x.startsWith("recuperado@")), "historico reconstruido");
  }
});

await teste("falha de fonte nao avanca o carimbo de vela processada", async () => {
  await noInstante("2026-09-10T12:00:00Z", async () => {
    const bom = await m.build(mockFetch(), {});
    assert.doesNotMatch(bom.texto, /FALHA:/);
    const salvo = estadoDe(bom);
    const carimbos = salvo.ultimaVelaProcessada;
    assert.ok(Object.keys(carimbos).length > 0, "o carimbo e' gravado por par e timeframe");
    for (const [chave, valor] of Object.entries(carimbos))
      assert.ok(Number.isFinite(valor) && valor > 0, `${chave} carimbado com vela valida`);

    // Fonte fora do ar: o carimbo anterior tem de sobreviver intacto. Se
    // avancasse, a proxima execucao bem-sucedida pularia as velas que
    // esta aqui nao chegou a ler -- exatamente o buraco que o campo
    // existe para fechar.
    const caiu = await m.build(async () => ({ ok: false, status: 503 }), clone(salvo));
    assert.match(caiu.texto, /FALHA:/, "a fixture precisa mesmo falhar");
    assert.deepEqual(caiu.ultimaVelaProcessada, carimbos,
      "par que falhou mantem o carimbo anterior");

    // Reexecucao com a fonte de volta nao pode recuar o carimbo.
    const voltou = await m.build(mockFetch(), clone(estadoDe(caiu)));
    for (const [chave, valor] of Object.entries(voltou.ultimaVelaProcessada))
      assert.ok(valor >= carimbos[chave], `${chave} nunca anda para tras`);
  });

  // Resposta ATRASADA da fonte: o mock e' preso ao relogio, entao voltar
  // o relogio devolve velas mais antigas -- o equivalente a um cache
  // velho respondendo. O carimbo nao pode recuar por isso: se recuasse,
  // a execucao seguinte reprocessaria velas ja aplicadas.
  const adiantado = estadoDe(await noInstante("2026-09-20T12:00:00Z",
    () => m.build(mockFetch(), {})));
  const atrasado = await noInstante("2026-09-13T12:00:00Z",
    () => m.build(mockFetch(), clone(adiantado)));
  for (const [chave, valor] of Object.entries(adiantado.ultimaVelaProcessada))
    assert.equal(atrasado.ultimaVelaProcessada[chave], valor,
      `${chave}: resposta atrasada nao recua o carimbo`);
  assert.match(atrasado.texto, /FALHA:.*serie desatualizada/);
  assert.deepEqual(estadoDe(atrasado), adiantado, "fonte antiga preserva TODA a memoria");
  assert.deepEqual(atrasado.gatilhos, [], "fonte antiga nao alimenta gatilhos");
  assert.equal(m.registrarHistorico(jsonDe(atrasado)).entradas.length, 0);
  assert.ok(Object.values(atrasado.zonas).every((zs) => zs.length === 0),
    "zonas antigas nao sao apresentadas como recalculadas agora");

  // E o carimbo precisa CHEGAR ao readPair, nao so ser gravado. Aqui o
  // estado guarda o carimbo mas nenhum registro de nivel -- o caso do
  // nivel que nunca rompeu enquanto o monitor rodava. Com tres dias de
  // interrupcao, a retomada tem de reconstruir o ciclo desde a vela em
  // que ele comecou; sem o carimbo, o registro nasce na ultima vela.
  //
  // A comparacao e' por DATA, nao pelo estado inteiro: o mock deriva o
  // preco do indice dentro da janela, entao a mesma data muda de preco
  // conforme a janela desliza. A equivalencia exata do replay esta
  // provada no teste de readPair, com serie estavel.
  const semRegistros = clone(estadoDe(await noInstante("2026-09-10T12:00:00Z",
    () => m.build(mockFetch(), {}))));
  semRegistros.niveis = {};
  assert.ok(Object.keys(semRegistros.ultimaVelaProcessada).length > 0);
  await noInstante("2026-09-13T12:00:00Z", async () => {
    const com = await m.build(mockFetch(), clone(semRegistros));
    const semCarimbo = clone(semRegistros);
    delete semCarimbo.ultimaVelaProcessada;
    const sem = await m.build(mockFetch(), semCarimbo);
    const chaves = Object.keys(com.estadoNiveis);
    assert.ok(chaves.length > 0, "a fixture precisa mesmo abrir registro");
    let reconstruiu = 0;
    for (const chave of chaves) {
      const c = com.estadoNiveis[chave];
      assert.ok(c.dataRompimento <= c.atualizado);
      if (c.dataRompimento < c.atualizado) reconstruiu++;
      const s = sem.estadoNiveis[chave];
      if (s) assert.equal(s.dataRompimento, s.atualizado,
        "sem carimbo o registro nasce na ultima vela, sem historia");
    }
    assert.ok(reconstruiu > 0,
      "com carimbo, ao menos um nivel volta com o rompimento na vela original");
  });
});

await teste("carimbo de vela processada retoma nivel que nunca abriu registro", () => {
  for (const tf of m.TIMEFRAMES_TESTE) {
    const cfg = { ...m.PARES_TESTE[0],
      niveis: { resistencia: 100, resistenciaLabel: "100", suporte: null, faixas: [] } };
    const chave = `${cfg.key}|${tf.key}|100`;
    // 150 velas longe do nivel, depois rompe, retesta e confirma. Nada
    // disso abre registro antes do rompimento: e' o caso em que o nivel
    // NAO tem estado proprio e, sem o carimbo, o replay nao tinha de onde
    // partir -- a interrupcao engolia o ciclo inteiro.
    const closes = [...Array(150).fill(90), 106, 106, 101, 106];
    const times = (n) => Array.from({ length: n }, (_, i) => 1704067200 + i * tf.segundos);
    const dados = (n) => ({ times: times(n), opens: closes.slice(0, n), closes: closes.slice(0, n),
      highs: closes.slice(0, n).map((x) => x + 5), lows: closes.slice(0, n).map((x) => x - 5),
      volumes: Array(n).fill(100),
      live: { time: 1704067200 + n * tf.segundos, open: 106, high: 111, low: 101, close: 106, volume: 10 } });
    const base = m.readPair(cfg, dados(150), tf);
    assert.equal(Object.keys(base.estadoNiveis).length, 0, "o nivel ainda nao abriu registro");
    assert.equal(base.ultimaVelaFechada, times(150).at(-1), "o carimbo e' a ultima vela FECHADA");

    // Verdade: vela a vela.
    let verdade = {};
    for (let n = 151; n <= 154; n++)
      verdade = m.readPair(cfg, dados(n), tf, { estadoNiveis: verdade }).estadoNiveis;

    // Buraco de 4 velas, retomado pelo carimbo.
    const comCarimbo = m.readPair(cfg, dados(154), tf,
      { estadoNiveis: {}, ultimaVelaProcessada: base.ultimaVelaFechada });
    assert.deepEqual(comCarimbo.estadoNiveis, verdade, "o carimbo reconstroi o ciclo inteiro");
    assert.equal(comCarimbo.estadoNiveis[chave].estado, "reteste_confirmado");
    // A retomada anuncia EXATAMENTE o que a rota vela a vela anunciaria
    // nesta vela: nem a mais, nem a menos.
    const linha = (t) => (t.match(/^niveis_mudancas_nesta_vela: .*$/m) || [])[0];
    let ate153 = {};
    for (let n = 151; n <= 153; n++)
      ate153 = m.readPair(cfg, dados(n), tf, { estadoNiveis: ate153 }).estadoNiveis;
    assert.equal(linha(comCarimbo.texto),
      linha(m.readPair(cfg, dados(154), tf, { estadoNiveis: ate153 }).texto),
      "a transicao que cai NA ultima vela continua sendo noticia");

    // E quando o ciclo se fecha ANTES da ultima vela, nada e' anunciado:
    // e' o ponto todo do carimbo -- recuperar o estado sem ressuscitar a
    // noticia. Uma vela parada a mais depois da confirmacao.
    const paradas = [...closes, 106];
    const dadosP = (n) => ({ ...dados(n), opens: paradas.slice(0, n), closes: paradas.slice(0, n),
      highs: paradas.slice(0, n).map((x) => x + 5), lows: paradas.slice(0, n).map((x) => x - 5) });
    const tarde = m.readPair(cfg, dadosP(155), tf,
      { estadoNiveis: {}, ultimaVelaProcessada: base.ultimaVelaFechada });
    assert.equal(tarde.estadoNiveis[chave].estado, "reteste_confirmado", "o estado foi recuperado");
    assert.match(tarde.texto, /^niveis_mudancas_nesta_vela: nenhuma$/m,
      "ciclo fechado durante a interrupcao nao e' anunciado como novo");

    // SEM carimbo -- primeira execucao, ou estado gravado antes do campo
    // existir -- continua estabelecendo baseline so na ultima vela.
    const semCarimbo = m.readPair(cfg, dados(154), tf, { estadoNiveis: {} });
    assert.deepEqual(semCarimbo.estadoNiveis[chave].historico, [],
      "sem carimbo nao reconstroi historia: migracao nao inventa ciclo");
    assert.equal(semCarimbo.estadoNiveis[chave].dataRompimento, times(154).at(-1),
      "sem carimbo o baseline nasce na ultima vela, como antes deste campo existir");
    assert.notDeepEqual(semCarimbo.estadoNiveis, comCarimbo.estadoNiveis,
      "e o carimbo precisa mesmo fazer diferenca neste cenario");
    // Carimbo velho demais para esta janela tambem volta ao baseline.
    for (const fora of [1, times(154)[0] - tf.segundos, NaN, null])
      assert.deepEqual(m.readPair(cfg, dados(154), tf,
        { estadoNiveis: {}, ultimaVelaProcessada: fora }).estadoNiveis, semCarimbo.estadoNiveis,
        `carimbo fora da janela (${fora}) volta ao comportamento de baseline`);
    assert.throws(() => m.readPair(cfg, dados(154), tf,
      { ultimaVelaProcessada: times(154).at(-1) + tf.segundos }), /serie desatualizada/,
      "carimbo FUTURO e' resposta atrasada, nunca primeira execucao");

    // Com registro proprio, quem manda continua sendo o estado do nivel:
    // um carimbo atrasado nao pode reprocessar velas ja aplicadas.
    const comRegistro = m.readPair(cfg, dados(154), tf,
      { estadoNiveis: verdade, ultimaVelaProcessada: times(154)[100] });
    assert.deepEqual(comRegistro.estadoNiveis, verdade, "retry nao reaplica transicoes");
  }
});

await teste("contato atual impede arquivamento mesmo no vencimento do prazo", () => {
  for (const direcao of ["alta", "baixa"]) {
    const sinal = direcao === "alta" ? 1 : -1;
    const ctx = { nivel: 100, direcao, atr: 10, tolAtr: .25, resetAtr: 1.5, maxCandles: 30, segundos: DIA };
    const vela = (dia, close, low = close - 1, high = close + 1) => ({
      time: 1704067200 + dia * DIA, open: close, close, low, high });
    let e = m.atualizarEstadoNivel(null, { ...ctx, vela: vela(0, 100 + sinal * 6) });
    for (let dia = 1; dia <= 30; dia++) e = m.atualizarEstadoNivel(e, { ...ctx, vela: vela(dia, 100 + sinal * 6) });
    const contato = m.atualizarEstadoNivel(e, { ...ctx, vela: vela(31, 100 + sinal, 99, 101) });
    assert.equal(contato.estado, "em_reteste");
    assert.equal(contato.ultimoContato, 1704067200 + 31 * DIA);
    const arquivado = m.atualizarEstadoNivel(e, { ...ctx, vela: vela(31, 100 + sinal * 6) });
    assert.equal(arquivado.estado, "arquivado", "sem contato, prazo continua valendo");
    const dormente = m.atualizarEstadoNivel(arquivado, { ...ctx, vela: vela(32, 100 + sinal * 6) });
    assert.equal(dormente.atualizado, 1704067200 + 32 * DIA, "vela dormente tambem foi avaliada");
  }
});

if (typeof m.parseYahoo === "function") await teste("Yahoo rejeita OHLC parcial/inconsistente e permite fallback", async () => {
  const times = [];
  for (let i = 0; i < 70; i++) {
    const time = 1704067200 + i * DIA;
    if (![0, 6].includes(new Date(time * 1000).getUTCDay())) times.push(time);
  }
  const q = { open: times.map(() => 5), high: times.map(() => 5.1), low: times.map(() => 4.9), close: times.map(() => 5.05) };
  const resposta = (quote) => JSON.stringify({ chart: { result: [{ timestamp: times,
    meta: { gmtoffset: 0 }, indicators: { quote: [quote] } }] } });
  const tf = m.TIMEFRAMES_TESTE[0];
  for (const campo of ["open", "high", "low", "close"]) for (const valor of [null, 0, "", false, "5.0"]) {
    const ruim = clone(q); ruim[campo][10] = valor;
    assert.throws(() => m.parseYahoo(resposta(ruim), tf), /OHLC/);
  }
  const invertido = clone(q); invertido.low[10] = 6;
  const limpo = m.parseYahoo(resposta(invertido), tf);
  assert.equal(limpo.closes.length, times.length - 1);
  assert.ok(limpo.avisosDados[0].includes(new Date(times[10] * 1000).toISOString().slice(0, 10)));
  const ultimoRuim = clone(q); ultimoRuim.low[times.length - 1] = 6;
  assert.throws(() => m.parseYahoo(resposta(ultimoRuim), tf), /mais recente.*inconsistente/);
  const duplicado = JSON.parse(resposta(q));
  const dup = duplicado.chart.result[0];
  dup.timestamp.push(times.at(-1) + 3600);
  for (const [campo, xs] of Object.entries(dup.indicators.quote[0])) xs.push(q[campo].at(-1));
  dup.indicators.quote[0].close[times.length - 1] = null;
  const deduplicado = m.parseYahoo(JSON.stringify(duplicado), tf);
  assert.equal(deduplicado.closes.length, times.length);
  assert.equal(deduplicado.live.close, 5.05, "cotacao valida mais nova substitui a parcial do mesmo dia");
  dup.indicators.quote[0].close[times.length] = null;
  assert.throws(() => m.parseYahoo(JSON.stringify(duplicado), tf), /incompleto/, "cotacao mais nova incompleta nao e' ocultada");
  const ausente = clone(q); Object.values(ausente).forEach(xs => xs[10] = null);
  assert.equal(m.parseYahoo(resposta(ausente), tf).closes.length, times.length - 1, "sessao toda ausente e' ignorada");
  const ruim = clone(q); ruim.low[10] = null;
  const cfg = { fontes: [
    { nome: "primaria", url: () => "primeira", parse: m.parseYahoo },
    { nome: "reserva", url: () => "segunda", parse: m.parseYahoo },
  ] };
  const r = await m.buscarSerie(async url => ({ ok: true, text: async () => resposta(url === "primeira" ? ruim : q) }), cfg, tf);
  assert.equal(r.ok, true); assert.equal(r.fonte, "reserva");
  assert.ok(r.parsed.lows.every(x => x === 4.9));
  const falha = await m.buscarSerie(async () => ({ ok: true, text: async () => resposta(ruim) }), cfg, tf);
  assert.equal(falha.ok, false); assert.match(falha.erro, /primaria:.*OHLC.*reserva:.*OHLC/);
});

if (typeof m.parseYahoo === "function") await teste("barra de fim de semana nao derruba a resposta do cambio", () => {
  const diario = m.TIMEFRAMES_TESTE.find((t) => t.key === "diario");
  // Serie de pregoes validos + UMA barra de sabado inconsistente no fim.
  // O sabado e' a ultima linha da resposta, entao so o filtro de calendario
  // DENTRO do parser impede que ele seja tratado como "a cotacao mais
  // recente" -- e a regra do candle recente inconsistente derrubaria a
  // fonte inteira. O descarte de jusante (ignorarFimDeSemana em
  // montarSerie) nao alcanca essa decisao: quando ele roda, a excecao ja
  // teria sido lancada. E' a mesma familia do incidente da vela falsa de
  // domingo, do outro lado do parser.
  const uteis = [];
  let t = epoch("2026-09-11T00:00:00Z");
  while (uteis.length < 120) {
    const dow = new Date(t * 1000).getUTCDay();
    if (dow !== 0 && dow !== 6) uteis.unshift(t);
    t -= DIA;
  }
  const rows = uteis.map((time, i) => ({ time,
    open: 5 + i * .001, high: 5.03 + i * .001, low: 4.97 + i * .001, close: 5.01 + i * .001 }));
  const sabado = epoch("2026-09-12T00:00:00Z");
  assert.equal(new Date(sabado * 1000).getUTCDay(), 6, "a fixture precisa mesmo cair num sabado");
  const comSabado = [...rows, { time: sabado, open: 9.9, high: 9.0, low: 9.8, close: 9.5 }];
  const d = m.parseYahoo(respostaYahoo(comSabado), diario);
  assert.equal(d.closes.length, rows.length, "o sabado nao entra na serie");
  assert.equal(d.times.at(-1), rows.at(-1).time, "a ultima vela continua sendo a sexta");
  assert.equal(d.avisosDados.length, 0,
    "barra de fim de semana e' calendario, nao outlier historico: nao vira aviso");
  // E um sabado BEM formado tambem nao entra, nem vira a cotacao mais recente.
  const sabadoBom = [...rows, { time: sabado, open: 9.0, high: 9.2, low: 8.9, close: 9.1 }];
  const e = m.parseYahoo(respostaYahoo(sabadoBom), diario);
  assert.equal(e.times.at(-1), rows.at(-1).time, "sabado valido tambem fica de fora");
});

await teste("fonte antiga nao promove nem recua zonas, inclusive sem carimbo global", () => {
  const tf = m.TIMEFRAMES_TESTE[0];
  const cfg = { ...m.PARES_TESTE[0], niveis: { faixas: [], resistencia: null, suporte: null } };
  const dados = (n) => {
    const closes = Array.from({ length: n }, (_, i) =>
      100 + i * .014 + 9 * Math.sin(i * .29) + 3 * Math.sin(i * .077));
    return { closes, opens: closes.map((c, i) => closes[i - 1] ?? c),
      highs: closes.map((c, i) => Math.max(c, closes[i - 1] ?? c) + .7),
      lows: closes.map((c, i) => Math.min(c, closes[i - 1] ?? c) - .7),
      times: closes.map((_, i) => 1704067200 + i * tf.segundos),
      volumes: closes.map(() => 1000), temVolume: true,
      live: { open: closes.at(-1), close: closes.at(-1), high: closes.at(-1) + 1,
        low: closes.at(-1) - 1, volume: 500, time: 1704067200 + n * tf.segundos } };
  };
  const recente = m.readPair(cfg, dados(165), tf);
  const zonas = recente.zonasEstadoPar.map(m.zonaParaEstado);
  assert.ok(zonas.some((z) => z.status === "candidata" && z.velasComScoreAlto === 1),
    "fixture reproduz candidata que a resposta antiga promovia");
  const salvo = clone(zonas);
  const ctx = { zonasAnteriores: zonas, proximoId: recente.proximoIdZona };
  assert.throws(() => m.readPair(cfg, dados(164), tf, ctx), /serie desatualizada/);
  assert.throws(() => m.calcularZonas(cfg, tf, dados(164), ctx), /serie desatualizada/);
  for (const z of zonas) {
    assert.deepEqual(m.atualizarCiclo({ score: 100 }, z,
      { tfKey: tf.key, ultimaVelaFechada: recente.ultimaVelaFechada - tf.segundos }), z);
  }
  assert.deepEqual(m.reconciliarAnteriores(zonas, [], tf.key,
    recente.ultimaVelaFechada - tf.segundos), zonas.filter((z) => z.status !== "remover"));
  assert.deepEqual(zonas, salvo, "rejeicao nao altera o estado recebido");
  const retomada = m.readPair(cfg, dados(166), tf, {
    ...ctx, proximoIdZona: recente.proximoIdZona, ultimaVelaProcessada: recente.ultimaVelaFechada });
  assert.equal(retomada.ultimaVelaFechada, recente.ultimaVelaFechada + tf.segundos);
});

await teste("reteste e recuperacao sobrevivem ao reset na mesma vela, em ambos os sentidos", () => {
  for (const tf of m.TIMEFRAMES_TESTE) for (const direcao of ["alta", "baixa"]) {
    const alta = direcao === "alta";
    const cfg = { ...m.PARES_TESTE[0], niveis: { faixas: [],
      resistencia: alta ? 100 : null, resistenciaLabel: "100",
      suporte: alta ? null : 100, suporteLabel: "100" } };
    const chave = m.chaveNivel(cfg.key, tf.key, 100);
    const espelho = (r) => alta ? r : ({ open: 200 - r.open,
      high: 200 - r.low, low: 200 - r.high, close: 200 - r.close });
    const inicial = Array.from({ length: 150 }, () => espelho({ open: 104, high: 105, low: 103, close: 104 }));
    const dados = (rs) => ({
      opens: rs.map((r) => r.open), closes: rs.map((r) => r.close),
      highs: rs.map((r) => r.high), lows: rs.map((r) => r.low),
      times: rs.map((_, i) => 1704067200 + i * tf.segundos),
      volumes: rs.map(() => 100), temVolume: true,
      live: { ...rs.at(-1), time: 1704067200 + rs.length * tf.segundos, volume: 50 },
    });
    const opcoes = (r) => ({ estadoNiveis: clone(r.estadoNiveis),
      ultimaVelaProcessada: r.ultimaVelaFechada });
    const base = m.readPair(cfg, dados(inicial), tf);
    for (const recuperacao of [false, true]) {
      const rs = recuperacao ? [...inicial, espelho({ open: 96, high: 97, low: 95, close: 96 })] : inicial;
      const antes = recuperacao ? m.readPair(cfg, dados(rs), tf, opcoes(base)) : base;
      const comReacao = [...rs, espelho({ open: 102, high: 110, low: 99, close: 108 })];
      const agora = m.readPair(cfg, dados(comReacao), tf, opcoes(antes));
      const e = agora.estadoNiveis[chave];
      const tipo = recuperacao ? "recuperado" : "reteste_confirmado";
      assert.equal(e.estado, "rompido", "reset por afastamento continua operacional");
      assert.equal(e.afastado, true);
      assert.deepEqual(e.mudancasNaVela, [tipo + "_100"], "evento real, sem rompimento artificial");
      assert.ok(e.historico.some((h) => h.startsWith(tipo + "@")));
      assert.match(agora.texto, new RegExp("^niveis_mudancas_nesta_vela: " + tipo + "_100$", "m"));
      assert.equal(m.leituraCurta({ nivel_100_estado: e.estado,
        niveis_mudancas_nesta_vela: e.mudancasNaVela }, cfg).chave, tipo);
      if (!recuperacao && alta)
        assert.match(agora.texto, /^confluencia_entrada: .*reteste_confirmado/m);
      const retry = m.readPair(cfg, dados(comReacao), tf, opcoes(agora));
      assert.deepEqual(retry.estadoNiveis, agora.estadoNiveis, "retry conserva o evento");
      const replay = m.readPair(cfg, dados(comReacao), tf, opcoes(base));
      assert.deepEqual(replay.estadoNiveis, agora.estadoNiveis, "replay preserva a mesma transicao");
      const seguinte = m.readPair(cfg, dados([...comReacao,
        espelho({ open: 108, high: 109, low: 107, close: 108 })]), tf, opcoes(agora));
      assert.deepEqual(seguinte.estadoNiveis[chave].mudancasNaVela, []);
    }
  }
});

await teste("velas inteiras do lado contrario nao renovam contato nem acordam nivel arquivado", () => {
  for (const direcao of ["alta", "baixa"]) {
    const alta = direcao === "alta";
    const ctx = { nivel: 100, direcao, atr: 4, tolAtr: .25, resetAtr: 1.5,
      maxCandles: 30, segundos: DIA };
    const vela = (dia, p) => ({ time: 1704067200 + dia * DIA,
      open: p, close: p, high: p + 1, low: p - 1 });
    let e = m.atualizarEstadoNivel(null, { ...ctx, vela: vela(0, alta ? 104 : 96) });
    const contatoInicial = e.ultimoContato;
    for (let dia = 1; dia <= 50; dia++) {
      e = m.atualizarEstadoNivel(e, { ...ctx, vela: vela(dia, alta ? 90 : 110) });
      assert.equal(e.ultimoContato, contatoInicial);
      assert.equal(e.estado, dia <= 30 ? "rompimento_falhou" : "arquivado");
    }
    const acordou = m.atualizarEstadoNivel(e, { ...ctx,
      vela: { ...vela(51, alta ? 104 : 96), low: alta ? 99 : 95, high: alta ? 105 : 101 } });
    assert.equal(acordou.estado, "reteste_confirmado");
    assert.equal(acordou.ultimoContato, 1704067200 + 51 * DIA);
    // A fronteira da tolerancia conta como contato, mesmo sem penetrar
    // o ponto; um gap logo fora dela nao conta.
    const limite = m.atualizarEstadoNivel(e, { ...ctx,
      vela: vela(51, alta ? 98 : 102) });
    assert.notEqual(limite.estado, "arquivado");
    const fora = m.atualizarEstadoNivel(e, { ...ctx,
      vela: vela(51, alta ? 97.99 : 102.01) });
    assert.equal(fora.estado, "arquivado");
  }
});

await teste("historico exclui condicoes intradiarias em vez de antecipar seu preco de entrada", () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-historico-fechado-"));
  try {
    mkdirSync(join(dir, "docs"));
    const intradiarias = ["rompimento_intradiario_80000", "toque_suporte_intradiario_70000",
      "faixa_compra", "regiao_suporte_1", "pullback_com_volume_decrescente", "nome_novo"];
    const rows = Array.from({ length: 8 }, (_, i) => ({
      par: "BTC/USD", tf: "diario", vela: `2026-09-${String(10 + i).padStart(2, "0")}`,
      em: `2026-09-${String(11 + i).padStart(2, "0")}T16:33:19Z`,
      fech: 76354.8 + i * 4500, atr: 1000,
      alertas: [...intradiarias, "rompimento_confirmado_80000",
        "divergencia_bullish_regular_confirmada", "recuperado_80000"],
      deterioracao: [], conf_entrada: [], conf_pullback: [], niveis_mud: ["recuperado_80000"],
      estrutura: "alta", ema89_cruz: "nenhum",
    }));
    writeFileSync(join(dir, "docs/historico.jsonl"),
      [...rows, ...rows].map((r) => JSON.stringify(r)).join("\n"));
    const script = fileURLToPath(new URL("./analisar-historico.mjs", import.meta.url));
    const executar = (h) => spawnSync(process.execPath, [script, h], { cwd: dir, encoding: "utf8" });
    const r = executar("1");
    assert.equal(r.status, 0, r.stderr);
    for (const a of intradiarias) assert.ok(!r.stdout.includes("alerta:" + a), a);
    assert.match(r.stdout, /excluidas: 48 observacoes/);
    assert.match(r.stdout, /alerta:rompimento_confirmado_80000\s+7\s+4\.50\s+100%/);
    assert.match(r.stdout, /alerta:divergencia_bullish_regular_confirmada\s+7\s+4\.50\s+100%/);
    assert.match(r.stdout, /nivel:recuperado_80000\s+7\s+4\.50\s+100%/);
    assert.match(r.stdout, /TODAS AS VELAS \(referencia\)\s+7\s+4\.50\s+100%/);
    for (const h of ["0", "-1", "1.5", "abc", "Infinity"])
      assert.equal(executar(h).status, 1, "horizonte invalido: " + h);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

assert.equal(falhas, 0, `${falhas} de ${grupos} grupos de regressao falharam`);
console.log(`${grupos} grupos de regressao passaram.`);
