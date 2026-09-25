// ------------------------------------------------------------
// OS NUMEROS QUE DECIDEM, PRESOS UM A UM
//
// Teste de mutacao sobre as constantes do monitor -- mudar cada uma em
// 50% e ver se algum teste reclama -- mostrou 26 de 40 passando sem
// ninguem notar. Entre elas a tolerancia do reteste, a distancia de
// reset, a escala dos pivos, o piso das divergencias e os limiares de
// score das zonas: exatamente os numeros que decidem o que o relatorio
// afirma.
//
// Uma constante que pode mudar sozinha sem quebrar teste nenhum nao e'
// calibragem, e' acidente esperando acontecer. Cada bloco aqui escolhe
// entradas dos DOIS lados da borda, para a afirmacao morrer se o numero
// se mexer.
//
// O que continua de fora, e por que: as constantes calibradas por par
// (largura de zona, piso de divergencia em %, os fallbacks em % usados
// quando nao ha ATR) divergem de proposito entre os tres monitores, e
// um arquivo identico nos tres nao pode prende-las sem prender tambem a
// calibragem. Elas ficam presas pela lista da paridade e pela tabela do
// README.
// ------------------------------------------------------------
import {
  readPair, PARES_TESTE, TIMEFRAMES_TESTE, atrSeries, acharPivos,
  detectarDivergencias, situacaoNiveis, casarZonas, atualizarCiclo,
  zonasCandidatas, rsiSeries, alinhamentoNiveis, anatomia, compradoraForte,
  vendedoraForte, contextoAntesDoTrio, suavizarCentro,
} from "./monitor.mjs";

let falhas = 0, checagens = 0;
const ok = (c, m) => {
  checagens++;
  if (c) console.log(`  ok     ${m}`);
  else { console.log(`  FALHA  ${m}`); falhas++; }
};

// ------------------------------------------------------------
// 1. RETESTE PELO CAMINHO DE VERDADE
//
// A maquina de estado recebe a tolerancia pronta, em preco. Quem a
// monta a partir das constantes em ATR e' o readPair -- entao so um
// teste que passe por ele alcanca RETEST_TOLERANCIA_ATR e
// RETEST_RESET_ATR. As velas abaixo sao colocadas em MULTIPLOS DO ATR
// do proprio par, entao o mesmo arquivo vale para BTC, XMR e cambio.
// ------------------------------------------------------------
console.log("\n== reteste: tolerancia e distancia de reset, em ATR ==");
{
  const cfg = PARES_TESTE[0];
  const tf = TIMEFRAMES_TESTE.find((t) => t.key === "diario");
  const R = cfg.niveis.resistencia;
  const rot = cfg.niveis.resistenciaLabel;
  const DIA = tf.segundos;

  const cenario = () => {
    const fechadas = [];
    const t0 = 1_700_000_000 - 400 * DIA;
    // Lateral estreita logo abaixo da resistencia: ATR pequeno e
    // estavel, para a conta em multiplos de ATR ser confiavel.
    for (let i = 0; i < 240; i++) {
      const b = R * (0.995 + 0.0005 * Math.sin(i / 5));
      fechadas.push({ t: t0 + i * DIA, o: b, h: b * 1.0015, l: b * 0.9985, c: b, v: 1000 });
    }
    let estado = {};
    const atrAgora = () => {
      const a = atrSeries(fechadas.map((v) => v.h), fechadas.map((v) => v.l), fechadas.map((v) => v.c), 14);
      return a[a.length - 1];
    };
    return (mult) => {
      const a = atrAgora();
      const c = R + mult * a;
      const o = R + (mult > 0 ? Math.max(mult * 0.4, 0.02) : Math.min(mult * 0.4, -0.02)) * a;
      const t = fechadas[fechadas.length - 1].t + DIA;
      fechadas.push({ t, o, h: Math.max(o, c) * 1.0002, l: Math.min(o, c) * 0.9998, c, v: 1000 });
      const viva = { t: t + DIA, o: c, h: c * 1.0002, l: c * 0.9998, c, v: 500 };
      const f = fechadas, todas = [...f, viva];
      const d = {
        temVolume: true, emFormacao: true,
        times: f.map((v) => v.t), opens: f.map((v) => v.o), highs: f.map((v) => v.h),
        lows: f.map((v) => v.l), closes: f.map((v) => v.c), volumes: f.map((v) => v.v),
        live: { time: viva.t, open: viva.o, high: viva.h, low: viva.l, close: viva.c, volume: viva.v, trades: 5 },
      };
      void todas;
      const r = readPair(cfg, d, tf, { estadoNiveis: estado });
      estado = r.estadoNiveis;
      return {
        estado: (r.texto.match(new RegExp(`^nivel_${rot}_estado: (.*)$`, "m")) || [])[1],
        afastado: (r.texto.match(new RegExp(`^nivel_${rot}_afastado: (.*)$`, "m")) || [])[1],
      };
    };
  };

  // Ciclo inteiro: rompe, volta para dentro da tolerancia, sai dela,
  // afasta. As bordas sao 0,25 ATR (tolerancia) e 1,5 ATR (reset).
  const p = cenario();
  ok(p(1.0).estado === "rompido", "corpo inteiro 1 ATR acima rompe a resistencia");
  ok(p(0.2).estado === "em_reteste",
    "fechar a 0,20 ATR do nivel (dentro da tolerancia de 0,25) e' reteste");
  ok(p(0.3).estado === "reteste_confirmado",
    "fechar a 0,30 ATR (FORA da tolerancia) confirma o reteste");
  const afastou = p(1.6);
  ok(afastou.estado === "rompido" && afastou.afastado === "sim",
    "a 1,60 ATR (alem do reset de 1,5) o ciclo encerra e o nivel marca afastado");

  // Do outro lado da mesma borda: 0,20 ATR NAO pode confirmar reteste.
  const q = cenario();
  q(1.0);
  q(0.2);
  ok(q(0.2).estado === "em_reteste",
    "duas velas dentro da tolerancia seguem em reteste, sem confirmar");

  // E 1,3 ATR (aquem do reset) nao pode encerrar o ciclo.
  const s = cenario();
  s(1.0); s(0.2); s(0.3);
  ok(s(1.3).estado === "reteste_confirmado",
    "a 1,30 ATR (aquem do reset) o ciclo continua confirmado");
}

