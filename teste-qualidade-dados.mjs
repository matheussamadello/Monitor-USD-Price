// Regressoes da auditoria de 01/10/2026: apenas fixtures, sem rede.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from './monitor.mjs';
const DIA = 86400;
const epoch = s => Date.parse(s) / 1000;
const clone = x => structuredClone(x);
const originalNow = Date.now;
try {
  const diario = m.TIMEFRAMES_TESTE.find(t => t.key === 'diario');
  const semanal = m.TIMEFRAMES_TESTE.find(t => t.key === 'semanal');
  const cripto = { par: 'BTCUSD' }, cambio = { par: 'USDBRL=X' };
  const barra = time => ({ live: { time: epoch(time) } });
  const t = barra('2026-09-30T00:00:00Z');
  assert.doesNotThrow(() => m.validarIdadeSerie(cripto, diario, t, epoch('2026-10-01T01:30:00Z')));
  assert.throws(() => m.validarIdadeSerie(cripto, diario, t, epoch('2026-10-01T01:30:01Z')), /sem atualizacao/);
  assert.doesNotThrow(() => m.validarIdadeSerie(cambio, diario, barra('2026-09-25T00:00:00Z'), epoch('2026-09-28T12:00:00Z')), 'fim de semana e feriado curto nao derrubam cambio');
  assert.throws(() => m.validarIdadeSerie(cambio, diario, t, epoch('2026-10-09T12:00:00Z')), /sem atualizacao/);
  assert.throws(() => m.validarIdadeSerie(cripto, semanal, barra('2026-09-21T00:00:00Z'), epoch('2026-10-01T12:00:00Z')), /sem atualizacao/);
  assert.throws(() => m.validarIdadeSerie(cambio, semanal, barra('2026-09-21T00:00:00Z'), epoch('2026-10-09T12:00:00Z')), /sem atualizacao/);

  const cassete = new Map(JSON.parse(readFileSync(new URL('./teste-retrato-cassete.json', import.meta.url))).map(r => [r.url, r]));
  const fonte = async url => {
    const r = cassete.get(url); if (!r) throw new Error('sem resposta gravada');
    const objeto = r.tipo === 'text' ? JSON.parse(r.corpo) : r.corpo;
    return { ok: r.ok, status: r.status, json: async () => objeto, text: async () => JSON.stringify(objeto) };
  };
  Date.now = () => Date.parse('2026-09-10T12:00:00Z');
  const bom = await m.build(fonte);
  assert.ok(!bom.texto.includes('FALHA:'), 'fixture valida antes de congelar a fonte');
  const salvo = { niveis: bom.estadoNiveis, zonas: bom.zonasEstado, contadoresZona: bom.contadoresZona,
    ema89Semanal: bom.estadoEma89Semanal, ultimaVelaProcessada: bom.ultimaVelaProcessada };
  Date.now = () => Date.parse('2026-10-01T12:00:00Z');
  const ruim = await m.build(fonte, clone(salvo));
  const json = m.relatorioParaJSON(ruim.texto, ruim.zonas);
  for (const tf of m.TIMEFRAMES_TESTE) for (const cfg of m.PARES_TESTE)
    assert.ok(json[tf.key][cfg.label].falha, 'nenhum bloco congelado passa como saudavel');
  assert.deepEqual(ruim.estadoNiveis, salvo.niveis);
  assert.deepEqual(ruim.estadoEma89Semanal, salvo.ema89Semanal);
  assert.deepEqual(ruim.zonasEstado, salvo.zonas);
  assert.deepEqual(ruim.contadoresZona, salvo.contadoresZona);
  assert.deepEqual(ruim.ultimaVelaProcessada, salvo.ultimaVelaProcessada);
  assert.deepEqual(ruim.gatilhos, []);
  assert.deepEqual(m.registrarHistorico(json).entradas, []);
  assert.deepEqual(salvo.niveis, bom.estadoNiveis);
  const voltou = await (async () => {
    Date.now = () => Date.parse('2026-09-10T12:00:00Z');
    return m.build(fonte, salvo);
  })();
  assert.ok(!voltou.texto.includes('FALHA:'));

  const n = 165, closes = Array.from({ length: n }, (_, i) => 100 + i * .014 + 9 * Math.sin(i * .29) + 3 * Math.sin(i * .077));
  const d = { closes, opens: closes.map((c, i) => closes[i - 1] ?? c),
    highs: closes.map((c, i) => Math.max(c, closes[i - 1] ?? c) + .7),
    lows: closes.map((c, i) => Math.min(c, closes[i - 1] ?? c) - .7),
    times: closes.map((_, i) => 1704067200 + i * DIA), volumes: closes.map(() => 1000), temVolume: true,
    live: { close: 130, time: 1704067200 + n * DIA } };
  const anterior = { id: 'audit|diario|z999', tipo: 'suporte', tipo_confirmado: 'suporte', status: 'ativa',
    estado_atual: 'em_teste', centro: 120, limites_estruturais: { inferior: 119.9, superior: 120.1 },
    limites_operacionais: { inferior: 119.5, superior: 120.5 }, score: 80, score_bruto: 80,
    numero_toques: 6, numero_rejeicoes: 5, ultimo_toque: d.times.at(-10), velas_desde_ultimo_toque: 8,
    distancia_preco_atual_pct: 0, ultimaVelaAvaliada: d.times.at(-2) };
  const cfg = { key: 'audit', dec: 2, niveis: { faixas: [] } };
  const ctx = { pivos: m.acharPivos(d.highs, d.lows, diario.pivos.esq, diario.pivos.dir),
    zonasAnteriores: [anterior], zonasSemanais: [], proximoId: 1000 };
  const calculado = m.calcularZonas(cfg, diario, d, ctx);
  const z = calculado.zonas.find(z => z.id === anterior.id);
  assert.ok(z?.orfa);
  assert.equal(z.estado_atual, 'acima');
  assert.ok(Math.abs(z.distancia_preco_atual_pct - 100 * (130 - 120) / 120) < 1e-10);
  assert.equal(z.velas_desde_ultimo_toque, 9);
  assert.equal(anterior.estado_atual, 'em_teste', 'nao altera a ficha de entrada');
  const restart = clone(calculado.zonasEstado.map(m.zonaParaEstado));
  d.live.close = 120;
  const retry = m.calcularZonas(cfg, diario, d, { ...ctx, zonasAnteriores: restart, proximoId: calculado.proximoId });
  const mesmo = retry.zonas.find(z => z.id === anterior.id);
  assert.equal(mesmo.estado_atual, 'em_teste');
  assert.equal(mesmo.distancia_preco_atual_pct, 0);
  assert.equal(mesmo.velas_desde_ultimo_toque, 9);
  assert.equal(mesmo.velasEnfraquecida, z.velasEnfraquecida);
  const pregoes = [1, 2, 5, 6].map(i => 1704067200 + i * DIA);
  const orfa = m.reconciliarAnteriores([{ ...anterior, ultimo_toque: pregoes[1], ultimaVelaAvaliada: pregoes[2] }], [], 'diario', pregoes.at(-1), 2, { precoAtual: 130, times: pregoes })[0];
  assert.equal(orfa.velasDesdeUltimoToque, 2, 'idade conta velas, nao dias corridos');
  console.log('  ok     qualidade: fonte congelada, memoria preservada, tolerancia e zonas orfas');
} finally { Date.now = originalNow; }
