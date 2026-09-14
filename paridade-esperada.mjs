// ------------------------------------------------------------
// DIVERGENCIAS ACEITAS ENTRE OS TRES MONITORES
//
// A regra do projeto sempre foi "o motor e' o mesmo, so a configuracao
// muda". Ao automatizar a conferencia, apareceu que isso nunca foi
// literalmente verdade: alguns simbolos divergem por motivo legitimo, e
// um deles e' um fato que vale saber.
//
// SAO DUAS PERMISSOES DIFERENTES, e o arquivo as mantem separadas de
// proposito:
//
//   CONTEUDO_ACEITO    o simbolo existe NOS DOIS repositorios, e so o
//                      corpo dele difere. Continua OBRIGATORIO nos
//                      dois: apagar a funcao de um lado nao e' uma
//                      "diferenca de conteudo", e' uma remocao.
//
//   PRESENCA_ESPERADA  o simbolo existe SO em alguns repositorios, e a
//                      lista diz em quais. Quem nao aparece aqui e'
//                      obrigatorio nos tres.
//
// Confundir as duas era o furo: enquanto a conferencia comparava
// apenas a intersecao dos simbolos, uma funcao que sumisse de um
// repositorio simplesmente saia da conta, e a paridade continuava
// aprovando. Reproduzido apagando atualizarEstadoNivel de uma copia do
// BTC: sumiram 23 simbolos e o verificador terminou com codigo 0.
//
// ATENCAO a um item de CONTEUDO_ACEITO: readPair e relatorioParaJSON
// divergem porque o codigo da RESISTENCIA MACRO existe so no XMR. Nos
// outros dois, marcar `resistenciaMacro` na configuracao nao faz nada
// -- o codigo que leria esse campo nao esta la. Isso e' armadilha, nao
// configuracao, e esta registrado aqui para nao se perder de vista.
// ------------------------------------------------------------
export const REPOS = [
  "Monitor-BTC-Price",
  "Monitor-XMR-Price",
  "Monitor-USD-Price",
];

// ------------------------------------------------------------
// PERMISSAO 1: o corpo pode diferir.
//
// Chave: o par de repositorios, em ordem alfabetica. Estar aqui NAO
// autoriza o simbolo a faltar em nenhum dos dois -- para isso existe a
// lista de baixo.
// ------------------------------------------------------------
export const CONTEUDO_ACEITO = {
  // Configuracao pura: pares, faixas manuais, titulo da pagina.
  "Monitor-BTC-Price|Monitor-XMR-Price": [
    "AGENTE_HTTP",
    "NIVEIS_USD",
    "PAIRS",
    "TITULO_PAGINA",
    "TITULO_ALERTA",
    // Resistencia macro, so no XMR. Ver o aviso acima.
    "readPair",
    "relatorioParaJSON",
  ],

  // O monitor de USD le de outras fontes (Yahoo e Binance, nao Kraken),
  // acompanha um par sem volume publico e tem o trilho de execucao.
  // Isso alcanca a calibragem do cambio, o volume e as zonas.
  "Monitor-BTC-Price|Monitor-USD-Price": [
    "AGENTE_HTTP",
    "NIVEIS_USD",
    "PAIRS",
    "TITULO_PAGINA",
    "TITULO_ALERTA",
    "TIMEFRAMES",
    "DIV_MIN_PRECO_PCT",
    "RETEST_TOLERANCIA_PCT_FALLBACK",
    "RETEST_RESET_PCT_FALLBACK",
    "ZONA_LARGURA_MIN_PCT",
    "ZONA_LARGURA_MAX_PCT",
    "analisarVolume",
    "alertasTecnicos",
    "avaliarGatilhos",
    "calcularZonas",
    "pontuarZona",
    "volumeSemanaEquivalente",
    "readPair",
    "relatorioParaJSON",
    // Busca em cascata com duas fontes por par, contra uma chamada
    // unica a Kraken.
    "build",
  ],

  // Mesma lista do par acima: o que separa o USD dos outros dois e' a
  // fonte, e isso vale igual contra BTC e contra XMR.
  "Monitor-USD-Price|Monitor-XMR-Price": [
    "AGENTE_HTTP",
    "NIVEIS_USD",
    "PAIRS",
    "TITULO_PAGINA",
    "TITULO_ALERTA",
    "TIMEFRAMES",
    "DIV_MIN_PRECO_PCT",
    "RETEST_TOLERANCIA_PCT_FALLBACK",
    "RETEST_RESET_PCT_FALLBACK",
    "ZONA_LARGURA_MIN_PCT",
    "ZONA_LARGURA_MAX_PCT",
    "analisarVolume",
    "alertasTecnicos",
    "avaliarGatilhos",
    "calcularZonas",
    "pontuarZona",
    "volumeSemanaEquivalente",
    "readPair",
    "relatorioParaJSON",
    "build",
  ],
};