// ------------------------------------------------------------
// 2. ESCALA DOS PIVOS
// ------------------------------------------------------------
console.log("\n== pivos: quantas velas de confirmacao de cada lado ==");
{
  // A escala e' 2 para cada lado. As duas series abaixo tem um topo com
  // EXATAMENTE 2 velas menores de um lado e uma vela MAIOR na terceira
  // posicao: com escala 2 o topo e' pivo, com 3 deixa de ser. E' o par
  // de casos que prende o numero.
  const esq = [25, 10, 11, 20, 12, 11, 10, 10, 10];
  const pe = acharPivos(esq, esq.map((h) => h - 5));
  ok(pe.altos.includes(3),
    `topo com 2 velas menores a ESQUERDA e' pivo, mesmo com uma maior na 3a (altos: ${JSON.stringify(pe.altos)})`);

  const dir = [10, 10, 11, 20, 12, 11, 25, 10, 10];
  const pd = acharPivos(dir, dir.map((h) => h - 5));
  ok(pd.altos.includes(3),
    `topo com 2 velas menores a DIREITA e' pivo, mesmo com uma maior na 3a (altos: ${JSON.stringify(pd.altos)})`);

  // Com apenas UMA vela de cada lado nao ha confirmacao nenhuma.
  const h2 = [10, 20, 10, 10, 10, 10, 10, 10, 10];
  const p2 = acharPivos(h2, h2.map((h) => h - 5));
  ok(!p2.altos.includes(1),
    `topo com 1 vela de cada lado nao e' pivo (altos: ${JSON.stringify(p2.altos)})`);

  // A vela em formacao nunca vira pivo: nao ha confirmacao a direita.
  ok(!pe.altos.includes(esq.length - 1), "a ultima vela nunca e' pivo confirmado");
}

// ------------------------------------------------------------
// 3. SITUACAO DOS NIVEIS MANUAIS
// ------------------------------------------------------------
console.log("\n== distancia do preco as faixas manuais, em ATR ==");
{
  const niveis = { faixas: [[100, 110, "faixa"]] };
  const atr = 10;
  ok(situacaoNiveis(niveis, 105, atr).situacao === "atual", "dentro da faixa e' atual");
  ok(situacaoNiveis(niveis, 119, atr).situacao === "atual",
    "a 0,9 ATR da faixa (dentro de 1 ATR) o nivel ainda cerca o preco");
  ok(situacaoNiveis(niveis, 121, atr).situacao === "monitorar",
    "a 1,1 ATR ja saiu do cerco e passa a ser so para monitorar");
  // A borda do obsoleto e' 3 ATR: 2,9 ainda monitora, 3,1 ja e' outro lugar.
  ok(situacaoNiveis(niveis, 110 + 2.9 * atr, atr).situacao === "monitorar",
    "a 2,9 ATR da faixa o nivel ainda e' para monitorar");
  ok(situacaoNiveis(niveis, 110 + 3.1 * atr, atr).situacao === "obsoleto",
    "a 3,1 ATR da faixa o nivel ja e' obsoleto");
  ok(situacaoNiveis(niveis, 105, 0).situacao === "indefinida",
    "sem ATR a situacao e' indefinida, nao um numero inventado");
}

