// Le docs/historico.jsonl e responde a unica pergunta que importa:
// depois de cada condicao publicada, o preco foi para onde?
//
// Nao toca a rede, nao altera nada, nao decide nada. So mede.
//
// Uso:  node analisar-historico.mjs [horizonte_em_velas]
//
// O horizonte padrao e' 10 velas fechadas, que no diario e' cerca de
// duas semanas -- o piso do horizonte tatico deste monitor. Passe outro
// numero para comparar: uma condicao util deveria continuar util em 5 e
// em 20; uma que so "funciona" num horizonte especifico e' ruido.
import { readFileSync } from "node:fs";

const HORIZONTE = Number(process.argv[2] || 10);
const MIN_AMOSTRAS = 5;

let linhas;
try {
  linhas = readFileSync("docs/historico.jsonl", "utf8").trim().split("\n").filter(Boolean);
} catch {
  console.log("Nao ha docs/historico.jsonl ainda. Ele comeca a ser escrito na");
  console.log("proxima execucao do monitor, uma linha por vela fechada.");
  process.exit(0);
}

const entradas = linhas.map((l) => JSON.parse(l));

// Uma serie de precos por par e timeframe, indexada pela vela fechada.
// Varias execucoes podem ter escrito a mesma vela; a primeira vale.
const series = new Map();
for (const e of entradas) {
  const k = `${e.par}|${e.tf}`;
  if (!series.has(k)) series.set(k, new Map());
  const m = series.get(k);
  if (e.vela && typeof e.fech === "number" && !m.has(e.vela)) m.set(e.vela, e.fech);
}
const ordenadas = new Map();
for (const [k, m] of series) {
  ordenadas.set(k, [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

// Retorno da vela V ate HORIZONTE velas fechadas depois, em ATR --
// nao em porcentagem. O projeto inteiro mede em ATR pelo mesmo motivo:
// 3% e' muito num par de cambio e pouco num de cripto, e uma tabela que
// mistura os dois nao quer dizer nada.
function retorno(par, tf, vela, atr) {
  const serie = ordenadas.get(`${par}|${tf}`);
  if (!serie || !(atr > 0)) return null;
  const i = serie.findIndex(([v]) => v === vela);
  if (i < 0 || i + HORIZONTE >= serie.length) return null;
  return (serie[i + HORIZONTE][1] - serie[i][1]) / atr;
}

// Cada condicao publicada vira uma linha da tabela. O par faz parte da
// chave: XMR/USD e XMR/BTC, por exemplo, sao mercados diferentes e nao
// podem compartilhar a mesma amostra so porque publicaram o mesmo nome.
const balde = new Map();
const anota = (nome, par, tf, r) => {
  const k = `${par} | ${tf} | ${nome}`;
  if (!balde.has(k)) balde.set(k, []);
  balde.get(k).push(r);
};
let semFuturo = 0;
for (const e of entradas) {
  const r = retorno(e.par, e.tf, e.vela, e.atr);
  if (r === null) { semFuturo++; continue; }
  for (const a of e.alertas) anota(`alerta:${a}`, e.par, e.tf, r);
  for (const a of e.deterioracao) anota(`deterioracao:${a}`, e.par, e.tf, r);
  for (const a of e.conf_entrada) anota(`conf_entrada:${a}`, e.par, e.tf, r);
  for (const a of e.conf_pullback) anota(`conf_pullback:${a}`, e.par, e.tf, r);
  for (const a of e.niveis_mud) anota(`nivel:${a}`, e.par, e.tf, r);
  if (e.estrutura) anota(`estrutura=${e.estrutura}`, e.par, e.tf, r);
  if (e.ema89_cruz && e.ema89_cruz !== "nenhum") anota(`ema89_cruzou=${e.ema89_cruz}`, e.par, e.tf, r);
  anota("TODAS AS VELAS (referencia)", e.par, e.tf, r);
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

console.log(`Historico: ${entradas.length} entradas, ${ordenadas.size} series.`);
console.log(`Horizonte: ${HORIZONTE} velas fechadas. Retorno em ATR da vela do sinal.`);
console.log(`Sem futuro suficiente para medir: ${semFuturo} entradas.\n`);

// Agora ha uma referencia independente por par e timeframe. Basta que
// ao menos uma delas tenha amostra suficiente para a tabela ser util.
const temBase = [...balde.entries()].some(
  ([k, v]) => k.endsWith("TODAS AS VELAS (referencia)") && v.length >= MIN_AMOSTRAS
);
if (!temBase) {
  console.log("Ainda nao ha amostras suficientes para dizer nada.");
  console.log("Isto e' esperado: o registro acabou de comecar. Volte a rodar");
  console.log("depois de alguns meses de historico.");
  process.exit(0);
}

const linhasTab = [...balde.entries()]
  .filter(([, v]) => v.length >= MIN_AMOSTRAS)
  .map(([k, v]) => ({
    nome: k,
    n: v.length,
    med: mediana(v),
    subiu: (100 * v.filter((x) => x > 0).length) / v.length,
  }))
  .sort((a, b) => b.med - a.med);

const larg = Math.max(...linhasTab.map((l) => l.nome.length));
console.log("condicao".padEnd(larg) + "    n   mediana(ATR)   subiu");
console.log("-".repeat(larg + 30));
for (const l of linhasTab) {
  console.log(
    l.nome.padEnd(larg) +
      String(l.n).padStart(5) +
      l.med.toFixed(2).padStart(15) +
      (l.subiu.toFixed(0) + "%").padStart(8)
  );
}
console.log(
  "\nCompare cada linha com a referencia do MESMO par e timeframe, nao com zero:"
);
console.log(
  "ela e' o que aquele mercado fez em TODAS as velas. Uma condicao que nao"
);
console.log("bate a propria referencia nao acrescenta informacao, por melhor que pareca o numero absoluto.");
console.log(
  `\nCom menos de ${MIN_AMOSTRAS} amostras a condicao e' omitida: nao da' para concluir nada.`
);
