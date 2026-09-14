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
// O MESMO vale para a comparacao em si, e ela teve um segundo furo,
// pior que o primeiro: rodava sobre a INTERSECAO dos simbolos. Funcao
// que sumisse de um repositorio saia da conta em silencio. Apagando
// atualizarEstadoNivel de uma copia do BTC, tanto paridade.mjs quanto
// este arquivo terminavam com codigo 0.
//
// Por isso a segunda metade deste teste nao olha o parser: monta tres
// repositorios de mentira num diretorio temporario, estraga um de cada
// vez e RODA O VERIFICADOR DE VERDADE como processo separado, conferindo
// o codigo de saida e a mensagem. Contar linhas capturadas pelo parser
// nao provaria nada disso.
//
// Uma ferramenta de conferencia que falha em silencio e' pior que
// nenhuma: nenhuma nao gera confianca.
// ------------------------------------------------------------
import {
  readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { simbolos, semComentarios } from "./paridade.mjs";

let falhas = 0, checagens = 0, pulados = 0;
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
  "function escapar(v) {",
  "  return String(v).replace(/'/g, \"&#39;\").replace(/\"/g, \"&quot;\");",
  "}",
  "function depoisDaRegex(x) {",
  "  return x;",
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
ok(
  (f.get("escapar") || "").split("\n").length === 3,
  `expressao regular com aspas dentro nao vira string (${(f.get("escapar") || "").split("\n").length} de 3 linhas)`
);
ok(
  (f.get("depoisDaRegex") || "").includes("return x;"),
  "e o simbolo seguinte a ela continua sendo visto -- era aqui que 23 " +
    "simbolos do monitor.mjs desapareciam dentro do pgEsc"
);

// A barra tambem abre expressao regular depois de palavra-chave. Nao ha
// nenhum caso assim no monitor.mjs de hoje, e e' justamente por isso que
// o teste existe: quando aparecer, tem de continuar funcionando.
{
  const g = simbolos([
    "function usa(s) {",
    "  return /'/.test(s);",
    "}",
    "function apos(x) {",
    "  return x;",
    "}",
  ].join("\n"));
  ok((g.get("usa") || "").split("\n").length === 3,
    `regex depois de 'return' nao vira string (${(g.get("usa") || "").split("\n").length} de 3 linhas)`);
  ok(g.has("apos"), "e o simbolo seguinte continua visivel");

  // E divisao continua sendo divisao: depois de nome, `)` ou `]` a barra
  // divide. Confundir os dois quebraria o recorte do outro lado.
  const h = simbolos([
    "const conta = (a) => {",
    "  const m = total / fatias;",
    "  const n = arr[0] / 2;",
    "  const o = f(a) / 3;",
    "  return m + n + o;",
    "};",
  ].join("\n"));
  ok((h.get("conta") || "").split("\n").length === 6,
    `divisao apos nome, indice e chamada nao e' lida como regex (${(h.get("conta") || "").split("\n").length} de 6 linhas)`);
}


// ============================================================
// O VERIFICADOR DE VERDADE, RODADO EM COPIAS TEMPORARIAS
//
// Daqui para baixo nada e' simulado: cada cenario monta tres
// repositorios num diretorio temporario, copia o paridade.mjs DESTE
// repositorio para dentro deles e executa `node paridade.mjs` como
// processo separado, conferindo o codigo de saida e o que foi impresso.
//
// PARIDADE_SEM_REDE=1 em todos: sem isso, um arquivo faltando na copia
// seria buscado no GitHub e o teste passaria a medir o repositorio
// publicado em vez da copia que ele acabou de montar.
// ============================================================

const AQUI = dirname(fileURLToPath(import.meta.url));
const TRES = ["Monitor-BTC-Price", "Monitor-XMR-Price", "Monitor-USD-Price"];

// Os arquivos que o paridade.mjs compara inteiros. Precisam existir e
// ser identicos nos tres, senao o cenario falharia por outro motivo.
const IDENTICOS_FIXTURE = [
  "ema89-semanal.mjs", "analisar-historico.mjs", "teste-ema89-semanal.mjs",
  "teste-retrato.mjs", "teste-paridade.mjs", "teste-niveis.mjs",
  "teste-limiares.mjs", "paridade.mjs", "paridade-esperada.mjs",
];

// monitor.mjs de mentira, pequeno o bastante para o cenario caber na
// cabeca e grande o bastante para ter os quatro casos que interessam:
// simbolo comum, simbolo de conteudo liberado, simbolo so de dois e
// simbolo so de um.
function monitorFixture(marca) {
  const L = [
    'import { algo } from "./ema89-semanal.mjs";',
    "",
    `const TITULO_PAGINA = "Monitor ${marca}";`,
    `const PAIRS = ["${marca.toLowerCase()}"];`,
    "",
    "export function atualizarEstadoNivel(anterior, ctx) {",
    "  return { anterior, ctx };",
    "}",
    "",
    "export function acharPivos(highs, lows) {",
    "  return { altos: highs, baixos: lows };",
    "}",
    "",
    // Expressao regular com aspas dentro, seguida de outro simbolo: o
    // recorte ja leu essa aspa como inicio de string e engoliu tudo que
    // vinha depois.
    "export function escapar(v) {",
    '  return String(v).replace(/\'/g, "&#39;");',
    "}",
    "",
    "export async function build(fetchImpl) {",
    marca === "USD"
      ? '  return fetchImpl("yahoo") && fetchImpl("binance");'
      : '  return fetchImpl("kraken");',
    "}",
  ];
  if (marca !== "USD") {
    L.push("", "function urlKraken(cfg) {", "  return `https://kraken/${cfg}`;", "}");
  } else {
    L.push("", "function parseYahoo(txt) {", "  return JSON.parse(txt);", "}");
  }
  return L.join("\n") + "\n";
}

// Registro do cenario: mesma forma do paridade-esperada.mjs de verdade,
// com as duas listas separadas.
function registroFixture({ presenca = null, conteudo = null } = {}) {
  const pres = presenca || {
    urlKraken: ["Monitor-BTC-Price", "Monitor-XMR-Price"],
    parseYahoo: ["Monitor-USD-Price"],
  };
  const cont = conteudo || {
    "Monitor-BTC-Price|Monitor-XMR-Price": ["TITULO_PAGINA", "PAIRS"],
    "Monitor-BTC-Price|Monitor-USD-Price": ["TITULO_PAGINA", "PAIRS", "build", "<topo>"],
    "Monitor-USD-Price|Monitor-XMR-Price": ["TITULO_PAGINA", "PAIRS", "build", "<topo>"],
  };
  return [
    `export const REPOS = ${JSON.stringify(TRES)};`,
    `export const CONTEUDO_ACEITO = ${JSON.stringify(cont, null, 1)};`,
    `export const PRESENCA_ESPERADA = ${JSON.stringify(pres, null, 1)};`,
    "export function conteudoAceito(a, b) {",
    '  return new Set(CONTEUDO_ACEITO[[a, b].sort().join("|")] || []);',
    "}",
    "export function deveExistirEm(simbolo) {",
    "  return new Set(PRESENCA_ESPERADA[simbolo] || REPOS);",
    "}",
    "export function simbolosRegistrados(a, b) {",
    "  const out = new Set();",
    "  for (const [s, onde] of Object.entries(PRESENCA_ESPERADA))",
    "    if (onde.includes(a) || onde.includes(b)) out.add(s);",
    '  for (const s of CONTEUDO_ACEITO[[a, b].sort().join("|")] || []) out.add(s);',
    "  return out;",
    "}",
    "export function conferirRegistro() {",
    "  const problemas = [];",
    "  for (const [s, onde] of Object.entries(PRESENCA_ESPERADA))",
    "    for (const r of onde)",
    '      if (!REPOS.includes(r)) problemas.push(s + ": repositorio desconhecido " + r);',
    "  return problemas;",
    "}",
  ].join("\n") + "\n";
}

// Monta os tres repositorios e devolve o diretorio raiz. `mexer` recebe
// um par de funcoes para estragar o que o cenario quiser.
function montarCenario(mexer = () => {}) {
  const raiz = mkdtempSync(join(tmpdir(), "paridade-cenario-"));
  const arquivos = {}; // repo -> nome -> conteudo
  for (const repo of TRES) {
    const marca = repo.split("-")[1];
    arquivos[repo] = { "monitor.mjs": monitorFixture(marca) };
    for (const arq of IDENTICOS_FIXTURE) {
      if (arq === "paridade.mjs") continue; // copiado do repositorio de verdade
      arquivos[repo][arq] =
        arq === "paridade-esperada.mjs" ? registroFixture() : `// ${arq} (stub)\n`;
    }
  }
  mexer(arquivos, { registroFixture, monitorFixture });
  for (const repo of TRES) {
    mkdirSync(join(raiz, repo), { recursive: true });
    for (const [nome, conteudo] of Object.entries(arquivos[repo])) {
      if (conteudo === null) continue; // cenario pediu para o arquivo nao existir
      writeFileSync(join(raiz, repo, nome), conteudo);
    }
    // O verificador de VERDADE, o mesmo que roda em producao.
    cpSync(join(AQUI, "paridade.mjs"), join(raiz, repo, "paridade.mjs"));
  }
  return raiz;
}

function rodar(raiz, repo) {
  const r = spawnSync(process.execPath, ["paridade.mjs"], {
    cwd: join(raiz, repo),
    encoding: "utf8",
    env: { ...process.env, PARIDADE_SEM_REDE: "1" },
  });
  return { codigo: r.status, saida: (r.stdout || "") + (r.stderr || "") };
}

// Roda um cenario a partir de CADA um dos repositorios indicados e
// devolve os resultados. Conferir nos dois sentidos e' parte do teste:
// a remocao tem de reprovar tanto de quem perdeu a funcao quanto de
// quem ainda a tem.
function cenario(mexer, de = TRES) {
  const raiz = montarCenario(mexer);
  try {
    return Object.fromEntries(de.map((repo) => [repo, rodar(raiz, repo)]));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

const aprovou = (r) => r.codigo === 0 && /os tres monitores estao em paridade/.test(r.saida);

console.log("\n== o verificador, em copias temporarias ==");

// 1. O cenario integro passa. Sem isso nada abaixo significa nada: um
//    verificador que reprova tudo tambem "pegaria" a remocao.
{
  const r = cenario(() => {});
  for (const repo of TRES)
    ok(aprovou(r[repo]), `cenario integro aprova rodando de ${repo} (codigo ${r[repo].codigo})`);
}

// 2. O caso relatado: apagar atualizarEstadoNivel de UM projeto so.
//    Antes desta correcao, codigo 0 nos dois sentidos.
{
  const r = cenario((a) => {
    a["Monitor-BTC-Price"]["monitor.mjs"] = a["Monitor-BTC-Price"]["monitor.mjs"]
      .replace(/export function atualizarEstadoNivel[\s\S]*?\n}\n/, "");
  });
  const doBtc = r["Monitor-BTC-Price"], doXmr = r["Monitor-XMR-Price"], doUsd = r["Monitor-USD-Price"];
  ok(doBtc.codigo === 1, `apagar atualizarEstadoNivel do BTC reprova rodando do BTC (codigo ${doBtc.codigo})`);
  ok(/FALTA\s+atualizarEstadoNivel/.test(doBtc.saida) && /Monitor-BTC-Price/.test(doBtc.saida),
    "e a mensagem nomeia o simbolo e o repositorio onde ele deveria estar");
  ok(doXmr.codigo === 1 && /FALTA\s+atualizarEstadoNivel/.test(doXmr.saida),
    `a mesma remocao reprova no sentido inverso, rodando do XMR (codigo ${doXmr.codigo})`);
  ok(doUsd.codigo === 1, `e do USD tambem (codigo ${doUsd.codigo})`);
  ok(!aprovou(doBtc) && !aprovou(doXmr) && !aprovou(doUsd),
    "nenhum dos tres imprime 'estao em paridade'");
}

// 3. Funcao nova em um projeto so, sem registro.
{
  const r = cenario((a) => {
    a["Monitor-XMR-Price"]["monitor.mjs"] +=
      "\nexport function heuristicaNova(x) {\n  return x * 2;\n}\n";
  });
  // Sem registro, o padrao e' "obrigatorio nos tres": a funcao nova
  // aparece como FALTANDO nos outros dois. A mensagem nao adivinha se
  // foi remocao ou adicao -- diz onde ela esta e onde devia estar.
  const doXmr3 = r["Monitor-XMR-Price"], doBtc3 = r["Monitor-BTC-Price"];
  ok(doXmr3.codigo === 1 && /FALTA\s+heuristicaNova/.test(doXmr3.saida),
    `funcao exclusiva nao registrada reprova (codigo ${doXmr3.codigo})`);
  ok(/heuristicaNova:[^\n]*existe em Monitor-XMR-Price/.test(doXmr3.saida),
    "a mensagem diz em qual repositorio ela existe");
  ok(/heuristicaNova:[^\n]*previsto em Monitor-BTC-Price/.test(doXmr3.saida),
    "e em qual ela deveria existir");
  ok(/PRESENCA_ESPERADA/.test(doXmr3.saida),
    "e aponta onde registrar, se a exclusividade for proposital");
  ok(doBtc3.codigo === 1 && /FALTA\s+heuristicaNova/.test(doBtc3.saida),
    "reprova tambem vista de quem nao a tem");
}

// 4. Renomear uma funcao compartilhada: some de um lado e aparece do
//    outro com outro nome. Tem de acusar as duas pontas.
{
  const r = cenario((a) => {
    a["Monitor-USD-Price"]["monitor.mjs"] = a["Monitor-USD-Price"]["monitor.mjs"]
      .replace(/acharPivos/g, "acharPivosV2");
  });
  const s = r["Monitor-USD-Price"].saida;
  ok(r["Monitor-USD-Price"].codigo === 1, `renomear reprova (codigo ${r["Monitor-USD-Price"].codigo})`);
  ok(/FALTA\s+acharPivos:/.test(s), "acusa o nome antigo, que sumiu do USD");
  ok(/FALTA\s+acharPivosV2:/.test(s), "e o nome novo, que nao existe nos outros dois");
  ok(/acharPivosV2:[^\n]*existe em Monitor-USD-Price/.test(s),
    "dizendo onde o nome novo apareceu");
}

// 5. Diferenca de presenca legitima continua passando -- e e' o
//    REGISTRO que a torna legitima, nao uma regra automatica. Tirando a
//    entrada do registro, o mesmo codigo passa a reprovar.
{
  const comRegistro = cenario(() => {}, ["Monitor-USD-Price"]);
  ok(aprovou(comRegistro["Monitor-USD-Price"]),
    "parseYahoo so no USD e urlKraken so em BTC/XMR: registrados, passam");

  const semRegistro = cenario((a, { registroFixture }) => {
    const reg = registroFixture({ presenca: { urlKraken: ["Monitor-BTC-Price", "Monitor-XMR-Price"] } });
    for (const repo of TRES) a[repo]["paridade-esperada.mjs"] = reg;
  }, ["Monitor-USD-Price"]);
  ok(semRegistro["Monitor-USD-Price"].codigo === 1 &&
     /FALTA\s+parseYahoo/.test(semRegistro["Monitor-USD-Price"].saida),
    "tirando parseYahoo do registro, a MESMA arvore reprova");

  // E o caminho oposto: o registro diz BTC e XMR, e o simbolo aparece
  // no USD. Ai sim e' SOBRA -- existe onde nao foi previsto.
  const foraDoPrevisto = cenario((a) => {
    a["Monitor-USD-Price"]["monitor.mjs"] +=
      "\nfunction urlKraken(cfg) {\n  return `https://kraken/${cfg}`;\n}\n";
  }, ["Monitor-USD-Price", "Monitor-BTC-Price"]);
  for (const repo of ["Monitor-USD-Price", "Monitor-BTC-Price"]) {
    const x = foraDoPrevisto[repo];
    ok(x.codigo === 1 && /SOBRA\s+urlKraken/.test(x.saida),
      `urlKraken aparecendo no USD reprova, visto de ${repo} (codigo ${x.codigo})`);
  }
  ok(/urlKraken:[^\n]*existe em Monitor-USD-Price/.test(foraDoPrevisto["Monitor-USD-Price"].saida),
    "e a mensagem nomeia o repositorio onde ele apareceu sem estar previsto");
}

// 5b. Apagar um simbolo que vem DEPOIS de uma expressao regular com
//     aspas dentro. Enquanto o recorte lia aquela aspa como string, o
//     simbolo seguinte nem existia no mapa -- e o que nao existe nos
//     tres nunca aparece como faltando em lugar nenhum.
{
  const r = cenario((a) => {
    a["Monitor-USD-Price"]["monitor.mjs"] = a["Monitor-USD-Price"]["monitor.mjs"]
      .replace(/export async function build[\s\S]*?\n}\n/, "");
  }, ["Monitor-USD-Price", "Monitor-BTC-Price"]);
  for (const repo of ["Monitor-USD-Price", "Monitor-BTC-Price"]) {
    const x = r[repo];
    ok(x.codigo === 1 && /FALTA\s+build/.test(x.saida),
      `apagar build (que vem depois de uma regex com aspas) reprova, visto de ${repo} (codigo ${x.codigo})`);
  }
}

// 5c. Apagar um simbolo previsto para UM repositorio so. Ele nao esta
//     em nenhum dos dois arquivos comparados -- some da uniao --, e por
//     isso passava sem ser notado: apagando calcularTrilho do USD, que
//     e' registrada como so-USD, os tres lados aprovavam com codigo 0.
//     A uniao passou a incluir o que o REGISTRO menciona.
{
  const r = cenario((a) => {
    a["Monitor-USD-Price"]["monitor.mjs"] = a["Monitor-USD-Price"]["monitor.mjs"]
      .replace(/function parseYahoo[\s\S]*?\n}\n/, "");
  });
  for (const repo of TRES) {
    const x = r[repo];
    ok(x.codigo === 1 && /FALTA\s+parseYahoo/.test(x.saida),
      `apagar um simbolo previsto so para um repositorio reprova, visto de ${repo} (codigo ${x.codigo})`);
  }
  ok(/parseYahoo:[^\n]*previsto em Monitor-USD-Price/.test(r["Monitor-BTC-Price"].saida),
    "e a mensagem diz de qual monitor ele sumiu, mesmo visto de fora");
}

