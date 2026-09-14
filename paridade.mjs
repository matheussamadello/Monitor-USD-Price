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
//   monitor.mjs         simbolo a simbolo, sobre a UNIAO dos simbolos
//                       dos dois lados -- conteudo E presenca
//
// PRESENCA E CONTEUDO SAO CONFERIDOS SEPARADAMENTE. Ate hoje a
// comparacao rodava so sobre a INTERSECAO: funcao que sumisse de um
// repositorio saia da conta em silencio, e a paridade seguia
// aprovando. Reproduzido apagando atualizarEstadoNivel de uma copia do
// BTC -- 23 simbolos sumiram e o verificador terminou com codigo 0.
//
// Agora cada simbolo tem um lugar previsto (paridade-esperada.mjs):
// por padrao os tres, e as excecoes estao nomeadas uma a uma. Faltar
// onde e' previsto, ou existir onde nao e', reprova -- e' assim que
// remocao, adicao e renomeacao param de passar. Liberar o CONTEUDO de
// um simbolo nao libera a ausencia dele: sao duas permissoes.
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
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  REPOS,
  conteudoAceito,
  deveExistirEm,
  conferirRegistro,
} from "./paridade-esperada.mjs";

const IDENTICOS = [
  "ema89-semanal.mjs",
  "analisar-historico.mjs",
  "teste-ema89-semanal.mjs",
  "teste-retrato.mjs",
  "teste-paridade.mjs",
  "teste-niveis.mjs",
  "teste-limiares.mjs",
  // A propria conferencia: um scanner corrigido num repositorio so
  // deixaria os outros dois verificando menos do que pensam.
  "paridade.mjs",
  "paridade-esperada.mjs",
];
const BRUTO = (repo, arq) =>
  `https://raw.githubusercontent.com/matheussamadello/${repo}/main/${arq}`;

async function ler(eu, repo, arq) {
  if (repo === eu) return existsSync(arq) ? readFileSync(arq, "utf8") : null;
  for (const p of [`../${repo}/${arq}`, `../${repo.toLowerCase()}/${arq}`])
    if (existsSync(p)) return readFileSync(p, "utf8");
  // PARIDADE_SEM_REDE existe para o teste: sem ele, um irmao faltando
  // no disco seria buscado no GitHub, e o teste passaria a medir o
  // repositorio publicado em vez da copia que ele montou.
  if (process.env.PARIDADE_SEM_REDE) return null;
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
export function semComentarios(fonte) {
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
//
// DUAS ARMADILHAS, as duas descobertas por teste de mutacao -- mutar
// dentro de build() e dentro do PAGINA_CSS passava como "em paridade":
//
//   async   `export async function build(...)` nao casava com a
//           expressao, e build() e' justamente quem monta o relatorio
//           inteiro. Era o simbolo mais editado do projeto, e o unico
//           invisivel.
//
//   texto   contar chave por chave conta tambem o que esta DENTRO de
//           string e de template. `const PAGINA_CSS = \`` nao tem uma
//           chave sequer na primeira linha, entao a profundidade ja
//           comecava em zero e o simbolo fechava ali -- as 142 linhas
//           de CSS ficavam de fora. Por isso a varredura abaixo pula o
//           conteudo de aspas e de crase.
const DECLARACAO = /^(?:export )?(?:async )?(?:function|const|class) ([A-Za-z_$][\w$]*)/;

function podeIniciarRegex(anterior) {
  if (anterior === "") return true;
  return !/[A-Za-z0-9_$)\]]/.test(anterior);
}