// ------------------------------------------------------------
// 4. CASAMENTO DE ZONAS ENTRE EXECUCOES
// ------------------------------------------------------------
console.log("\n== casamento de zonas: distancia e sobreposicao ==");
{
  const zona = (id, lo, hi) => ({
    id, tipo: "suporte", centro: (lo + hi) / 2,
    limites_estruturais: { inferior: lo, superior: hi },
    limites_operacionais: { inferior: lo, superior: hi },
    score: 60, numero_toques: 4,
  });
  const casou = (ant, nova, atr) => casarZonas([ant], [nova], atr).length === 1;

  // POR DISTANCIA. Regioes que nem se tocam, so os centros perto: a
  // borda e' 0,75 ATR. Com ATR 100, 50 de distancia casa e 90 nao.
  ok(casou(zona("z1", 100, 102), zona("n", 150, 152), 100),
    "centros a 0,50 ATR: a zona e' reconhecida como a mesma de antes");
  ok(!casou(zona("z1", 100, 102), zona("n", 190, 192), 100),
    "centros a 0,90 ATR (alem de 0,75): identidade nova, sem herdar historico");

  // POR SOBREPOSICAO. Com ATR minusculo a distancia nao ajuda, entao o
  // que decide e' a fracao sobreposta: a borda e' 0,35.
  ok(casou(zona("z1", 100, 110), zona("n", 106, 116), 1),
    "40% de sobreposicao (acima de 35%) casa mesmo com os centros longe");
  ok(!casou(zona("z1", 100, 110), zona("n", 107.5, 117.5), 1),
    "25% de sobreposicao nao casa");
}

console.log("\n== confluencia entre faixa manual e zona observada ==");
{
  const zona = (lo, hi) => ({
    id: "z", limites_operacionais: { inferior: lo, superior: hi },
    limites_estruturais: { inferior: lo, superior: hi }, centro: (lo + hi) / 2,
  });
  const niveis = { faixas: [[100, 110, "faixa"]] };
  // Mesma borda de 0,35, agora entre a faixa configurada a mao e a
  // regiao que as zonas automaticas acharam.
  ok(alinhamentoNiveis(niveis, [zona(106, 116)]).situacao === "alinhado",
    "faixa com 40% de sobreposicao com a zona conta como corroborada");
  ok(alinhamentoNiveis(niveis, [zona(107.5, 117.5)]).situacao === "desalinhado",
    "com 25% nao conta: a faixa esta deslocada da regiao que o mercado usa");
  ok(alinhamentoNiveis(niveis, []).situacao === "indefinido",
    "sem zonas nao ha o que corroborar");
}

// 5. CICLO DE VIDA DA ZONA
// ------------------------------------------------------------
console.log("\n== ciclo de vida da zona: os limiares de score ==");
{
  const ctx = { tfKey: "diario", ultimaVelaFechada: 2000, velasDesdeUltimoToque: 1, confluenciaSemanal: [] };
  const nova = (score) => ({ id: "z", score, centro: 100, limites_estruturais: [95, 105] });

  // Borda do enfraquecimento: 30. Acima disso uma ativa continua ativa.
  const viva = atualizarCiclo(nova(35), { status: "ativa", ultimaVelaAvaliada: 1000, velasEnfraquecida: 0 }, ctx);
  ok(viva.status === "ativa", `ativa com score 35 (acima de 30) continua ativa (${viva.status})`);
  const caiu = atualizarCiclo(nova(25), { status: "ativa", ultimaVelaAvaliada: 1000, velasEnfraquecida: 0 }, ctx);
  ok(caiu.status === "enfraquecida", `ativa com score 25 (abaixo de 30) enfraquece (${caiu.status})`);

  // Borda da remocao: 15.
  const fraca = atualizarCiclo(nova(20), { status: "enfraquecida", ultimaVelaAvaliada: 1000, velasEnfraquecida: 0 }, ctx);
  ok(fraca.status === "enfraquecida", `enfraquecida com score 20 (acima de 15) sobrevive (${fraca.status})`);
  const morta = atualizarCiclo(nova(10), { status: "enfraquecida", ultimaVelaAvaliada: 1000, velasEnfraquecida: 0 }, ctx);
  ok(morta.status === "remover", `enfraquecida com score 10 (abaixo de 15) e' removida (${morta.status})`);

  // Na MESMA vela nada envelhece: a contagem da enfraquecida nao anda e
  // ela nao e' removida. A rebaixa de uma ativa abaixo do corte, que so
  // depende do score desta vela, e' conferida.
  const parada = atualizarCiclo(nova(10), { status: "enfraquecida", ultimaVelaAvaliada: 2000, velasEnfraquecida: 3 }, ctx);
  ok(parada.status === "enfraquecida" && parada.velasEnfraquecida === 3,
    "na mesma vela fechada o ciclo nao avanca");
  const rebaixada = atualizarCiclo(nova(25), { status: "ativa", ultimaVelaAvaliada: 2000, velasEnfraquecida: 0 }, ctx);
  ok(rebaixada.status === "enfraquecida", "na mesma vela, ativa abaixo do corte enfraquece");
  const mantida = atualizarCiclo(nova(35), { status: "ativa", ultimaVelaAvaliada: 2000, velasEnfraquecida: 0 }, ctx);
  ok(mantida.status === "ativa", "na mesma vela, ativa acima do corte segue ativa");
}

