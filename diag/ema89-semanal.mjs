// Travessia macro: apenas fechamentos semanais, com a margem de 0,25 ATR
// ja definida nos prompts. O cruzamento bruto continua sendo outro dado.
export const MARGEM_EMA89_SEMANAL_ATR = 0.25;
const SEMANA = 604800;
const ladoDe = (close, ema) => close >= ema ? "acima" : "abaixo";
const vazio = () => ({ atualizado: null, estado: "neutra", direcao: null,
  cruzouEm: null, confirmouEm: null, cancelouEm: null });

export function atualizarTravessiaEma89(anterior, vela) {
  const e = anterior ? { ...anterior } : vazio();
  const { time, close, ema, atr, closeAnterior, emaAnterior } = vela;
  if (!Number.isFinite(time) || (Number.isFinite(e.atualizado) && time <= e.atualizado)) return e;
  if (![close, ema, closeAnterior, emaAnterior].every(Number.isFinite)) return e;
  e.atualizado = time;
  const lado = ladoDe(close, ema);
  const ladoAnterior = ladoDe(closeAnterior, emaAnterior);
  const margem = Number.isFinite(atr) && atr > 0 ? Math.abs(close - ema) / atr : null;

  if (e.estado === "pendente") {
    if (lado !== e.direcao) {
      // A travessia sem confirmacao foi desfeita. Voltar ao lado de
      // origem cancela a pendencia, sem anunciar uma inversao macro.
      return { ...e, estado: "cancelada", cancelouEm: time };
    }
  } else if (lado !== ladoAnterior) {
    Object.assign(e, { estado: "pendente", direcao: lado,
      cruzouEm: time, confirmouEm: null, cancelouEm: null });
  }
  if (e.estado === "pendente" && margem !== null && margem >= MARGEM_EMA89_SEMANAL_ATR)
    Object.assign(e, { estado: "confirmada", confirmouEm: time });
  return e;
}

export function acompanharTravessiaEma89(anterior, { times, closes, emas, atrs }) {
  let estado = anterior ? { ...anterior } : vazio();
  const fim = times.length - 1;
  if (fim < 1 || (Number.isFinite(estado.atualizado) && times[fim] <= estado.atualizado)) return estado;
  const ultima = Number.isFinite(estado.atualizado) ? times.indexOf(estado.atualizado) : -1;
  // Instalacao/migracao: avalia apenas o fechamento mais recente. Sem
  // continuidade com o estado salvo, nao reconstrui alertas antigos.
  if (ultima < 0) estado = vazio();
  for (let i = ultima < 0 ? fim : ultima + 1; i <= fim; i++) {
    if (times[i] - times[i - 1] !== SEMANA) {
      // Nao ha como garantir que a pendencia sobreviveu a uma semana
      // ausente. Reinicia a referencia sem inventar uma travessia.
      estado = { ...vazio(), atualizado: times[i] };
      continue;
    }
    const novo = atualizarTravessiaEma89(estado, {
      time: times[i], close: closes[i], ema: emas[i], atr: atrs[i],
      closeAnterior: closes[i - 1], emaAnterior: emas[i - 1],
    });
    if (novo.atualizado !== times[i]) break; // dado incompleto: aguarda uma consulta valida
    estado = novo;
  }
  return estado;
}

export function camposTravessiaEma89(estado, time, parKey) {
  const atual = estado?.atualizado === time;
  const confirmou = atual && estado.estado === "confirmada" && estado.confirmouEm === time;
  const dia = (t) => Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 10) : "--";
  return {
    ema89_semanal_estado: atual ? estado.estado : "indisponivel",
    ema89_semanal_direcao: atual ? estado.direcao || "nenhuma" : "nenhuma",
    ema89_semanal_cruzou_em: atual ? dia(estado.cruzouEm) : "--",
    ema89_semanal_confirmada_em: atual ? dia(estado.confirmouEm) : "--",
    ema89_semanal_cancelada_em: atual ? dia(estado.cancelouEm) : "--",
    // O evento fica disponivel durante toda a vela de confirmacao.
    // "confirmada" em uma semana posterior e' contexto, nao novo alerta.
    ema89_semanal_confirmacao: confirmou ? estado.direcao : "nenhum",
    ema89_semanal_evento_id: confirmou
      ? `${parKey}|semanal|ema89|${estado.direcao}|${estado.cruzouEm}|${estado.confirmouEm}` : "--",
  };
}
