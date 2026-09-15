// Sequencia ampliada: contexto do painel, sem mudar a estrutura dos alertas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analisarEstruturaVisual, classificarEstrutura, acharPivos,
  build, relatorioParaJSON, toHTML, PARES_TESTE,
} from "./monitor.mjs";

const DIA = 86400;
const sequencia = (highs, lows) => analisarEstruturaVisual(highs, lows,
  highs.map((_, i) => 1704067200 + i * DIA), {
    altos: highs.map((_, i) => i), baixos: lows.map((_, i) => i),
  });
for (const [highs, lows, tipo] of [
  [[10, 11, 12, 13], [5, 6, 7, 8], "alta"],
  [[13, 12, 11, 10], [8, 7, 6, 5], "baixa"],
  [[13, 12, 11, 10], [5, 6, 7, 8], "lateral_contracao"],
  [[10, 11, 12, 13], [8, 7, 6, 5], "lateral_expansao"],
]) {
  const v = sequencia(highs, lows);
  assert.equal(v.tendencia, tipo);
  assert.equal(v.consistencia, "consistente");
}
const predomino = sequencia([10, 12, 13, 11], [5, 7, 8, 6]);
assert.equal(predomino.tendencia, "alta");
assert.equal(predomino.consistencia, "predominante");
assert.deepEqual(predomino.comparacoes.topos, { subindo: 2, caindo: 1, iguais: 0 });
assert.equal(classificarEstrutura([10, 12, 13, 11], [5, 7, 8, 6],
  { altos: [0, 1, 2, 3], baixos: [0, 1, 2, 3] }).tendencia, "baixa",
  "a sequencia maior nao pode apagar uma mudanca recente de direcao");
for (const [h, l] of [
  [[10, 10, 10, 10], [5, 5, 5, 5]],
  [[10, 11, 10, 10], [5, 6, 7, 8]],
]) assert.equal(sequencia(h, l).consistencia, "mista", "empates nao inventam direcao");
assert.equal(sequencia([10, 11, 12], [5, 6, 7]).consistencia, "insuficiente");
assert.equal(sequencia([10, 11, 12, 13], [5, 6, 7]).consistencia, "insuficiente");
assert.equal(sequencia([], []).consistencia, "insuficiente");
assert.equal(sequencia([999, 10, 11, 12, 13], [99, 5, 6, 7, 8]).consistencia,
  "consistente", "somente os quatro ultimos de cada tipo compoem a janela");
assert.equal(sequencia([10, 11, NaN, 13], [5, 6, 7, 8]).consistencia, "insuficiente");
// "Consistente" exige 3 de 3 nos DOIS grupos. Um grupo uniforme com o
// outro em 2 de 3 e' PREDOMINIO -- e' o caso que aparece ao vivo, e o
// rotulo importa porque a ajuda do painel promete, em "consistente",
// que "as 3 comparacoes dos topos E as 3 dos fundos seguem esse padrao".
// Trocar o E por OU aqui passava por todos os testes anteriores.
const soToposUniformes = sequencia([10, 11, 12, 13], [5, 7, 8, 6]);
assert.equal(soToposUniformes.tendencia, "alta");
assert.equal(soToposUniformes.consistencia, "predominante",
  "topos 3 de 3 com fundos 2 de 3 e' predominio, nunca consistente");
assert.deepEqual(soToposUniformes.comparacoes.topos, { subindo: 3, caindo: 0, iguais: 0 });
assert.deepEqual(soToposUniformes.comparacoes.fundos, { subindo: 2, caindo: 1, iguais: 0 });
const soFundosUniformes = sequencia([10, 12, 13, 11], [5, 6, 7, 8]);
assert.equal(soFundosUniformes.consistencia, "predominante",
  "e o espelho: fundos 3 de 3 com topos 2 de 3 tambem e' predominio");
// Um extremo na ponta ainda nao e' pivo confirmado: nao adianta ser a
// maior maxima da serie enquanto faltam as velas de confirmacao a direita.
const hs = [1, 2, 4, 2, 1, 2, 5, 2, 1, 2, 6, 2, 1, 2, 7, 2, 1, 99];
const ls = hs.map(v => -v);
const pivos = acharPivos(hs, ls, 2, 2);
const ponta = analisarEstruturaVisual(hs, ls, hs.map((_, i) => i * DIA), pivos);
assert.equal(ponta.topos.at(-1).preco, 7);
assert.ok(!ponta.topos.some(p => p.preco === 99));

const agora = Date.now;
try {
  Date.now = () => Date.parse("2026-09-10T12:00:00Z");
  const gravadas = new Map(JSON.parse(readFileSync(new URL("./teste-retrato-cassete.json", import.meta.url), "utf8"))
    .map(r => [r.url, r]));
  const fonte = async url => {
    const r = gravadas.get(url);
    assert.ok(r, "resposta da fonte presente no cassete");
    const texto = r.tipo === "text" ? r.corpo : JSON.stringify(r.corpo);
    return { ok: r.ok, status: r.status, text: async () => texto, json: async () => JSON.parse(texto) };
  };
  const r = await build(fonte, {});
  assert.doesNotMatch(r.texto, /FALHA:/);
  const json = relatorioParaJSON(r.texto, r.zonas);
  const antes = JSON.stringify(json);
  for (const cfg of PARES_TESTE) for (const tf of ["diario", "semanal"]) {
    const v = r.estruturaVisual[`${cfg.key}|${tf}`];
    assert.ok(v, "cada par e timeframe recebe seu proprio contexto visual");
    assert.ok(v.topos.length <= 4 && v.fundos.length <= 4);
    const ultimoFechado = Date.parse(json[tf][cfg.label].ultimo_fechamento_data + "T00:00:00Z") / 1000;
    assert.ok([...v.topos, ...v.fundos].every(p => p.time <= ultimoFechado));
  }
  const html = toHTML(r.texto, json, r.estruturaVisual);
  const n = PARES_TESTE.filter(p => !p.semCartao).length * 2;
  assert.equal((html.match(/class="estrutura-ampliada"/g) || []).length, n);
  assert.ok(html.includes("Estrutura recente"));
  assert.ok(html.includes("Ver pivôs e comparações"));
  assert.equal(JSON.stringify(json), antes, "renderizacao nao modifica o JSON dos alertas");
  assert.doesNotMatch(antes + r.texto, /estruturaVisual|estrutura_ampliada|Sequência ampliada/);
  const cfg = PARES_TESTE.find(p => !p.semCartao);
  const copia = structuredClone(json);
  copia.diario[cfg.label].estrutura_tendencia = "baixa";
  const divergente = toHTML(r.texto, copia, { ...r.estruturaVisual, [`${cfg.key}|diario`]: predomino });
  assert.ok(divergente.includes("A estrutura recente diverge da sequência ampliada."));
  const insuficiente = toHTML(r.texto, json, { ...r.estruturaVisual,
    [`${cfg.key}|diario`]: sequencia([10, 11], [5, 6]) });
  assert.ok(insuficiente.includes("2 de 4 topos e 2 de 4 fundos disponíveis."));
  // Uma falha de fonte nao pode reapresentar a sequencia antiga como atual.
  const falhou = await build(async () => { throw new Error("offline"); }, {
    niveis: r.estadoNiveis, zonas: r.zonasEstado, ema89Semanal: r.estadoEma89Semanal,
    contadoresZona: r.contadoresZona,
  });
  assert.deepEqual(falhou.estruturaVisual, {});
} finally {
  Date.now = agora;
}
console.log("  ok     estrutura visual: sequencias, empates, confirmacao, isolamento e HTML");
