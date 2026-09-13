// ------------------------------------------------------------
// TESTE DE RETRATO
//
// O teste de fumaca verifica propriedades que alguem lembrou de
// verificar. Este verifica o resto: gera o relatorio inteiro sobre uma
// entrada fixa e compara, linha a linha, com o retrato guardado. Se um
// campo mudar de valor, de nome, de ordem ou sumir sem que ninguem
// tenha pedido, aqui quebra.
//
// A entrada nao vem do gerador aleatorio do harness, e sim de um
// CASSETE: as respostas das fontes foram gravadas uma vez e ficam em
// teste-retrato-cassete.json. Assim o retrato nao se mexe quando
// alguem ajusta a semente ou o formato das series sinteticas -- so
// quando o RELATORIO muda de verdade, que e' o que ele existe para
// vigiar.
//
// O relogio tambem e' fixo. O relatorio publica timestamp, fracao do
// periodo e se ha vela em formacao: sem congelar, o retrato mudaria
// sozinho a cada execucao.
//
// SAO DUAS EXECUCOES. A primeira parte de estado vazio; a segunda
// recebe o estado da primeira, que e' o que exercita o casamento das
// zonas, o ciclo de vida e a maquina de niveis. Bug que so aparece na
// segunda execucao ja aconteceu neste projeto mais de uma vez.
//
// A pagina HTML NAO entra no retrato de proposito: ela e' quase toda
// CSS, e qualquer ajuste de cor faria o retrato quebrar sem que o
// relatorio tivesse mudado. Quem cuida da pagina e' o teste de fumaca.
//
// Quando a mudanca for intencional:
//
//     node teste-retrato.mjs --atualizar
//
// e o diff do retrato entra no mesmo commit. Esse diff e' a revisao
// mais honesta que existe aqui, porque mostra TUDO que mudou.
// ------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { build } from "./monitor.mjs";

const RELOGIO = "2026-09-10T12:00:00Z";
const CASSETE = "teste-retrato-cassete.json";
const RETRATO = "teste-retrato.txt";

Date.now = () => Date.parse(RELOGIO);

// Reproduz a resposta gravada. Serve json() e text() a partir do mesmo
// corpo, porque cada fonte deste projeto le de um jeito.
const gravadas = new Map(
  JSON.parse(readFileSync(CASSETE, "utf8")).map((r) => [r.url, r])
);
const fetchCassete = async (url) => {
  const r = gravadas.get(url);
  if (!r) throw new Error(`cassete sem resposta para ${url}`);
  const texto = r.tipo === "text" ? r.corpo : JSON.stringify(r.corpo);
  const objeto = r.tipo === "text" ? JSON.parse(r.corpo) : r.corpo;
  return { ok: r.ok, status: r.status, text: async () => texto, json: async () => objeto };
};

const r1 = await build(fetchCassete, {});
const r2 = await build(fetchCassete, {
  ativos: (r1.gatilhos || []).map((g) => g.id),
  niveis: r1.estadoNiveis,
  ema89Semanal: r1.estadoEma89Semanal,
  zonas: r1.zonasEstado,
  contadoresZona: r1.contadoresZona,
});

const atual =
  "===== EXECUCAO 1 (estado vazio) =====\n" + r1.texto +
  "\n\n===== EXECUCAO 2 (estado da primeira) =====\n" + r2.texto + "\n";

if (process.argv.includes("--atualizar")) {
  writeFileSync(RETRATO, atual);
  console.log(`retrato atualizado: ${atual.split("\n").length} linhas em ${RETRATO}`);
  process.exit(0);
}

if (!existsSync(RETRATO)) {
  console.log(`FALHA  nao existe ${RETRATO}. Rode com --atualizar para criar.`);
  process.exit(1);
}

const esperado = readFileSync(RETRATO, "utf8");
if (esperado === atual) {
  console.log(`  ok     retrato do relatorio bate (${atual.split("\n").length} linhas, 2 execucoes)`);
} else {
  const a = esperado.split("\n");
  const b = atual.split("\n");
  const difs = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) difs.push(i);
  console.log(`  FALHA  o relatorio mudou: ${difs.length} linha(s) diferentes ` +
    `(retrato ${a.length}, agora ${b.length})`);
  for (const i of difs.slice(0, 12)) {
    console.log(`    linha ${i + 1}`);
    console.log(`      retrato: ${a[i] === undefined ? "(nao existia)" : a[i].slice(0, 110)}`);
    console.log(`      agora:   ${b[i] === undefined ? "(sumiu)" : b[i].slice(0, 110)}`);
  }
  if (difs.length > 12) console.log(`    ... e mais ${difs.length - 12} linha(s)`);
  console.log(`  Se a mudanca for intencional: node teste-retrato.mjs --atualizar`);
  process.exit(1);
}