// 5d. Entrada morta no registro de conteudo: cita um simbolo que nao
//     existe em lugar nenhum. Era ignorada em silencio, e uma lista de
//     excecoes que aceita nome inventado nao vale como registro.
{
  const r = cenario((a, { registroFixture }) => {
    const reg = registroFixture({
      conteudo: {
        "Monitor-BTC-Price|Monitor-XMR-Price": ["TITULO_PAGINA", "PAIRS", "funcaoQueNaoExisteMais"],
        "Monitor-BTC-Price|Monitor-USD-Price": ["TITULO_PAGINA", "PAIRS", "build", "escapar"],
        "Monitor-USD-Price|Monitor-XMR-Price": ["TITULO_PAGINA", "PAIRS", "build", "escapar"],
      },
    });
    for (const repo of TRES) a[repo]["paridade-esperada.mjs"] = reg;
  }, ["Monitor-BTC-Price"]);
  const x = r["Monitor-BTC-Price"];
  ok(x.codigo === 1 && /funcaoQueNaoExisteMais/.test(x.saida),
    `nome inventado em CONTEUDO_ACEITO reprova em vez de ser ignorado (codigo ${x.codigo})`);
}

// 6. Liberar o CONTEUDO nao libera a ausencia. PAIRS esta em
//    CONTEUDO_ACEITO nos tres pares; apagar PAIRS de um repositorio
//    continua sendo remocao.
{
  const r = cenario((a) => {
    a["Monitor-XMR-Price"]["monitor.mjs"] = a["Monitor-XMR-Price"]["monitor.mjs"]
      .replace(/^const PAIRS = .*$/m, "");
  }, ["Monitor-XMR-Price", "Monitor-BTC-Price"]);
  ok(r["Monitor-XMR-Price"].codigo === 1 && /FALTA\s+PAIRS/.test(r["Monitor-XMR-Price"].saida),
    `apagar um simbolo de conteudo liberado reprova (codigo ${r["Monitor-XMR-Price"].codigo})`);
  ok(r["Monitor-BTC-Price"].codigo === 1 && /FALTA\s+PAIRS/.test(r["Monitor-BTC-Price"].saida),
    "tambem visto do outro lado");
}

