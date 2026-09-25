// Sequencia ampliada: contexto do painel, sem mudar a estrutura dos alertas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analisarEstruturaVisual, classificarEstrutura, acharPivos,
  build, relatorioParaJSON, toHTML, registrarHistorico, PARES_TESTE,
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
  const resultadoAntes = structuredClone(r);
  const historicoAntes = registrarHistorico(json, {}, "2026-09-10T12:00:00Z");
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
  assert.equal((html.match(/<dt>Estrutura dos últimos pivôs confirmados<\/dt>/g) || []).length, n);
  assert.doesNotMatch(html, /<dt>Estrutura recente<\/dt>/);
  assert.ok(html.includes("Ver pivôs e comparações"));
  assert.equal(JSON.stringify(json), antes, "renderizacao nao modifica o JSON dos alertas");
  assert.doesNotMatch(antes + r.texto, /estruturaVisual|estrutura_ampliada|Sequência ampliada/);
  const cfg = PARES_TESTE.find(p => !p.semCartao);
  const copia = structuredClone(json);
  copia.diario[cfg.label].estrutura_tendencia = "baixa";
  const divergente = toHTML(r.texto, copia, { ...r.estruturaVisual, [`${cfg.key}|diario`]: predomino });
  assert.ok(divergente.includes("Correção recente dentro de estrutura ampliada ainda altista"));
  const insuficiente = toHTML(r.texto, json, { ...r.estruturaVisual,
    [`${cfg.key}|diario`]: sequencia([10, 11], [5, 6]) });
  assert.ok(insuficiente.includes("2 de 4 topos e 2 de 4 fundos disponíveis."));

  // As combinacoes sao verificadas no HTML, sem criar novos campos canonicos.
  const alta = sequencia([10, 11, 12, 13], [5, 6, 7, 8]);
  const baixa = sequencia([13, 12, 11, 10], [8, 7, 6, 5]);
  const mista = sequencia([10, 10, 10, 10], [5, 5, 5, 5]);
  const contracao = sequencia([13, 12, 11, 10], [5, 6, 7, 8]);
  const casos = [
    ["baixa", predomino, "Correção recente dentro de estrutura ampliada ainda altista"],
    ["alta", baixa, "Recuperação recente dentro de estrutura ampliada ainda baixista"],
    ["alta", alta, "Estrutura recente e ampliada alinhadas em alta"],
    ["baixa", baixa, "Estrutura recente e ampliada alinhadas em baixa"],
    ...["lateral_contracao", "lateral_expansao", "lateral_empate"].flatMap(recente => [
      [recente, alta, "Estrutura recente lateral dentro de contexto ampliado predominantemente altista"],
      [recente, baixa, "Estrutura recente lateral dentro de contexto ampliado predominantemente baixista"],
    ]),
    ["baixa", sequencia([10, 11], [5, 6]), "Sequência ampliada incompleta; ainda não é possível comparar os dois horizontes"],
    ["indefinida", alta, "Estrutura recente indefinida; a sequência ampliada descreve somente sua própria janela"],
    ["--", baixa, "Estrutura recente indefinida; a sequência ampliada descreve somente sua própria janela"],
    ["alta", mista, "Sequência ampliada sem direção predominante; os horizontes não definem uma direção comum"],
    ["baixa", null, "Sequência ampliada indisponível; comparação entre horizontes não disponível"],
    ["alta", contracao, "Estrutura recente de alta dentro de sequência ampliada lateral"],
    ["lateral_expansao", contracao, "Os dois horizontes apresentam padrões laterais; consulte os pivôs de cada janela"],
  ];
  const congelar = obj => {
    if (obj && typeof obj === "object") {
      Object.values(obj).forEach(congelar);
      Object.freeze(obj);
    }
    return obj;
  };
  for (const [recente, ampliada, esperado] of casos) {
    const dados = structuredClone(json);
    const visuais = {};
    for (const par of PARES_TESTE) for (const tf of ["diario", "semanal"]) {
      dados[tf][par.label].estrutura_tendencia = recente;
      visuais[`${par.key}|${tf}`] = structuredClone(ampliada);
    }
    const serializado = JSON.stringify(dados);
    const pagina = toHTML(r.texto, congelar(dados), congelar(visuais));
    const sinteses = [...pagina.matchAll(/<p class="estrutura-sintese">([^<]+)<\/p>/g)].map(m => m[1]);
    assert.equal(sinteses.length, n);
    assert.ok(sinteses.every(s => s === esperado), recente + "/" + ampliada?.tendencia);
    assert.doesNotMatch(sinteses.join(" "), /bom para comprar|bom para vender|sinal de entrada|sinal de saída/i);
    assert.equal(JSON.stringify(dados), serializado, "valores e campos canonicos nao mudam na renderizacao");
    for (const par of PARES_TESTE.filter(p => !p.semCartao)) for (const tf of ["diario", "semanal"]) {
      const tooltip = pagina.match(new RegExp(`id="aj-estrutura-${par.key}-${tf}" role="tooltip">([^<]+)`))?.[1];
      assert.ok(tooltip?.includes("2 últimos topos e 2 últimos fundos confirmados"));
      assert.ok(tooltip.includes("não significa automaticamente que a tendência geral"));
      assert.ok(tooltip.includes("sequência ampliada e com os demais indicadores"));
      assert.ok(tooltip.includes(tf === "diario" ? "fractal 5/5" : "fractal 2/2"));
      assert.ok(tooltip.includes(tf === "diario" ? "após 5 velas fechadas à direita" : "após 2 velas semanais fechadas à direita"));
      assert.ok(tooltip.includes("deliberadamente atrasada"));
      for (const tipo of ["janela", "sequencia"]) {
        const ajuda = pagina.match(new RegExp(`id="aj-${tipo}-${par.key}-${tf}" role="tooltip">([^<]+)`))?.[1];
        assert.ok(ajuda?.includes("4 últimos topos e 4 últimos fundos confirmados"));
        assert.ok(ajuda.includes("janela mais ampla"));
        assert.ok(ajuda.includes("não é contradição, mas diferença de horizonte estrutural"));
        assert.ok(ajuda.includes(tf === "diario" ? "fractal 5/5" : "fractal 2/2"));
      }
    }
  }
  const chips = structuredClone(json);
  for (const par of PARES_TESTE) for (const tf of ["diario", "semanal"]) {
    chips[tf][par.label].alertas_tecnicos = ["estrutura_de_baixa", "estrutura_de_alta_preservada", "rsi_sobrecomprado"];
    chips[tf][par.label].deterioracao_tendencia = ["estrutura_de_baixa", "perda_estrutura_alta_novo_LL", "di_minus_dominante_com_estrutura_nao_altista"];
  }
  const chipsAntes = JSON.stringify(chips);
  const paginaChips = toHTML(r.texto, congelar(chips), r.estruturaVisual);
  assert.equal((paginaChips.match(/>estrutura_recente_de_baixa<\/span>/g) || []).length, n,
    "chip repetido entre alerta e deterioracao continua aparecendo uma unica vez");
  assert.ok(paginaChips.includes('class="chip risco estrutura-chip">estrutura_recente_de_baixa'));
  assert.ok(paginaChips.includes(">estrutura_recente_de_alta_preservada</span>"));
  assert.ok(paginaChips.includes(">perda_estrutura_recente_alta_novo_LL</span>"));
  assert.ok(paginaChips.includes(">di_minus_dominante_com_estrutura_recente_nao_altista</span>"));
  assert.ok(paginaChips.includes('class="chip">rsi_sobrecomprado</span>'));
  assert.doesNotMatch(paginaChips, />estrutura_de_(baixa|alta_preservada)<\/span>/);
  assert.equal(JSON.stringify(chips), chipsAntes, "identificadores internos dos chips preservados");
  assert.deepEqual(r, resultadoAntes, "renderizacao preserva resultados, gatilhos e estado");
  assert.deepEqual(registrarHistorico(json, {}, "2026-09-10T12:00:00Z"), historicoAntes);
  assert.deepEqual(await build(fonte, {}), resultadoAntes, "a pagina nao altera regras ou futuras execucoes de alertas");
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
