import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { atualizarTravessiaEma89, acompanharTravessiaEma89, camposTravessiaEma89 } from "./ema89-semanal.mjs";
import { build, relatorioParaJSON, PARES_TESTE } from "./monitor.mjs";

const SEMANA = 604800;
const T = Date.parse("2026-08-03T00:00:00Z") / 1000;
const clone = (x) => JSON.parse(JSON.stringify(x));
let grupos = 0;
async function teste(nome, fn) { await fn(); grupos++; console.log(`OK EMA89: ${nome}`); }
const vela = (semana, close, closeAnterior = 99) => ({
  time: T + semana * SEMANA, close, closeAnterior, ema: 100, emaAnterior: 100, atr: 4,
});
const campos = (e, par = "par") => camposTravessiaEma89(e, e.atualizado, par);

await teste("confirmacao imediata e limite exato, nas duas direcoes", () => {
  for (const sinal of [1, -1]) {
    const direcao = sinal === 1 ? "acima" : "abaixo";
    const anterior = 100 - sinal;
    const confirmado = atualizarTravessiaEma89(null, vela(0, 100 + sinal, anterior));
    assert.equal(confirmado.estado, "confirmada");
    assert.equal(confirmado.cruzouEm, T);
    assert.equal(confirmado.confirmouEm, T);
    assert.equal(campos(confirmado).ema89_semanal_confirmacao, direcao);
    assert.notEqual(campos(confirmado, "a").ema89_semanal_evento_id, campos(confirmado, "b").ema89_semanal_evento_id);
    const quase = atualizarTravessiaEma89(null, vela(0, 100 + sinal * .996, anterior));
    assert.equal(quase.estado, "pendente", "arredondar 0,249 para 0,25 nao confirma");
    assert.equal(campos(quase).ema89_semanal_confirmacao, "nenhum");
  }
});

await teste("pendencia sobrevive a varias semanas, reinicio e retries", () => {
  for (const sinal of [1, -1]) {
    let e = atualizarTravessiaEma89(null, vela(0, 100 + sinal * .4, 100 - sinal));
    assert.equal(e.estado, "pendente");
    const salvo = clone(e);
    assert.deepEqual(atualizarTravessiaEma89(e, vela(0, 100 + sinal * 20)), salvo);
    assert.deepEqual(atualizarTravessiaEma89(e, vela(-1, 100 - sinal * 20)), salvo);
    e = atualizarTravessiaEma89(clone(e), vela(1, 100 + sinal * .8, 100 + sinal * .4));
    assert.equal(e.estado, "pendente");
    e = atualizarTravessiaEma89(clone(e), vela(2, 100 + sinal * 1.6, 100 + sinal * .8));
    assert.equal(e.estado, "confirmada");
    assert.equal(e.cruzouEm, T);
    assert.equal(e.confirmouEm, T + 2 * SEMANA);
    const evento = campos(e).ema89_semanal_evento_id;
    assert.deepEqual(atualizarTravessiaEma89(e, vela(2, 100 - sinal * 20)), e);
    assert.equal(campos(e).ema89_semanal_evento_id, evento);
    assert.deepEqual(salvo, { atualizado: T, estado: "pendente", direcao: sinal === 1 ? "acima" : "abaixo",
      cruzouEm: T, confirmouEm: null, cancelouEm: null }, "entrada original preservada");
  }
});

await teste("volta ao lado anterior cancela sem confirmar a direcao oposta", () => {
  for (const sinal of [1, -1]) {
    const pendente = atualizarTravessiaEma89(null, vela(0, 100 + sinal * .4, 100 - sinal));
    const cancelada = atualizarTravessiaEma89(pendente, vela(1, 100 - sinal * 4, 100 + sinal * .4));
    assert.equal(cancelada.estado, "cancelada");
    assert.equal(cancelada.cancelouEm, T + SEMANA);
    assert.equal(cancelada.confirmouEm, null);
    assert.equal(campos(cancelada).ema89_semanal_confirmacao, "nenhum");
    assert.equal(campos(cancelada).ema89_semanal_evento_id, "--");
    const retomada = atualizarTravessiaEma89(clone(cancelada), vela(2, 100 + sinal * 1.6, 100 - sinal * 4));
    assert.equal(retomada.estado, "confirmada");
    assert.equal(retomada.cruzouEm, T + 2 * SEMANA, "nova travessia tem nova origem");
    assert.equal(retomada.cancelouEm, null);
  }
});

await teste("confirmacao nao se repete em semanas seguintes", () => {
  let e = atualizarTravessiaEma89(null, vela(0, 102));
  for (const [i, close, anterior] of [[1, 100.1, 102], [2, 104, 100.1]]) {
    e = atualizarTravessiaEma89(e, vela(i, close, anterior));
    assert.equal(e.estado, "confirmada");
    assert.equal(e.confirmouEm, T);
    assert.equal(campos(e).ema89_semanal_confirmacao, "nenhum");
    assert.equal(campos(e).ema89_semanal_evento_id, "--");
  }
  const inversao = atualizarTravessiaEma89(e, vela(3, 98, 104));
  assert.equal(campos(inversao).ema89_semanal_confirmacao, "abaixo");
  assert.equal(inversao.confirmouEm, T + 3 * SEMANA);
});