// 7. build: conteudo liberado contra o USD, obrigatoriamente igual
//    entre BTC e XMR. Mexer no build do BTC tem de ser pego -- e pego
//    pelo par certo.
{
  const r = cenario((a) => {
    a["Monitor-BTC-Price"]["monitor.mjs"] = a["Monitor-BTC-Price"]["monitor.mjs"]
      .replace('return fetchImpl("kraken");', 'return fetchImpl("kraken", { ordem: "invertida" });');
  }, ["Monitor-BTC-Price"]);
  const s = r["Monitor-BTC-Price"].saida;
  ok(r["Monitor-BTC-Price"].codigo === 1, `mudanca dentro de build reprova (codigo ${r["Monitor-BTC-Price"].codigo})`);
  ok(/DIFERE monitor\.mjs != Monitor-XMR-Price/.test(s) && /\bbuild\b/.test(s),
    "acusada contra o XMR, onde a implementacao tem de ser igual");
  ok(!/DIFERE monitor\.mjs != Monitor-USD-Price/.test(s),
    "e nao contra o USD, onde a divergencia de build esta registrada");
}

// 8. Comparacao incompleta nao e' aprovacao. Codigo 2, e sem a frase
//    de aprovacao.
{
  const r = cenario((a) => {
    a["Monitor-BTC-Price"]["teste-niveis.mjs"] = null; // nao existe aqui
  }, ["Monitor-BTC-Price"]);
  const x = r["Monitor-BTC-Price"];
  ok(x.codigo === 2, `arquivo faltando de um lado devolve codigo 2 (codigo ${x.codigo})`);
  ok(!/os tres monitores estao em paridade/.test(x.saida),
    "e nao imprime a frase de aprovacao");
  ok(/nao foram verificados|nao e' aprovacao/.test(x.saida),
    "a saida diz que a conferencia ficou incompleta");
}

