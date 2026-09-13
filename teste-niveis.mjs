// ------------------------------------------------------------
// A MAQUINA DE ROMPIMENTO E RETESTE, CICLO POR CICLO
//
// Esta e' a parte do monitor que o relatorio usa para dizer "rompeu",
// "voltou a testar" ou "perdeu o suporte" -- e era a menos testada.
// O teste de retrato passa o relatorio inteiro por um cassete gravado,
// mas naquele cassete NENHUM nivel chega a entrar em reteste: mutar a
// tolerancia do reteste de 0,25 para 0,40 ATR nao quebrava nada.
//
// Aqui cada transicao e' dirigida a mao, vela a vela, com os numeros
// escolhidos de proposito em cima das bordas: uma vela um centesimo
// para dentro da zona e outra um centesimo para fora.
//
// As distancias sao dadas em ATR pelo chamador (tolAtr, resetAtr), que
// e' como o relatorio as passa. O que se prende aqui e' a REGRA; a
// calibragem de cada par fica na configuracao.
// ------------------------------------------------------------
import { atualizarEstadoNivel, chaveNivel } from "./monitor.mjs";

let falhas = 0, checagens = 0;
const ok = (c, m) => {
  checagens++;
  if (c) console.log(`  ok     ${m}`);
  else { console.log(`  FALHA  ${m}`); falhas++; }
};

const DIA = 86400;
const NIVEL = 1000;
const ATR = 100;
// tol = 25 (0,25 ATR), reset = 150 (1,5 ATR)
const base = { nivel: NIVEL, atr: ATR, tolAtr: 0.25, resetAtr: 1.5, maxCandles: 30, segundos: DIA };

let t = 1_700_000_000;
const proxima = () => (t += DIA);

// Vela com corpo inteiro de um lado, salvo quando se pede pavio.
function vela(close, { open = null, high = null, low = null, tempo = null } = {}) {
  const o = open === null ? close : open;
  return {
    time: tempo === null ? proxima() : tempo,
    open: o,
    close,
    high: high === null ? Math.max(o, close) : high,
    low: low === null ? Math.min(o, close) : low,
  };
}

const passo = (anterior, v, direcao = "alta") =>
  atualizarEstadoNivel(anterior, { ...base, direcao, vela: v });

console.log("\n== rompimento de resistencia, do candidato ao reteste confirmado ==");
{
  // Corpo inteiro acima do nivel: rompimento pelo criterio rigoroso.
  let e = passo(null, vela(1060, { open: 1010 }));
  ok(e && e.estado === "rompido", `corpo inteiro acima vira rompido (${e && e.estado})`);
  ok(e.afastado === "nao" || e.afastado === false,
    `60 abaixo do reset de 150: afastado ${JSON.stringify(e.afastado)}`);

  // Volta para dentro da zona de tolerancia (1000 +- 25).
  e = passo(e, vela(1010, { open: 1050 }));
  ok(e.estado === "em_reteste", `fechamento a 10 do nivel entra em reteste (${e.estado})`);

  // Um centesimo ACIMA da borda da zona: sai do reteste confirmando.
  e = passo(e, vela(1025.01, { open: 1005 }));
  ok(e.estado === "reteste_confirmado",
    `fechamento a 25,01 (fora da tolerancia de 25) confirma o reteste (${e.estado})`);

  // Afastamento encerra o ciclo: volta a ser so "rompido".
  e = passo(e, vela(1150.01, { open: 1100 }));
  ok(e.estado === "rompido", `a 150,01 do nivel o ciclo encerra e volta a rompido (${e.estado})`);
  ok(e.afastado === "sim" || e.afastado === true, "e o nivel passa a marcar afastado");
}

console.log("\n== a borda da tolerancia, dos dois lados ==");
{
  // 1024,99: ainda DENTRO da zona -> reteste. 1025,01: ja FORA.
  let dentro = passo(passo(null, vela(1060, { open: 1010 })), vela(1024.99, { open: 1050 }));
  ok(dentro.estado === "em_reteste", `1024,99 ainda e' zona de reteste (${dentro.estado})`);

  let fora = passo(passo(null, vela(1060, { open: 1010 })), vela(1025.01, { open: 1050 }));
  ok(fora.estado !== "em_reteste",
    `1025,01 ja nao e' zona de reteste (${fora.estado})`);
}

