// ------------------------------------------------------------
// O VERIFICADOR DE PARIDADE TAMBEM PRECISA SER VERIFICADO
//
// O paridade.mjs recorta o monitor.mjs em simbolos e compara simbolo a
// simbolo. Enquanto esse recorte errava, ele dizia "os tres monitores
// estao em paridade" com 10% do arquivo fora da conta -- e o que ficava
// de fora nao era codigo morto: era build(), a funcao que monta o
// relatorio inteiro, e as 142 linhas do PAGINA_CSS.
//
// Os dois furos foram encontrados por mutacao: mudar a ordem de calculo
// dentro de build() e o padding dos botoes no CSS passavam como
// paridade. Os testes abaixo prendem os dois, e mais um terceiro caso
// que o mesmo recorte erraria -- parentese solto dentro de string.
//
// Uma ferramenta de conferencia que falha em silencio e' pior que
// nenhuma: nenhuma nao gera confianca.
// ------------------------------------------------------------
import { readFileSync } from "node:fs";
import { simbolos, semComentarios } from "./paridade.mjs";

let falhas = 0, checagens = 0;
const ok = (c, m) => {
  checagens++;
  if (c) console.log(`  ok     ${m}`);
  else { console.log(`  FALHA  ${m}`); falhas++; }
};

console.log("\n== recorte em simbolos (paridade.mjs) ==");

// 1. NADA pode ficar de fora. Toda linha de codigo do monitor.mjs tem
//    de cair em algum simbolo -- inclusive os imports e o bloco de
//    execucao direta, que vao para o pseudo-simbolo <topo>.
const fonte = readFileSync("monitor.mjs", "utf8");
const linhas = semComentarios(fonte).split("\n");
const mapa = simbolos(fonte);
let capturadas = 0;
for (const corpo of mapa.values()) capturadas += corpo.split("\n").length;
ok(
  capturadas === linhas.length,
  `todas as ${linhas.length} linhas de codigo entram na comparacao ` +
    `(capturadas: ${capturadas})`
);

// 2. Os dois simbolos que estavam invisiveis, nomeados. Se alguem
//    reescrever o recorte e perder um deles de novo, o teste diz qual.
const buildTem = (mapa.get("build") || "").split("\n").length;
ok(
  mapa.has("build") && buildTem > 50,
  `build() capturado inteiro (${buildTem} linhas) -- era invisivel por ser ` +
    "declarada com async"
);
const cssTem = (mapa.get("PAGINA_CSS") || "").split("\n").length;
ok(
  mapa.has("PAGINA_CSS") && cssTem > 50,
  `PAGINA_CSS capturado inteiro (${cssTem} linhas) -- fechava na primeira ` +
    "linha porque template nao tem chave"
);
ok(mapa.has("<topo>"), "imports e bloco de execucao direta viram <topo>");

// 3. Fixture pequeno com os tres casos de uma vez, para o teste nao
//    depender do estado do monitor.mjs de hoje.
const fixture = [
  'import { x } from "./y.mjs";',
  "const UM = 1;",
  "const TEXTO = `",
  ".a{color:red}",
  ".b{color:blue}",
  "`;",
  "export async function dois(a) {",
  "  return a + 1;",
  "}",
  'const TRES = "um ( parentese solto";',
  "function quatro() {",
  "  return 4;",
  "}",
].join("\n");
const f = simbolos(fixture);
ok(f.has("UM") && f.get("UM") === "const UM = 1;", "const de uma linha");
ok(
  (f.get("TEXTO") || "").split("\n").length === 4,
  `template multilinha inteiro (${(f.get("TEXTO") || "").split("\n").length} de 4 linhas)`
);
ok(
  (f.get("dois") || "").includes("return a + 1;"),
  "export async function e' reconhecida"
);
ok(
  f.get("TRES") === 'const TRES = "um ( parentese solto";',
  "parentese dentro de string nao abre bloco"
);
ok(
  (f.get("quatro") || "").includes("return 4;"),
  "o simbolo seguinte nao e' engolido pelo anterior"
);
ok(f.get("<topo>") === 'import { x } from "./y.mjs";', "so o import sobra no <topo>");

console.log(
  falhas
    ? `${falhas} falha(s) no recorte da paridade`
    : `${checagens} verificacoes do recorte passaram.`
);
if (falhas) process.exit(1);