export function simbolos(fonte) {
  const out = new Map();
  const topo = [];
  let nome = null, buf = [], prof = 0, emTemplate = false;
  for (const l of semComentarios(fonte).split("\n")) {
    if (!nome) {
      const m = l.match(DECLARACAO);
      // Fora de qualquer declaracao: imports e o bloco de execucao
      // direta, onde estao os writeFileSync que publicam a pagina, o
      // relatorio e o estado. Sao 45 linhas que ninguem conferia.
      if (!m) { topo.push(l); continue; }
      nome = m[1];
    }
    buf.push(l);
    let i = 0;
    // Ultimo caractere significativo, para separar divisao de inicio de
    // expressao regular: depois de nome, `)` ou `]` a barra divide;
    // depois de `(`, `,`, `=` e afins, ela abre uma regex.
    let anterior = "";
    while (i < l.length) {
      const c = l[i];
      if (emTemplate) {
        if (c === "\\") i++;
        else if (c === "`") emTemplate = false;
        i++;
        continue;
      }
      if (c === "`") { emTemplate = true; i++; continue; }
      if (c === '"' || c === "'") {
        const aspas = c;
        i++;
        while (i < l.length && l[i] !== aspas) { if (l[i] === "\\") i++; i++; }
        i++;
        continue;
      }
      // EXPRESSAO REGULAR. Terceiro furo do recorte, e o mais silencioso
      // dos tres: `.replace(/'/g, "&#39;")` tem uma aspa DENTRO da
      // expressao. Sem reconhecer a barra, o scanner lia essa aspa como
      // inicio de string, engolia o resto da linha junto com o
      // parentese de fechamento, e a profundidade nunca voltava a zero.
      // Efeito medido: pgEsc ocupava 596 linhas e engolia 23 simbolos
      // -- toHTML, leituraLonga, leituraCurta, EXPLICACOES e o bloco de
      // execucao direta entre eles. Divergencia de conteudo ainda era
      // pega (dentro de pgEsc), mas com o nome errado, e a conferencia
      // de PRESENCA nao alcancava nenhum deles.
      if (c === "/" && podeIniciarRegex(anterior)) {
        i++;
        let classe = false;
        while (i < l.length) {
          const d = l[i];
          if (d === "\\") { i += 2; continue; }
          if (d === "[") classe = true;
          else if (d === "]") classe = false;
          else if (d === "/" && !classe) { i++; break; }
          i++;
        }
        while (i < l.length && /[a-z]/.test(l[i])) i++; // flags
        anterior = "/";
        continue;
      }
      if (c === "{" || c === "[" || c === "(") prof++;
      else if (c === "}" || c === "]" || c === ")") prof--;
      if (c.trim()) anterior = c;
      i++;
    }
    // Template aberto continua na linha seguinte: o simbolo so termina
    // quando a crase fechar.
    if (prof <= 0 && !emTemplate) {
      out.set(nome, buf.join("\n")); nome = null; buf = []; prof = 0;
    }
  }
  if (nome) out.set(nome, buf.join("\n"));
  // Pseudo-simbolo: nome impossivel em JavaScript, para nunca colidir
  // com um de verdade.
  out.set("<topo>", topo.join("\n"));
  return out;
}

