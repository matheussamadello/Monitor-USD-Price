// ------------------------------------------------------------
// PARIDADE ENTRE OS TRES MONITORES
//
// BTC, XMR e USD compartilham o mesmo motor. O que muda de um para o
// outro e' configuracao -- pares, faixas manuais, fontes -- e nada
// mais. Ate hoje isso era garantido no braco: quem mexia num aplicava
// a mesma edicao nos outros dois e conferia depois.
//
// Isso parou de bastar quando o projeto passou a receber mudanca de
// mais de uma fonte. Uma correcao aplicada so num repositorio nao
// aparece em lugar nenhum ate o comportamento divergir em producao, e
// ai a causa ja esta a semanas de distancia.
//
// O QUE E' COMPARADO:
//
//   arquivos inteiros   os que devem ser identicos nos tres
//   monitor.mjs         simbolo a simbolo, e SO os que existem nos
//                       tres -- o que e' de um repositorio so (fontes
//                       do cambio, trilho de execucao, titulo da
//                       pagina) e' config, nao divergencia
//
// teste-fumaca.mjs e teste-regressoes.mjs ficam de fora: o harness do
// USD e' proprio, porque as fontes dele sao outras.
//
// DE ONDE VEM O CODIGO DOS OUTROS DOIS: do diretorio irmao, quando os
// tres estao clonados lado a lado; senao, do GitHub. Rodar sem rede e
// sem irmaos nao e' "passou", e' "nao deu para verificar" -- codigo 2,
// distinto do codigo 1 de divergencia encontrada.
//
//     node paridade.mjs
// ------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { aceitas } from "./paridade-esperada.mjs";

const REPOS = ["Monitor-BTC-Price", "Monitor-XMR-Price", "Monitor-USD-Price"];
const IDENTICOS = [
  "ema89-semanal.mjs",
  "analisar-historico.mjs",
  "teste-ema89-semanal.mjs",
  "teste-retrato.mjs",
];
const BRUTO = (repo, arq) =>
  `https://raw.githubusercontent.com/matheussamadello/${repo}/main/${arq}`;

// Qual deles somos nos. Sai do proprio monitor.mjs, para o arquivo
// continuar identico nos tres.
const meuMonitor = readFileSync("monitor.mjs", "utf8");
const marca = (meuMonitor.match(/const TITULO_PAGINA = "Monitor ([A-Z]+)/) || [])[1];
const eu = REPOS.find((r) => r.includes(`-${marca}-`));
if (!eu) {
  console.log("FALHA  nao consegui identificar qual monitor e' este");
  process.exit(2);
}

async function ler(repo, arq) {
  if (repo === eu) return existsSync(arq) ? readFileSync(arq, "utf8") : null;
  for (const p of [`../${repo}/${arq}`, `../${repo.toLowerCase()}/${arq}`])
    if (existsSync(p)) return readFileSync(p, "utf8");
  try {
    const r = await fetch(BRUTO(repo, arq));
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

// Blocos de topo do monitor.mjs. Comentario sai antes: ele e' onde
// moram os exemplos de cada par, que divergem DE PROPOSITO -- o BTC
// fala em 76.000 e o XMR em 0,00656, descrevendo o mesmo codigo. O que
// nao pode divergir e' o codigo.
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1").trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");
}

// Profundidade de chaves sobre o codigo ja sem comentario: o arquivo
// inteiro declara no nivel zero, entao um simbolo comeca na coluna 0 e
// termina quando a profundidade volta a zero. Pega tanto a funcao de
// trinta linhas quanto a constante de uma linha so.
function simbolos(fonte) {
  const out = new Map();
  let nome = null, buf = [], prof = 0;
  for (const l of semComentarios(fonte).split("\n")) {
    if (!nome) {
      const m = l.match(/^(?:export )?(?:function|const|class) ([A-Za-z_$][\w$]*)/);
      if (!m) continue;
      nome = m[1];
    }
    buf.push(l);
    for (const c of l) {
      if (c === "{" || c === "[" || c === "(") prof++;
      else if (c === "}" || c === "]" || c === ")") prof--;
    }
    if (prof <= 0) { out.set(nome, buf.join("\n")); nome = null; buf = []; prof = 0; }
  }
  if (nome) out.set(nome, buf.join("\n"));
  return out;
}

let divergencias = 0, naoVerificados = 0;
const outros = REPOS.filter((r) => r !== eu);
console.log(`paridade de ${eu} contra ${outros.join(" e ")}\n`);

for (const arq of IDENTICOS) {
  const meu = await ler(eu, arq);
  if (meu === null) { console.log(`  ?      ${arq}: nao existe aqui`); naoVerificados++; continue; }
  for (const outro of outros) {
    const dele = await ler(outro, arq);
    if (dele === null) { console.log(`  ?      ${arq} vs ${outro}: nao deu para ler`); naoVerificados++; continue; }
    if (dele === meu) console.log(`  ok     ${arq} == ${outro}`);
    else { console.log(`  DIFERE ${arq} != ${outro}`); divergencias++; }
  }
}

const meus = simbolos(meuMonitor);
for (const outro of outros) {
  const fonte = await ler(outro, "monitor.mjs");
  if (fonte === null) { console.log(`  ?      monitor.mjs vs ${outro}: nao deu para ler`); naoVerificados++; continue; }
  const deles = simbolos(fonte);
  const comuns = [...meus.keys()].filter((k) => deles.has(k));
  const ok = aceitas(eu, outro);
  const todas = comuns.filter((k) => meus.get(k) !== deles.get(k));
  const difs = todas.filter((k) => !ok.has(k));
  const voltaram = [...ok].filter((k) => comuns.includes(k) && !todas.includes(k));
  if (voltaram.length)
    console.log(`  aviso  ${voltaram.length} simbolo(s) na lista de aceitas ja nao divergem ` +
      `de ${outro}: ${voltaram.join(", ")}. Podem sair de paridade-esperada.mjs.`);
  const soMeus = [...meus.keys()].filter((k) => !deles.has(k));
  const soDeles = [...deles.keys()].filter((k) => !meus.has(k));
  if (difs.length === 0)
    console.log(`  ok     monitor.mjs == ${outro} nos ${comuns.length} simbolos comuns ` +
      `(${todas.length} divergem, todas previstas; ${soMeus.length} so aqui, ${soDeles.length} so la)`);
  else {
    console.log(`  DIFERE monitor.mjs != ${outro} em ${difs.length} de ${comuns.length} simbolos comuns:`);
    for (const k of difs.slice(0, 15)) console.log(`           ${k}`);
    if (difs.length > 15) console.log(`           ... e mais ${difs.length - 15}`);
    divergencias += difs.length;
  }
}

if (divergencias) {
  console.log(`\n${divergencias} divergencia(s). O motor tem de ser o mesmo nos tres: ` +
    `so configuracao pode diferir.`);
  process.exit(1);
}
if (naoVerificados) {
  console.log(`\nsem divergencia no que deu para comparar, mas ${naoVerificados} ` +
    `item(ns) nao foram verificados. Isso nao e' aprovacao.`);
  process.exit(2);
}
console.log("\nos tres monitores estao em paridade.");
