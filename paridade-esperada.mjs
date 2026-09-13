// ------------------------------------------------------------
// DIVERGENCIAS ACEITAS ENTRE OS TRES MONITORES
//
// A regra do projeto sempre foi "o motor e' o mesmo, so a configuracao
// muda". Ao automatizar a conferencia, apareceu que isso nunca foi
// literalmente verdade: alguns simbolos divergem por motivo legitimo, e
// um deles e' um fato que vale saber.
//
// Este arquivo e' a linha de base. O paridade.mjs falha quando um
// simbolo FORA desta lista diverge -- que e' o caso de alguem corrigir
// um bug num repositorio so. Simbolo que esta aqui e voltou a ser igual
// vira aviso, nao falha, e deve sair da lista.
//
// ATENCAO a um item: readPair e relatorioParaJSON divergem porque o
// codigo da RESISTENCIA MACRO existe so no XMR. Nos outros dois, marcar
// `resistenciaMacro` na configuracao nao faz nada -- o codigo que leria
// esse campo nao esta la. Isso e' armadilha, nao configuracao, e esta
// registrado aqui para nao se perder de vista.
// ------------------------------------------------------------
export const DIVERGENCIAS_ACEITAS = {
  // Configuracao pura: pares, faixas manuais, titulo da pagina.
  "Monitor-BTC-Price|Monitor-XMR-Price": [
    "NIVEIS_USD",
    "PAIRS",
    "TITULO_PAGINA",
    // Resistencia macro, so no XMR. Ver o aviso acima.
    "readPair",
    "relatorioParaJSON",
  ],

  // O monitor de USD le de outras fontes (Yahoo e Binance, nao Kraken),
  // acompanha um par sem volume publico e tem o trilho de execucao.
  // Isso alcanca a calibragem do cambio, o volume e as zonas.
  "Monitor-BTC-Price|Monitor-USD-Price": [
    "NIVEIS_USD",
    "PAIRS",
    "TITULO_PAGINA",
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
  ],

  // Mesma lista do par acima: o que separa o USD dos outros dois e' a
  // fonte, e isso vale igual contra BTC e contra XMR.
  "Monitor-USD-Price|Monitor-XMR-Price": [
    "NIVEIS_USD",
    "PAIRS",
    "TITULO_PAGINA",
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
  ],
};

export function aceitas(a, b) {
  const chave = [a, b].sort().join("|");
  return new Set(DIVERGENCIAS_ACEITAS[chave] || []);
}