// ------------------------------------------------------------
// 6. RADAR DE CANDIDATAS
// ------------------------------------------------------------
console.log("\n== radar: so regiao muito marcada e longe das faixas ==");
{
  const z = (score, toques) => ({
    id: "z" + score, tipo: "suporte", score, numero_toques: toques,
    centro: 1000, limites_operacionais: [990, 1010], limites_estruturais: [990, 1010],
    status: "ativa", confluencia_manual_qualquer: "nao",
  });
  const niveis = { faixas: [[10, 20, "longe"]] };
  const comToques = zonasCandidatas([z(90, 6)], niveis, 1000, "diario");
  ok(comToques.length === 1, `score 90 com 6 toques entra no radar (${comToques.length})`);
  const poucosToques = zonasCandidatas([z(90, 4)], niveis, 1000, "diario");
  ok(poucosToques.length === 0,
    `o mesmo score com 4 toques (abaixo do minimo de 5) NAO entra (${poucosToques.length})`);
  const scoreBaixo = zonasCandidatas([z(60, 6)], niveis, 1000, "diario");
  ok(scoreBaixo.length === 0, `6 toques com score 60 (abaixo de 70) NAO entra (${scoreBaixo.length})`);
  ok(zonasCandidatas([z(90, 6)], niveis, 1000, "semanal").length === 0,
    "o radar e' so do diario");

  // SO zona ativa. O radar recomenda virar faixa manual, e faixa manual
  // nao expira: promover uma regiao que o proprio ciclo de vida ja
  // classificou como em declinio -- ou que ainda nao se provou --
  // contradiz o ciclo. Enquanto o radar rodava sobre a lista publicada
  // isso vinha de graca, porque o corte de exibicao pega as mais
  // proximas do preco; olhando o conjunto inteiro passou a ser explicito.
  for (const status of ["enfraquecida", "candidata", "remover"]) {
    const zs = zonasCandidatas([{ ...z(90, 6), status }], niveis, 1000, "diario");
    ok(zs.length === 0, `zona ${status} com score 90 e 6 toques NAO entra no radar`);
  }

  // E o radar publica os limites ESTRUTURAIS, nao os operacionais: e'
  // a identidade da regiao que vira faixa, nao a janela de volatilidade
  // de hoje.
  const comLimites = zonasCandidatas([{
    ...z(90, 6),
    limites_estruturais: { inferior: 900, superior: 1100 },
    limites_operacionais: { inferior: 980, superior: 1020 },
  }], niveis, 1000, "diario");
  ok(comLimites.length === 1 && comLimites[0].inferior === 900 && comLimites[0].superior === 1100,
    `o radar publica os limites estruturais (${JSON.stringify(comLimites[0] && [comLimites[0].inferior, comLimites[0].superior])})`);
}

