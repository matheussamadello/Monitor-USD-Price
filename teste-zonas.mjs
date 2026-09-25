// Geometria das zonas, qualidade depois do split e compatibilidade do estado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from './monitor.mjs';
const DIA = 86400;
let grupos = 0;
function teste(nome, fn) { fn(); grupos++; console.log('  ok     zonas: ' + nome); }
const pivos = (precos, atr = 10, tipo = 'topo') => precos.map((preco, i) =>
  ({ preco, atr_at_pivot: atr, tipo, idx: i, time: 1704067200 + i * DIA }));
const largura = (z) => z.superior - z.inferior;
const zona = (ps, origem, atr = 10) => {
  const est = m.limitesEstruturais(ps, atr);
  return { membros: ps, origem, limites_estruturais: est, centro: (est.inferior + est.superior) / 2 };
};

teste('cluster compacto e pivos quase iguais permanecem juntos', () => {
  for (const ps of [[100, 101, 101.5], [100, 100.00001, 100.00002]]) {
    const grupos = m.agruparPivos(pivos(ps), 'diario', 10);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].length, ps.length);
  }
});
teste('duas concentracoes em cluster largo viram duas zonas completas', () => {
  const ps = pivos([100, 100.2, 108, 108.2]);
  const cs = m.agruparPivos(ps, 'diario', 10);
  assert.deepEqual(cs.map(c => c.map(p => p.preco)), [[100, 100.2], [108, 108.2]]);
  assert.deepEqual(cs.flat(), ps, 'nenhum pivo perdido em split com evidencia');
});
teste('mais de duas concentracoes e ordem de entrada', () => {
  const ps = pivos([100, 100.1, 106, 106.1, 112, 112.1]);
  const cs = m.agruparPivos(ps, 'diario', 10);
  assert.equal(cs.length, 3);
  assert.deepEqual(m.agruparPivos([...ps].reverse(), 'diario', 10), cs);
});
teste('nuvem uniforme e pontos isolados nao fabricam multiplas microzonas', () => {
  for (const ps of [[100, 102, 104, 106, 108], [100, 109], [100, 100.1, 109]]) {
    const cs = m.dividirCluster(pivos(ps), 'diario', 10);
    assert.equal(cs.length, 1);
    assert.ok(largura(m.limitesEstruturais(cs[0], 10)) <= 8 + 1e-10);
  }
  assert.deepEqual(m.dividirCluster(pivos([100, 100.1, 109]), 'diario', 10)[0]
    .map(p => p.preco), [100, 100.1], 'conserva a concentracao, nao o outlier');
});
teste('limites diarios e semanais em escalas de BTC, XMR e cambio', () => {
  for (const [tf, fator] of Object.entries(m.ZONA_ESTRUTURAL_MAX_ATR)) {
    for (const escala of [0.00001, 0.01, 1, 1000]) for (const vol of [2, 5, 10, 20]) {
      const ps = pivos(Array.from({ length: 30 }, (_, i) => escala * (100 + i * .41)), 10 * escala);
      const atr = vol * escala;
      const cs = m.agruparPivos(ps, tf, atr);
      assert.ok(cs.length > 0);
      for (const c of cs) {
        const est = m.limitesEstruturais(c, atr);
        assert.ok(largura(est) <= fator * atr + 1e-9);
        assert.ok(c.every(p => p.preco >= est.inferior && p.preco <= est.superior), 'contem todos os seus membros');
      }
    }
  }
});
teste('ATR atual maior nao infla os limites historicos', () => {
  const ps = pivos([100, 101], 4);
  assert.deepEqual(m.limitesEstruturais(ps, 10), m.limitesEstruturais(ps, 1000));
});
teste('cluster valido no ATR fechado atual nao perde membros por teto historico menor', () => {
  const ps = pivos([547.66, 565.76], 33.64);
  assert.equal(m.agruparPivos(ps, 'diario', 39.94)[0].length, 2);
});
teste('fusao proxima preserva ATR dos pivos e folga', () => {
  const zs = [zona(pivos([100, 100.2]), 'topo'), zona(pivos([100.1, 100.3], 10, 'fundo'), 'fundo')];
  const merged = m.fundirZonasOpostas(zs, 'diario', 10);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].membros.length, 4);
  assert.ok(merged[0].limites_estruturais.inferior < 100);
  assert.ok(merged[0].limites_estruturais.superior > 100.3);
});
teste('fusao nao reconstroi zona acima do teto nem encadeia extremos distantes', () => {
  const zs = [zona(pivos([100, 104]), 'topo'), zona(pivos([102, 106], 10, 'fundo'), 'fundo')];
  const merged = m.fundirZonasOpostas(zs, 'diario', 10);
  assert.equal(merged.length, 2);
  assert.ok(merged.every(z => largura(z.limites_estruturais) <= 8 + 1e-10));
});
teste('janela operacional tem ate 0,5 ATR mesmo com volatilidade baixa', () => {
  for (const atr of [.001, 1, 10, 100]) {
    assert.ok(largura(m.limitesOperacionais(1000, atr)) <= .5 * atr + 1e-10);
  }
  assert.ok(largura(m.limitesOperacionais(1000, 0)) > 0, 'fallback percentual sem ATR');
});
teste('toques, rejeicoes, reacao, volume e score funcionam em cada filho', () => {
  for (const c of m.agruparPivos(pivos([100, 100.2, 108, 108.2]), 'diario', 10)) {
    const z = zona(c, 'topo');
    const closes = [z.centro + 20];
    for (let i = 0; i < 4; i++) closes.push(z.centro, z.centro + 20, z.centro + 20);
    const d = { closes, highs: closes.map(x => x + .1), lows: closes.map(x => x - .1),
      times: closes.map((_, i) => 1704067200 + i * DIA) };
    z.episodios = m.calcularEpisodios(z, d, closes.map(() => 10), 1, closes.map(() => 1.4));
    const score = m.pontuarZona(z, { tfKey: 'diario', velasDesdeUltimoToque: 1,
      confluenciaSemanal: true, volumeForte: true });
    assert.equal(score.numero_toques, 4);
    assert.equal(score.numero_rejeicoes, 4);
    assert.ok(score.forca_reacao_atr > 1);
    assert.ok(score.score >= 45 && score.score <= 100);
    assert.ok(z.episodios.every(e => e.volume_relativo === 1.4));
    const semConfluencia = m.pontuarZona(z, { tfKey: 'diario', velasDesdeUltimoToque: 1,
      confluenciaSemanal: false, volumeForte: false });
    assert.ok(score.score > semConfluencia.score);
  }
});
teste('role reversal exige cruzamento e rejeicao no lado novo apos split', () => {
  const c = m.agruparPivos(pivos([100, 100.2, 108, 108.2]), 'diario', 10)[0];
  const z = zona(c, 'topo');
  z.episodios = [{ lado: 'abaixo', fimIdx: 1 },
    { lado: 'acima', inicioIdx: 4, fimIdx: 5, fim: 500, rejeitado: true }];
  assert.equal(m.eventosRoleReversal(z, [96, 99, 103, 104, 102, 103]).length, 1);
  z.episodios[1].rejeitado = false;
  assert.equal(m.eventosRoleReversal(z, [96, 99, 103, 104, 102, 103]).length, 0);
});
teste('ficha antiga larga fica dormente, preserva geometria e envelhece por vela', () => {
  const ant = { id: 'antiga', status: 'ativa', ultimaVelaAvaliada: 100,
    limites_estruturais: { inferior: 90, superior: 110 }, centro: 100 };
  const [r] = m.reconciliarAnteriores([ant], [], 'diario', 200, 10);
  assert.equal(r.absorvida, true);
  assert.equal(r.status, 'enfraquecida');
  assert.deepEqual(r.limites_estruturais, ant.limites_estruturais);
  const [retry] = m.reconciliarAnteriores([r], [], 'diario', 200, 10);
  assert.equal(retry.velasEnfraquecida, r.velasEnfraquecida);
  assert.equal(ant.status, 'ativa', 'nao modifica entrada');
});
teste('filhos novos continuam sujeitos a duas velas e evidencia independente', () => {
  const ctx = { tfKey: 'diario', ultimaVelaFechada: 100, velasDesdeUltimoToque: 0, confluenciaSemanal: false };
  const z = { score: 80, episodios: [{ rejeitado: true }, { rejeitado: false }] };
  const a = m.atualizarCiclo(structuredClone(z), null, ctx);
  assert.equal(a.status, 'candidata');
  const retry = m.atualizarCiclo(structuredClone(z), a, ctx);
  assert.equal(retry.status, 'candidata');
  const b = m.atualizarCiclo(structuredClone(z), a, { ...ctx, ultimaVelaFechada: 200 });
  assert.equal(b.status, 'ativa');
});
teste('faixas manuais respeitam o teto da calibracao e mantem niveis pontuais', () => {
  const ref = JSON.parse(readFileSync(new URL('./revisao-faixas-manuais-2026-09-25.json', import.meta.url)));
  for (const r of ref.faixas_manuais) {
    const cfg = m.PARES_TESTE.find(p => p.key === r.key);
    assert.equal(cfg.niveis.suporte, r.suporte_pontual);
    assert.equal(cfg.niveis.resistencia, r.resistencia_pontual);
    assert.deepEqual(cfg.niveis.faixas, r.depois);
    assert.equal(cfg.niveis.faixas.length, r.antes.length, 'nao multiplica faixas manuais');
    for (const [i, [lo, hi]] of cfg.niveis.faixas.entries()) {
      assert.ok(lo < hi);
      assert.ok(hi - lo <= .25 * r.atr_diario_referencia + 1e-10);
      assert.ok(hi - lo <= .01 * (lo + hi) / 2 + 1e-10);
      assert.ok(lo >= r.antes[i][0] && hi <= r.antes[i][1], 'nucleo dentro da regiao anterior');
      assert.ok(hi - lo < r.antes[i][1] - r.antes[i][0], 'todas as faixas ficaram menores');
      const ancora = r.ancoras[i];
      assert.ok(ancora.pivos.length > 0, 'sem faixa criada no vazio entre pivos');
      assert.ok(ancora.pivos.every(p => p.preco > lo && p.preco < hi), 'folga em ambos os lados dos pivos');
      assert.equal(ancora.tipo === 'concentracao_de_pivos', new Set(ancora.pivos.map(p => p.time)).size >= 2);
      const ind = {rsi:null,adx:null,diPlus:null,diMinus:null,divergencias:[],estruturaEventos:[],enfraquecimento:[],padroes:[],mudancasNivel:[]};
      const alertas = preco => m.alertasTecnicos(cfg, {live:{close:preco,high:preco,low:preco},opens:[preco],closes:[preco]}, ind);
      const label = cfg.niveis.faixas[i][2];
      for(const preco of [lo,(lo+hi)/2,hi]) assert.ok(alertas(preco).includes(label));
      for(const preco of [lo-(hi-lo)*.01,hi+(hi-lo)*.01]) assert.ok(!alertas(preco).includes(label), 'ATR nao amplia a entrada na faixa manual');
    }
    const macro = cfg.niveis.resistenciaMacro;
    if (macro) {
      assert.deepEqual(macro,r.macro_depois);
      assert.ok(macro.superior-macro.inferior <= .25*r.atr_diario_referencia);
      assert.ok(macro.superior-macro.inferior <= .01*(macro.superior+macro.inferior)/2);
      assert.ok(r.pivos_macro.length > 0);
    }
    // As regioes refinadas nao criam sobreposicoes internas novas.
    const fs = [...cfg.niveis.faixas].sort((a,b) => a[0] - b[0]);
    for (let i = 1; i < fs.length; i++) assert.ok(fs[i][0] >= fs[i-1][1]);
  }
});
console.log(`  ${grupos} grupos de testes de zonas passaram`);