// ------------------------------------------------------------
// PERMISSAO 2: o simbolo existe so em alguns repositorios.
//
// Cada entrada diz, nominalmente, ONDE o simbolo deve existir. Simbolo
// que nao esta nesta lista e' obrigatorio nos TRES: some de um, a
// conferencia reprova; aparece so em um, tambem.
//
// Nao ha regra automatica aqui de proposito. "Funcao exclusiva deve
// ser configuracao" e' exatamente a suposicao que deixava uma remocao
// passar por configuracao nova.
// ------------------------------------------------------------
export const PRESENCA_ESPERADA = {
  // --- Kraken: a fonte dos dois monitores de cripto. O USD le de
  //     Yahoo e Binance e nao tem nem o montador de URL nem o parser.
  urlKraken: ["Monitor-BTC-Price", "Monitor-XMR-Price"],
  parseKraken: ["Monitor-BTC-Price", "Monitor-XMR-Price"],

  // --- Configuracao do segundo par de cada monitor.
  NIVEIS_BTC: ["Monitor-XMR-Price"], // faixas do XMR/BTC
  NIVEIS_USDT: ["Monitor-USD-Price"], // faixas do USDT/BRL

  // --- Fontes do cambio: cascata de provedores, com um parser por
  //     provedor. Nada disso existe onde a fonte e' uma so.
  HOSTS_YAHOO: ["Monitor-USD-Price"],
  FONTES_CAMBIO: ["Monitor-USD-Price"],
  FONTES_CRIPTO: ["Monitor-USD-Price"],
  buscarSerie: ["Monitor-USD-Price"],
  parseYahoo: ["Monitor-USD-Price"],
  parseBinance: ["Monitor-USD-Price"],
  parseMercadoBitcoin: ["Monitor-USD-Price"],
  montarSerie: ["Monitor-USD-Price"],
  MAX_VELAS: ["Monitor-USD-Price"],

  // --- Ancoragem de periodo: as fontes do cambio carimbam a vela em
  //     fusos e recortes proprios, e a Kraken ja entrega ancorado.
  ancorarDia: ["Monitor-USD-Price"],
  inicioSemana: ["Monitor-USD-Price"],
  SEMANA: ["Monitor-USD-Price"],

  // --- Trilho de execucao: compara USDT/BRL com USD/BRL para dizer se
  //     o premio da corretora esta caro. So faz sentido onde existem os
  //     dois lados da conta.
  TRILHO_JANELA: ["Monitor-USD-Price"],
  TRILHO_PCT_BARATO: ["Monitor-USD-Price"],
  TRILHO_PCT_CARO: ["Monitor-USD-Price"],
  calcularTrilho: ["Monitor-USD-Price"],
  blocoTrilho: ["Monitor-USD-Price"],
  serieParaTrilho: ["Monitor-USD-Price"],
  medianaDe: ["Monitor-USD-Price"],
  percentilNa: ["Monitor-USD-Price"],
};

// Conjunto de simbolos cujo CORPO pode diferir entre estes dois
// repositorios. Presenca e' outra conversa -- ver abaixo.
export function conteudoAceito(a, b) {
  const chave = [a, b].sort().join("|");
  return new Set(CONTEUDO_ACEITO[chave] || []);
}

// Em quais repositorios este simbolo DEVE existir. O padrao e' todos.
export function deveExistirEm(simbolo) {
  const previsto = PRESENCA_ESPERADA[simbolo];
  return new Set(previsto || REPOS);
}

// Confere o proprio registro. Uma entrada com nome de repositorio
// errado nao reprovaria nada -- passaria a exigir o simbolo num lugar
// que nao existe, ou a liberar um que existe. Erro de registro vira
// "nao deu para verificar", nunca aprovacao.
export function conferirRegistro() {
  const problemas = [];
  for (const [simbolo, onde] of Object.entries(PRESENCA_ESPERADA)) {
    if (!Array.isArray(onde) || onde.length === 0) {
      problemas.push(`${simbolo}: a lista de repositorios esta vazia`);
      continue;
    }
    for (const r of onde)
      if (!REPOS.includes(r))
        problemas.push(`${simbolo}: "${r}" nao e' um dos tres monitores`);
    if (onde.length === REPOS.length)
      problemas.push(
        `${simbolo}: listado nos tres, o que e' o padrao -- a entrada nao faz nada e deve sair`
      );
  }
  for (const [par, lista] of Object.entries(CONTEUDO_ACEITO)) {
    const partes = par.split("|");
    if (partes.length !== 2 || partes.some((p) => !REPOS.includes(p)))
      problemas.push(`${par}: nao e' um par valido de monitores`);
    if ([...partes].sort().join("|") !== par)
      problemas.push(`${par}: a chave precisa estar em ordem alfabetica`);
  }
  return problemas;
}
