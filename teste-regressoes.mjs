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
  assert.ok(alertas({ ...viva, opens: [101], closes: [103] }, 60).includes("rompimento_com_volume_acima_da_media"));
  assert.ok(alertas({ ...viva, opens: [99], closes: [103] }, 60).includes("rompimento_com_volume_acima_da_media"));
  assert.ok(alertas({ ...viva, opens: [99], closes: [97] }, 60, true).includes("queda_com_expansao_de_volume"));
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
const estadoDe = (r) => clone({ ema89Semanal: r.estadoEma89Semanal, niveis: r.estadoNiveis, zonas: r.zonasEstado, contadoresZona: r.contadoresZona });
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
      fech, atr: 1, alertas: ["constante"], deterioracao: [], conf_entrada: [],
      ema89_confirmacao: "acima", ema89_evento_id: `${par}|${tf}|${i}`,
      conf_pullback: [], niveis_mud: [], estrutura: "alta", ema89_cruz: "nenhum" }));
    const rows = [];
    for (const [par, tf] of [["P/Q", "diario"], ["R/Q", "diario"], ["P/Q", "semanal"]]) {
      for (const e of serie(par, tf)) {
        rows.push(e, { ...e, alertas: ["constante", "posterior"] });
        if (e.vela === "2026-01-01") for (let i = 0; i < 10; i++) rows.push(e);
      }
    }
    const texto = medir(rows);
    for (const [par, tf] of [["P/Q", "diario"], ["R/Q", "diario"], ["P/Q", "semanal"]])
      for (const condicao of ["alerta:constante", "alerta:posterior", "ema89_confirmou=acima", "TODAS AS VELAS (referencia)"]) {
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

assert.equal(falhas, 0, `${falhas} de ${grupos} grupos de regressao falharam`);
console.log(`${grupos} grupos de regressao passaram.`);