// So confere quando chamado na linha de comando: importado por um
// teste, o arquivo entrega apenas as funcoes acima.
const executadoDireto = (() => {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (executadoDireto) {
  // Qual deles somos nos. Sai do proprio monitor.mjs, para o arquivo
  // continuar identico nos tres.
  const meuMonitor = readFileSync("monitor.mjs", "utf8");
  const marca = (meuMonitor.match(/const TITULO_PAGINA = "Monitor ([A-Z]+)/) || [])[1];
  const eu = REPOS.find((r) => r.includes(`-${marca}-`));
  if (!eu) {
    console.log("FALHA  nao consegui identificar qual monitor e' este");
    process.exit(2);
  }

  // Registro errado nao pode virar aprovacao: um nome de repositorio
  // com erro de digitacao passaria a exigir o simbolo num lugar que nao
  // existe, ou a liberar um que existe.
  const problemas = conferirRegistro();
  if (problemas.length) {
    console.log("FALHA  paridade-esperada.mjs esta inconsistente:");
    for (const p of problemas) console.log(`         ${p}`);
    process.exit(2);
  }

  let divergencias = 0, naoVerificados = 0;
  const outros = REPOS.filter((r) => r !== eu);
  console.log(`paridade de ${eu} contra ${outros.join(" e ")}\n`);

  for (const arq of IDENTICOS) {
    const meu = await ler(eu, eu, arq);
    if (meu === null) { console.log(`  ?      ${arq}: nao existe aqui`); naoVerificados++; continue; }
    for (const outro of outros) {
      const dele = await ler(eu, outro, arq);
      if (dele === null) { console.log(`  ?      ${arq} vs ${outro}: nao deu para ler`); naoVerificados++; continue; }
      if (dele === meu) console.log(`  ok     ${arq} == ${outro}`);
      else { console.log(`  DIFERE ${arq} != ${outro}`); divergencias++; }
    }
  }

  const meus = simbolos(meuMonitor);
  for (const outro of outros) {
    const fonte = await ler(eu, outro, "monitor.mjs");
    if (fonte === null) { console.log(`  ?      monitor.mjs vs ${outro}: nao deu para ler`); naoVerificados++; continue; }
    const deles = simbolos(fonte);
    const ok = conteudoAceito(eu, outro);

    // UNIAO, nao intersecao. O simbolo que existe so de um lado e'
    // justamente o caso que precisa ser julgado.
    const nomes = [...new Set([...meus.keys(), ...deles.keys()])].sort();

    const faltando = [];   // previsto naquele repositorio e nao esta la
    const naoPrevistos = []; // esta la sem estar previsto
    const divergemTodas = [];
    const divergemNaoPrevistas = [];
    let comparados = 0;

    for (const s of nomes) {
      const onde = deveExistirEm(s);
      const lados = [[eu, meus.has(s)], [outro, deles.has(s)]];
      for (const [repo, tem] of lados) {
        if (onde.has(repo) && !tem) faltando.push([s, repo]);
        if (!onde.has(repo) && tem) naoPrevistos.push([s, repo]);
      }
      // Conteudo so se compara onde os dois lados devem ter o simbolo e
      // de fato tem. Ausencia ja foi julgada acima, e julgar duas vezes
      // so confundiria a mensagem.
      if (onde.has(eu) && onde.has(outro) && meus.has(s) && deles.has(s)) {
        comparados++;
        if (meus.get(s) !== deles.get(s)) {
          divergemTodas.push(s);
          if (!ok.has(s)) divergemNaoPrevistas.push(s);
        }
      }
    }

    // Higiene do registro: entrada que ja nao serve para nada vira
    // aviso, para a lista nao virar folclore.
    const voltaram = [...ok].filter(
      (k) => meus.has(k) && deles.has(k) && !divergemTodas.includes(k)
    );
    if (voltaram.length)
      console.log(`  aviso  ${voltaram.length} simbolo(s) em CONTEUDO_ACEITO ja nao divergem ` +
        `de ${outro}: ${voltaram.join(", ")}. Podem sair de paridade-esperada.mjs.`);

    // A mensagem nao adivinha se foi remocao ou adicao -- as duas
    // chegam aqui com a mesma cara. Ela diz o que se sabe: onde o
    // simbolo devia estar, onde esta, e onde consertar.
    const ondeEsta = (sim) =>
      [[eu, meus.has(sim)], [outro, deles.has(sim)]]
        .filter(([, tem]) => tem)
        .map(([r]) => r)
        .join(" e ") || "nenhum dos dois";
    for (const [s, repo] of faltando) {
      console.log(`  FALTA  ${s}: previsto em ${repo} e nao esta la; existe em ${ondeEsta(s)} ` +
        `(comparando ${eu} com ${outro}). Se sumiu, reponha; se e' novo e so de alguns, ` +
        `registre em PRESENCA_ESPERADA dizendo em quais monitores deve existir.`);
      divergencias++;
    }
    for (const [s, repo] of naoPrevistos) {
      console.log(`  SOBRA  ${s}: existe em ${repo}, que nao esta na lista de ` +
        `PRESENCA_ESPERADA (prevista: ${[...deveExistirEm(s)].join(", ")}) ` +
        `(comparando ${eu} com ${outro}).`);
      divergencias++;
    }
    if (divergemNaoPrevistas.length) {
      console.log(`  DIFERE monitor.mjs != ${outro} em ${divergemNaoPrevistas.length} de ${comparados} simbolos comparados:`);
      for (const k of divergemNaoPrevistas.slice(0, 15)) console.log(`           ${k}`);
      if (divergemNaoPrevistas.length > 15) console.log(`           ... e mais ${divergemNaoPrevistas.length - 15}`);
      divergencias += divergemNaoPrevistas.length;
    }
    if (!faltando.length && !naoPrevistos.length && !divergemNaoPrevistas.length) {
      const soLa = nomes.filter((s) => !meus.has(s)).length;
      const soAqui = nomes.filter((s) => !deles.has(s)).length;
      console.log(`  ok     monitor.mjs == ${outro}: ${nomes.length} simbolos no total, ` +
        `${comparados} comparados no conteudo (${divergemTodas.length} divergem, todas previstas), ` +
        `${soAqui} so aqui e ${soLa} so la, todos previstos`);
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
}
