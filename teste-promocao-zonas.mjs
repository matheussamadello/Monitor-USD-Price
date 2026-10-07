// Promocao valida da faixa de USD/BRL sobre dados reais capturados.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from './monitor.mjs';
import {medirFaixa} from './auditar-faixas-manuais.mjs';
const f=JSON.parse(readFileSync(new URL('./fixture-promocao-usd-2026-10-07.json',import.meta.url)));
const cfg=m.PARES_TESTE.find(p=>p.key==='usd'),faixa=cfg.niveis.faixas.find(x=>x[2]===f.faixa[2]);
assert.deepEqual(faixa,f.faixa);
assert.ok(faixa[0]<=f.zona.limites_estruturais.inferior&&faixa[1]>=f.zona.limites_estruturais.superior);
const atr=m.atrSeries(f.serie.highs,f.serie.lows,f.serie.closes).at(-1);
assert.ok(faixa[1]-faixa[0]<=.5*atr,'faixa dentro do teto de calibracao');
const anteriores=cfg.niveis.faixas.filter(x=>x[2]!==faixa[2]);
assert.equal(m.motivoObservacaoRadar({...f.zona.limites_estruturais,score:f.zona.score},anteriores,atr),null);
assert.equal(m.zonasCandidatas([f.zona],{faixas:anteriores},f.serie.live.close,'diario',atr).length,1);
assert.deepEqual(m.zonasCandidatas([f.zona],cfg.niveis,f.serie.live.close,'diario',atr),[],'promocao nao volta como nova candidata');
const pivos=m.acharPivos(f.serie.highs,f.serie.lows,5,5);
for(const p of f.pivos){
 const i=f.serie.times.indexOf(p.time);
 assert.ok((p.tipo==='topo'?pivos.altos:pivos.baixos).includes(i));
 assert.equal(p.preco,(p.tipo==='topo'?f.serie.highs:f.serie.lows)[i]);
 assert.equal(p.confirmado_em,f.serie.times[i+5]);
}
const medida=medirFaixa(faixa,f.serie,'diario',f.inicio_pos_confirmacao,[]);
assert.equal(medida.numero_toques,5);assert.equal(medida.numero_rejeicoes,3);
assert.ok(medida.score>=70);assert.equal(medida.episodios_concluidos,4);assert.equal(medida.episodios_abertos,1);
assert.deepEqual(medida.confirmacao_semanal,[],'nao inventa confluencia semanal');
assert.equal(medida.toques_ultimas_90_velas,1);assert.equal(medida.rejeicoes_ultimas_90_velas,0,'toque recente ainda nao confirmou rejeicao');
console.log('  ok     promocao USD/BRL: pivos reais, qualidade da faixa fixa e ausencia de duplicacao');