console.log("\n== rompimento que falha e depois se recupera ==");
{
  let e = passo(null, vela(1060, { open: 1010 }));
  // Fecha do lado contrario, alem da tolerancia: o rompimento falhou.
  e = passo(e, vela(970, { open: 1040 }));
  ok(e.estado === "rompimento_falhou", `fechamento em 970 reprova o rompimento (${e.estado})`);
  // E o preco volta para o lado valido.
  e = passo(e, vela(1040, { open: 990 }));
  ok(e.estado === "recuperado", `voltar acima da zona recupera (${e.estado})`);
}

console.log("\n== perda de suporte: a mesma maquina, direcao invertida ==");
{
  let e = passo(null, vela(940, { open: 990 }), "baixa");
  ok(e && e.estado === "rompido", `corpo inteiro abaixo perde o suporte (${e && e.estado})`);
  ok(e.direcao === "baixa", "o registro guarda a direcao da perda");
  e = passo(e, vela(990, { open: 950 }), "baixa");
  ok(e.estado === "em_reteste", `voltar ao nivel e' reteste, nao recuperacao (${e.estado})`);
  e = passo(e, vela(1030, { open: 1000 }), "baixa");
  ok(e.estado === "rompimento_falhou",
    `fechar bem ACIMA do suporte perdido reprova a perda (${e.estado})`);
}

console.log("\n== uma transicao por vela fechada ==");
{
  const v1 = vela(1060, { open: 1010 });
  let e = passo(null, v1);
  const estadoDepoisDeUma = e.estado;
  // Mesma vela de novo (reexecucao horaria sobre a mesma barra).
  const repetida = { ...v1 };
  e = passo(e, repetida);
  ok(e.estado === estadoDepoisDeUma,
    `reexecutar sobre a mesma vela nao avanca o ciclo (${e.estado})`);
  // Uma vela ANTERIOR tambem nao pode andar com a maquina.
  const atrasada = vela(1010, { open: 1050, tempo: v1.time - DIA });
  e = passo(e, atrasada);
  ok(e.estado === estadoDepoisDeUma,
    `vela mais velha que a ultima avaliada nao avanca o ciclo (${e.estado})`);
}

console.log("\n== abandono e reencontro ==");
{
  let e = passo(null, vela(1060, { open: 1010 }));
  // Passa o limite de maxCandles velas longe, sem tocar no nivel.
  for (let i = 0; i < 31; i++) e = passo(e, vela(1500 + i, { open: 1500 + i }));
  ok(e.estado === "arquivado", `31 velas sem contato arquivam o registro (${e.estado})`);
  const historicoArquivado = (e.historico || []).join(" ");
  // Reencostar reabre o ciclo em vez de anunciar um rompimento novo.
  e = passo(e, vela(1005, { open: 1400 }));
  ok(e.estado === "em_reteste",
    `reencostar no nivel reabre o ciclo em reteste (${e.estado})`);
  ok(!/rompido@.*rompido@/.test(historicoArquivado + " " + (e.historico || []).join(" ")),
    "e nao republica o mesmo rompimento como novidade");
}

console.log("\n== historico limitado ==");
{
  let e = passo(null, vela(1060, { open: 1010 }));
  // Vai e volta muitas vezes, produzindo mais transicoes que o teto.
  for (let i = 0; i < 12; i++) {
    e = passo(e, vela(1010, { open: 1050 }));
    e = passo(e, vela(1060, { open: 1020 }));
  }
  ok(e.historico.length > 0 && e.historico.length <= 5,
    `o historico do nivel para de crescer em 5 entradas (${e.historico.length})`);
}

console.log("\n== chave do nivel ==");
{
  const a = chaveNivel("usd", "diario", "80000");
  const b = chaveNivel("usd", "semanal", "80000");
  ok(a !== b, "o mesmo nivel em timeframes diferentes tem chaves diferentes");
  ok(a.includes("usd") && a.includes("diario") && a.includes("80000"),
    `a chave carrega par, timeframe e nivel (${a})`);
}

console.log(
  falhas
    ? `${falhas} falha(s) na maquina de niveis`
    : `${checagens} verificacoes da maquina de niveis passaram.`
);
if (falhas) process.exit(1);
