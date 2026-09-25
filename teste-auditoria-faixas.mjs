import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {episodiosFaixa,auditar} from './auditar-faixas-manuais.mjs';
import {calcularEpisodios,pontuarZona,eventosRoleReversal} from './monitor.mjs';

const dados=closes=>({closes,highs:closes.map(x=>x+.1),lows:closes.map(x=>x-.1),times:closes.map((_,i)=>1700000000+i*86400)});
const est={inferior:99.5,superior:100.5};
// Mesmo ATR constante e mesma geometria operacional: exige equivalencia
// com o agrupamento de episodios do monitor, incluindo rejeicao e volume.
for(const cs of [[103,100,100,101,103,100,97,100,103],[97,100,100,97,100,103,100,100]]){
  const d=dados(cs),atr=cs.map(()=>2),vol=cs.map(()=>1.3);
  assert.deepEqual(episodiosFaixa(est,d,atr,1,vol),calcularEpisodios({centro:100},d,atr,1,vol));
}
const fora=dados([103,100.8,103]);
assert.equal(episodiosFaixa({inferior:99.9,superior:100.1},fora,[2,2,2],1).length,0,
  'contato apenas na janela ATR ampla nao conta dentro do nucleo');
const d=dados([103,100,100,101,103,100,97]);
const es=episodiosFaixa(est,d,d.closes.map(()=>2),1);
assert.equal(es.length,2,'varias velas e saida curta nao multiplicam toques');
assert.equal(es[0].velas,2);
assert.equal(es[0].rejeitado,true);
assert.equal(es[1].rejeitado,false,'travessia nao vira rejeicao');
const aberto=episodiosFaixa(est,dados([103,100,100]),[2,2,2],1);
assert.equal(aberto.length,1);assert.equal(aberto[0].aberto,true);assert.equal(aberto[0].rejeitado,false);
const z={episodios:aberto,role_reversal:false};
assert.ok(pontuarZona(z,{tfKey:'diario',velasDesdeUltimoToque:0,confluenciaSemanal:false,volumeForte:false}).penalidades.includes('episodio_unico'));
const rr={limites_estruturais:est,episodios:[{lado:'acima',fimIdx:1},{lado:'abaixo',inicioIdx:4,fimIdx:5,fim:500,rejeitado:true}]};
assert.equal(eventosRoleReversal(rr,[103,100,97,97,100,97]).length,1);
rr.episodios[1].rejeitado=false;assert.equal(eventosRoleReversal(rr,[103,100,97,97,100,97]).length,0);

const entrada=JSON.parse(readFileSync(new URL('./auditoria-faixas-dados-2026-09-25.json',import.meta.url)));
const snapshot=structuredClone(entrada),resultado=auditar(entrada);
assert.deepEqual(entrada,snapshot,'auditoria nao altera os dados de entrada');
assert.deepEqual(resultado,JSON.parse(readFileSync(new URL('./auditoria-faixas-qualidade-2026-09-25.json',import.meta.url))),'resultados publicados sao reproduziveis');
for(const [i,f]of resultado.faixas.entries())for(const tf of ['diario','semanal']){
  const d=entrada.series[f.key+'|'+tf],r=f.timeframes[tf];
  for(const lado of ['antes','depois','pos_confirmacao']){
    const faixa=lado==='antes'?f.antes:f.depois,med=r[lado];
    for(const e of med.episodios){
      assert.ok(d.highs[e.inicioIdx]>=faixa[0]&&d.lows[e.inicioIdx]<=faixa[1]);
      assert.ok(d.highs[e.fimIdx]>=faixa[0]&&d.lows[e.fimIdx]<=faixa[1]);
      assert.ok(e.inicio >= (lado==='pos_confirmacao'?entrada.faixas[i].inicio_pos_confirmacao:entrada.faixas[i].inicio));
    }
    assert.equal(med.numero_toques,med.episodios.length);
    assert.equal(med.numero_rejeicoes,med.episodios.filter(e=>e.rejeitado).length);
    assert.ok(med.score>=0&&med.score<=100);
    assert.ok(med.score_sem_bonus_semanal<=med.score);
    if(d.temVolume===false)assert.equal(med.volume_relativo_mediano,null);
  }
}
console.log('ok: contatos estritos, episodios independentes, rejeicoes, travessias, volume, role reversal, janelas e imutabilidade');