await teste("dados insuficientes e resposta antiga nao inventam confirmacao", () => {
  const p = atualizarTravessiaEma89(null, { ...vela(0, 102), atr: null });
  assert.equal(p.estado, "pendente");
  for (const atr of [null, 0, NaN, Infinity])
    assert.equal(atualizarTravessiaEma89(p, { ...vela(1, 102, 102), atr }).estado, "pendente");
  assert.deepEqual(atualizarTravessiaEma89(p, { ...vela(1, 102, 102), ema: null }), p);
  assert.equal(camposTravessiaEma89(p, T - SEMANA, "par").ema89_semanal_estado, "indisponivel");
  assert.equal(camposTravessiaEma89(p, T - SEMANA, "par").ema89_semanal_confirmacao, "nenhum");
});

await teste("retomada processa semanas intermediarias e respeita lacunas", () => {
  const serie = (closes) => ({ closes, times: closes.map((_, i) => T + i * SEMANA),
    emas: closes.map(() => 100), atrs: closes.map(() => 4) });
  const p = acompanharTravessiaEma89(null, serie([99, 100.4]));
  assert.equal(p.estado, "pendente");
  const varias = acompanharTravessiaEma89(clone(p), serie([99, 100.4, 99, 101.6]));
  assert.equal(varias.cruzouEm, T + 3 * SEMANA, "processou o cancelamento intermediario");
  assert.equal(varias.confirmouEm, T + 3 * SEMANA);
  const confirmouAntes = acompanharTravessiaEma89(p, serie([99, 100.4, 101.6, 102]));
  assert.equal(confirmouAntes.confirmouEm, T + 2 * SEMANA);
  assert.equal(campos(confirmouAntes).ema89_semanal_confirmacao, "nenhum", "nao anuncia evento de semana passada");
  assert.deepEqual(acompanharTravessiaEma89(varias, serie([99, 100.4])), varias);
  const perdida = serie([99, 100.4, 101.6]);
  perdida.times[2] += SEMANA;
  assert.equal(acompanharTravessiaEma89(p, perdida).estado, "neutra");
  const truncada = serie([101.6, 102]);
  truncada.times = [T + 5 * SEMANA, T + 6 * SEMANA];
  assert.equal(acompanharTravessiaEma89(p, truncada).estado, "neutra");
  assert.equal(acompanharTravessiaEma89(null, serie([99, 100.4, 101.6])).estado, "neutra",
    "migracao nao reconstrui um evento historico");
});

// Factory autocontida: o mesmo mock e' usado no build e no processo CLI.
// Todos os pares recebem a mesma serie; seus estados/IDs devem ser separados.
function fonteSintetica(extras, precoVivo = 100) {
  const dia = 86400, semana = 7 * dia, inicio = 1704067200;
  const semanaViva = inicio + (100 + extras.length) * semana;
  const agora = (semanaViva + 2 * dia + dia / 2) * 1000;
  const fetch = async (url) => {
    const u = new URL(url), iv = u.searchParams.get("interval");
    // As horas do cambio ficam fora: a mesma consulta de 1h serve aos dois
    // timeframes, e aqui diario e semanal sao series independentes de
    // proposito. Sem elas o monitor usa a serie longa com o fechamento
    // reparado pela abertura seguinte -- e nesta serie a abertura de cada
    // vela ja e' o fechamento da anterior, entao o reparo nao muda nada.
    if (iv === "1h") return { ok: false, status: 404 };
    const semanal = ["10080", "1w", "1wk"].includes(iv);
    const passo = semanal ? semana : dia;
    const closes = semanal ? [...Array(99).fill(100), 99.8, ...extras, precoVivo] : [...Array(110).fill(100), precoVivo];
    const fim = semanal ? semanaViva : semanaViva + 2 * dia;
    const rows = closes.map((close, i) => ({ time: fim - (closes.length - 1 - i) * passo,
      open: closes[i - 1] ?? close, close,
      high: Math.max(closes[i - 1] ?? close, close) + 2,
      low: Math.min(closes[i - 1] ?? close, close) - 2, volume: 1000 }));
    let data;
    if (u.hostname.includes("yahoo")) {
      data = { chart: { error: null, result: [{ meta: { gmtoffset: 0 }, timestamp: rows.map((r) => r.time),
        indicators: { quote: [{ open: rows.map((r) => r.open), high: rows.map((r) => r.high),
          low: rows.map((r) => r.low), close: rows.map((r) => r.close) }] } }] } };
    } else if (u.hostname.includes("binance")) {
      data = rows.map((r) => [r.time * 1000, r.open, r.high, r.low, r.close, r.volume,
        (r.time + passo) * 1000 - 1, 0, 100]);
    } else if (u.hostname.includes("kraken")) {
      data = { error: [], result: { candles: rows.map((r) =>
        [r.time, r.open, r.high, r.low, r.close, r.close, r.volume, 100]), last: fim } };
    } else throw new Error(`fonte inesperada no teste: ${u.hostname}`);
    return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
  };
  return { fetch, agora };
}
async function executar(extras, estado = {}, vivo = 100) {
  const f = fonteSintetica(extras, vivo), original = Date.now;
  Date.now = () => f.agora;
  try { return await build(f.fetch, estado); } finally { Date.now = original; }
}
const estadoDe = (r) => clone({ ema89Semanal: r.estadoEma89Semanal, niveis: r.estadoNiveis,
  zonas: r.zonasEstado, contadoresZona: r.contadoresZona });