// ------------------------------------------------------------
// 7. DIVERGENCIAS
// ------------------------------------------------------------
console.log("\n== divergencia: janela, separacao e diferenca minima de RSI ==");
{
  // Aqui o RSI e os pivos entram prontos, entao cada numero e' testado
  // isolado: muda-se um so e ve-se a divergencia aparecer ou sumir.
  const n = 200, ultimo = n - 1;
  const lows = Array(n).fill(100);
  const highs = lows.map((v) => v + 3);
  const rsi = Array(n).fill(50);

  // Fundo mais baixo com RSI mais alto = divergencia de alta.
  const monta = (a, b, rsiA, rsiB, precoB = 90) => {
    const L = lows.slice(), R = rsi.slice();
    L[a] = 95; L[b] = precoB;
    R[a] = rsiA; R[b] = rsiB;
    return detectarDivergencias(highs, L, R, { altos: [], baixos: [a, b] });
  };

  // SEPARACAO: a borda e' 5 velas entre um fundo e outro.
  ok(monta(ultimo - 20, ultimo - 14, 25, 40).length === 1,
    "fundos separados por 6 velas (acima do minimo de 5) produzem divergencia");
  ok(monta(ultimo - 20, ultimo - 17, 25, 40).length === 0,
    "os mesmos fundos separados por 3 velas nao produzem nada");

  // JANELA: divergencia velha demais nao interessa. A borda e' 60 velas.
  ok(monta(ultimo - 55, ultimo - 49, 25, 40).length === 1,
    "fundos a 49 velas do presente ainda estao dentro da janela");
  ok(monta(ultimo - 75, ultimo - 69, 25, 40).length === 0,
    "fundos a 69 velas do presente ja sairam da janela de 60");

  // RSI: diferenca minima de 2 pontos, para ruido nao virar sinal.
  ok(monta(ultimo - 20, ultimo - 14, 25, 27.5).length === 1,
    "diferenca de 2,5 pontos de RSI (acima do minimo de 2) conta");
  ok(monta(ultimo - 20, ultimo - 14, 25, 26.5).length === 0,
    "diferenca de 1,5 ponto nao conta: e' ruido, nao divergencia");

  // E o preco precisa realmente ter feito fundo mais baixo.
  ok(monta(ultimo - 20, ultimo - 14, 25, 40, 95).length === 0,
    "sem fundo mais baixo nao ha divergencia, por mais que o RSI suba");
}

console.log("\n== geometria da vela compradora/vendedora forte ==");
{
  // amplitude 100 em todos os casos, para as fracoes serem lidas direto.
  const boa = anatomia(30, 100, 0, 90); // corpo 60%, fecha a 90%, sombra 17% do corpo
  ok(compradoraForte(boa, 0), "corpo 60% do range, fechando perto do topo: compradora forte");

  ok(!compradoraForte(anatomia(40, 100, 0, 90), 0),
    "corpo de 50% do range nao basta (minimo e' 55%)");

  ok(compradoraForte(anatomia(5, 100, 0, 75), 0),
    "fechar a 75% do range ainda e' 'perto do topo' (minimo e' 70%)");

  ok(!compradoraForte(anatomia(12, 100, 0, 72), 0),
    "sombra superior de 47% do corpo desqualifica (teto e' 40%)");

  // Tamanho relativo: a vela tem de ser grande PARA AQUELA SERIE.
  ok(compradoraForte(boa, 75), "corpo 20% acima de 75% da mediana conta");
  ok(!compradoraForte(boa, 100), "corpo com 60% da mediana nao conta: e' vela comum");

  // A vendedora e' o espelho exato.
  ok(vendedoraForte(anatomia(70, 100, 0, 10), 0),
    "o espelho vale para a vela vendedora forte");
  ok(!vendedoraForte(anatomia(60, 100, 0, 10), 0),
    "e o mesmo piso de corpo vale para ela");
}

console.log("\n== suavizacao do centro da zona ==");
{
  // O centro nao salta para onde o calculo do dia mandou: anda 30% do
  // caminho. Assim uma vela esquisita nao muda a identidade da regiao,
  // e a zona tambem nao congela.
  ok(suavizarCentro(100, 200) === 130,
    `o centro anda 30% da distancia ate o novo calculo (${suavizarCentro(100, 200)})`);
  ok(suavizarCentro(100, 100) === 100, "sem mudanca no calculo, o centro fica onde estava");
  const meio = suavizarCentro(100, 200);
  ok(meio > 100 && meio < 200,
    "o centro suavizado fica ENTRE o anterior e o novo, nunca fora");
  ok(suavizarCentro(200, 100) === 170, "e a conta e' simetrica na descida");
}

console.log("\n== contexto antes do trio: quantas velas para tras ==");
{
  // Cinco velas muito baixas, depois onze em queda. Olhando 10 para
  // tras ve-se uma queda em regiao baixa; olhando 15, uma alta em
  // regiao alta. A janela e' 10.
  const closes = [...Array(5).fill(50), ...Array.from({ length: 11 }, (_, i) => 110 - i)];
  ok(contextoAntesDoTrio(closes, closes.length - 1) === "queda_regiao_baixa",
    "o contexto olha 10 velas para tras, nao 15");
}

console.log(
  falhas
    ? `${falhas} falha(s) nos limiares`
    : `${checagens} verificacoes de limiares passaram.`
);
if (falhas) process.exit(1);