// 9. Registro estragado tambem nao aprova.
{
  const r = cenario((a, { registroFixture }) => {
    const reg = registroFixture({ presenca: { urlKraken: ["Monitor-BTC-Prce"] } }); // typo
    for (const repo of TRES) a[repo]["paridade-esperada.mjs"] = reg;
  }, ["Monitor-BTC-Price"]);
  ok(r["Monitor-BTC-Price"].codigo === 2,
    `nome de repositorio errado no registro devolve codigo 2 (codigo ${r["Monitor-BTC-Price"].codigo})`);
  ok(!aprovou(r["Monitor-BTC-Price"]), "e nao aprova");
}

// ------------------------------------------------------------
// 10. OS TRES PROJETOS DE VERDADE.
//
// So roda quando os tres estao clonados lado a lado -- no CI existe um
// checkout so. Quando nao da', isso e' dito em voz alta: pular NAO e'
// passar.
// ------------------------------------------------------------
function acharIrmaos() {
  const eu = (readFileSync(join(AQUI, "monitor.mjs"), "utf8")
    .match(/const TITULO_PAGINA = "Monitor ([A-Z]+)/) || [])[1];
  const meuRepo = TRES.find((r) => r.includes(`-${eu}-`));
  if (!meuRepo) return null;
  const achados = { [meuRepo]: AQUI };
  for (const repo of TRES) {
    if (repo === meuRepo) continue;
    const tentativas = [join(AQUI, "..", repo), join(AQUI, "..", repo.toLowerCase())];
    const achou = tentativas.find((p) => existsSync(join(p, "monitor.mjs")));
    if (!achou) return null;
    achados[repo] = achou;
  }
  return achados;
}

{
  const irmaos = acharIrmaos();
  if (!irmaos) {
    pulados++;
    console.log("  pulado os tres projetos de verdade: nao estao clonados lado a lado. " +
      "Isso NAO e' aprovacao -- roda quando os tres estiverem no mesmo diretorio.");
  } else {
    const raiz = mkdtempSync(join(tmpdir(), "paridade-real-"));
    try {
      for (const [repo, origem] of Object.entries(irmaos)) {
        mkdirSync(join(raiz, repo), { recursive: true });
        // So os arquivos de topo: docs/ e .git nao entram na conferencia.
        for (const arq of [...IDENTICOS_FIXTURE, "monitor.mjs"])
          if (existsSync(join(origem, arq))) cpSync(join(origem, arq), join(raiz, repo, arq));
      }
      for (const repo of TRES) {
        const r = rodar(raiz, repo);
        ok(aprovou(r), `os tres projetos de verdade passam, rodando de ${repo} (codigo ${r.codigo})`);
      }
      // E a remocao relatada, nos projetos de verdade. O corte e' feito
      // no texto CRU: o corpo devolvido por simbolos() ja vem sem
      // comentario e sem linha em branco, entao nao e' um trecho literal
      // do arquivo. A primeira versao deste teste usava replace() com
      // ele, nao removia nada, e o cenario "passava" sem ter mexido em
      // coisa alguma -- foi o proprio teste que pegou.
      const alvo = join(raiz, "Monitor-BTC-Price", "monitor.mjs");
      const fonte = readFileSync(alvo, "utf8");
      const i = fonte.indexOf("export function atualizarEstadoNivel(");
      ok(i !== -1, "achou a declaracao de atualizarEstadoNivel no monitor.mjs de verdade");
      const resto = fonte.slice(i + 10);
      const j = resto.search(/\n(export )?(async )?(function|const|class) [A-Za-z_$]/);
      const semSimbolo = fonte.slice(0, i) + fonte.slice(i + 10 + j + 1);
      writeFileSync(alvo, semSimbolo);
      ok(!simbolos(semSimbolo).has("atualizarEstadoNivel"),
        "e o corte realmente tirou o simbolo do arquivo");
      for (const repo of TRES) {
        const r = rodar(raiz, repo);
        ok(r.codigo === 1 && /FALTA\s+atualizarEstadoNivel/.test(r.saida),
          `apagar atualizarEstadoNivel do BTC real reprova, visto de ${repo} (codigo ${r.codigo})`);
      }
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  }
}

console.log(
  falhas
    ? `${falhas} falha(s) na conferencia de paridade`
    : `${checagens} verificacoes da paridade passaram${pulados ? `, ${pulados} pulada(s)` : ""}.`
);
if (falhas) process.exit(1);