const jsonDe = (r) => relatorioParaJSON(r.texto, r.zonas);

await teste("build publica confirmacao posterior mesmo sem cruzamento bruto", async () => {
  const primeiro = await executar([100.4]);
  assert.doesNotMatch(primeiro.texto, /FALHA:|NaN|undefined/);
  const j1 = jsonDe(primeiro);
  const salvo = estadoDe(primeiro);
  const intrassemana = await executar([100.4], clone(salvo), 50);
  assert.deepEqual(intrassemana.estadoEma89Semanal, salvo.ema89Semanal, "preco vivo nao cancela pendencias");
  const falha = await build(async () => ({ ok: false, status: 503 }), salvo);
  assert.deepEqual(falha.estadoEma89Semanal, salvo.ema89Semanal);
  const segundo = await executar([100.4, 102], clone(salvo));
  const j2 = jsonDe(segundo);
  const repetido = jsonDe(await executar([100.4, 102], estadoDe(segundo), 150));
  const ids = new Set();
  for (const p of PARES_TESTE) {
    assert.equal(j1.semanal[p.label].ema89_semanal_estado, "pendente");
    assert.equal(j1.semanal[p.label].ema89_semanal_confirmacao, "nenhum");
    assert.equal(j2.semanal[p.label].ema89_cruzamento_fechado, "nenhum");
    assert.equal(j2.semanal[p.label].ema89_semanal_confirmacao, "acima");
    const id = j2.semanal[p.label].ema89_semanal_evento_id;
    assert.equal(repetido.semanal[p.label].ema89_semanal_evento_id, id);
    assert.ok(!ids.has(id)); ids.add(id);
    assert.ok(!("ema89_semanal_estado" in j2.diario[p.label]), "diario nao ganha regra macro semanal");
  }
  const voltou = jsonDe(await executar([100.4, 98], salvo));
  for (const p of PARES_TESTE) {
    assert.equal(voltou.semanal[p.label].ema89_semanal_estado, "cancelada");
    assert.equal(voltou.semanal[p.label].ema89_semanal_confirmacao, "nenhum");
  }
  const isolado = clone(salvo);
  delete isolado.ema89Semanal[PARES_TESTE[0].key];
  const migrado = jsonDe(await executar([100.4, 102], isolado));
  assert.equal(migrado.semanal[PARES_TESTE[0].label].ema89_semanal_confirmacao, "nenhum");
  for (const p of PARES_TESTE.slice(1)) assert.equal(migrado.semanal[p.label].ema89_semanal_confirmacao, "acima");
});

await teste("CLI persiste a pendencia em disco e registra uma confirmacao por par", () => {
  const dir = mkdtempSync(join(tmpdir(), "ema89-semanal-"));
  try {
    const preload = join(dir, "fonte.mjs");
    const rodar = (extras) => {
      writeFileSync(preload, `const f = (${fonteSintetica.toString()})(${JSON.stringify(extras)});\nglobalThis.fetch = f.fetch;\nDate.now = () => f.agora;\n`);
      const r = spawnSync(process.execPath, ["--import", preload,
        fileURLToPath(new URL("./monitor.mjs", import.meta.url))], { cwd: dir, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /FALHA:|NaN|undefined/);
      return JSON.parse(readFileSync(join(dir, "docs/estado.json"), "utf8"));
    };
    const primeiro = rodar([100.4]);
    for (const p of PARES_TESTE) assert.equal(primeiro.ema89Semanal[p.key].estado, "pendente");
    const segundo = rodar([100.4, 102]);
    for (const p of PARES_TESTE) assert.equal(segundo.ema89Semanal[p.key].estado, "confirmada");
    rodar([100.4, 102]);
    const hist = readFileSync(join(dir, "docs/historico.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    for (const p of PARES_TESTE) {
      const eventos = hist.filter((h) => h.par === p.label && h.tf === "semanal" && h.ema89_confirmacao === "acima");
      assert.equal(eventos.length, 1);
      assert.ok(eventos[0].ema89_evento_id);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`${grupos} grupos EMA89 passaram.`);
