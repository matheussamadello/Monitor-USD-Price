// Promocao valida da faixa de USD/BRL sobre dados reais capturados.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from './monitor.mjs';
import {medirFaixa} from './auditar-faixas-manuais.mjs';
const f=JSON.parse(readFileSync(new URL('./fixture-promocao-usd-2026-10-07.json',import.meta.url)));
const cfg=m.PARES_TESTE.find(p=>p.key==='usd'),faixa=cfg.niveis.faixas.find(x=>x[2]===f.faixa[2]);
const usd27=JSON.parse(readFileSync(new URL('./promocao-faixas-usd-2026-10-27.json',import.meta.url)));
const labelsUSD27=new Set(usd27.faixas.map(f=>f[2]));
// A revisao de 27/10 acrescenta tres faixas: as capturas anteriores
// continuam verificando todos os limites e linhas que ja existiam.
const usdAntes27={...cfg.niveis,faixas:cfg.niveis.faixas.filter(f=>!labelsUSD27.has(f[2]))};
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

// Promocao solicitada pelo alerta de manutencao de 2026-10-10.
const revisao=JSON.parse(readFileSync(new URL('./promocao-faixa-usd-2026-10-10.json',import.meta.url)));
const nova=cfg.niveis.faixas.filter(x=>x[2]===revisao.faixa[2]);
assert.deepEqual(nova,[revisao.faixa],'a faixa do alerta existe uma unica vez');
assert.deepEqual({...usdAntes27,faixas:usdAntes27.faixas.filter(x=>x[2]!==revisao.faixa[2])},
  revisao.configuracao_anterior,'preserva todas as faixas e linhas anteriores');
for(const c of revisao.capturas){
  assert.equal(c.zona.status,'ativa');assert.equal(c.zona.score,77);
  assert.equal(c.zona.numero_toques,10);assert.equal(c.zona.numero_rejeicoes,6);
  assert.ok(c.zona.timeframes_confirmando.includes('semanal'));
  assert.deepEqual([c.zona.limites_estruturais.inferior,c.zona.limites_estruturais.superior]
    .map(x=>Number(x.toFixed(4))),revisao.faixa.slice(0,2),'limites publicados no alerta');
  assert.ok(revisao.faixa[1]-revisao.faixa[0]<=.5*c.atr14,'largura dentro do teto');
  assert.equal(m.motivoObservacaoRadar({...c.zona.limites_estruturais,score:c.zona.score},
    revisao.configuracao_anterior.faixas,c.atr14),null,'passa pelos filtros adicionais');
  assert.equal(m.zonasCandidatas([c.zona],revisao.configuracao_anterior,c.fechamento,'diario',c.atr14).length,1);
  assert.deepEqual(m.zonasCandidatas([c.zona],cfg.niveis,c.fechamento,'diario',c.atr14),[],
    'regiao promovida nao recomenda nova inclusao');
}
console.log('  ok     promocao de 2026-10-10: evidencia do alerta, faixas anteriores e radar preservados');

// Duas resistencias de USDT/BRL, autorizadas pelo alerta de 26/10 Brasilia.
const usdtRev=JSON.parse(readFileSync(new URL('./promocao-faixas-usdt-2026-10-26.json',import.meta.url)));
const usdt=m.PARES_TESTE.find(p=>p.key==='usdt'),labels=new Set(usdtRev.faixas.map(f=>f[2]));
assert.deepEqual(usdt.niveis.faixas.filter(f=>labels.has(f[2])),usdtRev.faixas,'faixas exatas, sem duplicacao');
assert.deepEqual({...usdt.niveis,faixas:usdt.niveis.faixas.filter(f=>!labels.has(f[2]))},
  usdtRev.configuracao_anterior,'preserva faixas e linhas pontuais anteriores do USDT/BRL');
assert.deepEqual(usdAntes27,usdtRev.configuracao_usd_preservada,'preserva USD/BRL anterior a sua revisao de 27/10');
const esperado={ 'usdt|diario|z66': [74,15,9], 'usdt|diario|z67': [71,13,7] };
for(const c of usdtRev.capturas){
  assert.equal(c.zonas.length,2);assert.equal(c.fechamento,5.3842);assert.equal(c.atr14,.084);
  assert.equal(m.zonasCandidatas(c.zonas,usdtRev.configuracao_anterior,c.fechamento,'diario',c.atr14).length,2);
  for(const z of c.zonas){
    assert.equal(z.status,'ativa');
    assert.deepEqual([z.score,z.numero_toques,z.numero_rejeicoes],esperado[z.id]);
    const limites=[z.limites_estruturais.inferior,z.limites_estruturais.superior].map(x=>Number(x.toFixed(4)));
    const faixa=usdtRev.faixas.find(f=>f[0]===limites[0]&&f[1]===limites[1]);assert.ok(faixa);
    assert.ok(faixa[1]-faixa[0]<=.5*c.atr14,'teto de largura na data da promocao');
    assert.ok(usdtRev.configuracao_anterior.faixas.every(f=>faixa[0]>f[1]),'amplia referencias acima das anteriores');
    assert.equal(m.motivoObservacaoRadar({...z.limites_estruturais,score:z.score},usdtRev.configuracao_anterior.faixas,c.atr14),null);
  }
  assert.deepEqual(m.zonasCandidatas(c.zonas,usdt.niveis,c.fechamento,'diario',c.atr14),[],
    'nenhuma das regioes promovidas recomenda inclusao novamente');
}
console.log('  ok     promocao USDT/BRL de 26/10: duas resistencias, calibracao, isolamento e radar');

assert.deepEqual(cfg.niveis.faixas.filter(f=>labelsUSD27.has(f[2])),usd27.faixas,'tres faixas exatas, sem duplicacao');
assert.deepEqual(usdAntes27,usd27.configuracao_anterior,'preserva nove faixas e niveis pontuais anteriores');
assert.deepEqual(usdt.niveis,usd27.configuracao_usdt_preservada,'preserva todas as referencias do USDT/BRL');
assert.ok(!cfg.niveis.faixas.some(f=>f[0]===usd27.regiao_nao_promovida.inferior&&f[1]===usd27.regiao_nao_promovida.superior));
const evidenciasUSD27={ 'usd|diario|z48': [86,8,6], 'usd|diario|z38': [73,14,8], 'usd|diario|z27': [73,10,7] };
for(const c of usd27.capturas){
  assert.equal(c.zonas.length,3);assert.equal(c.fechamento,5.3716);
  assert.equal(m.zonasCandidatas(c.zonas,usd27.configuracao_anterior,c.fechamento,'diario',c.atr14).length,3);
  for(const z of c.zonas){
    assert.equal(z.status,'ativa');
    assert.deepEqual([z.score,z.numero_toques,z.numero_rejeicoes],evidenciasUSD27[z.id]);
    assert.equal(m.motivoObservacaoRadar({...z.limites_estruturais,score:z.score},usd27.configuracao_anterior.faixas,c.atr14),null);
    if(z.id===usd27.regiao_nao_promovida.id)continue;
    const limites=[z.limites_estruturais.inferior,z.limites_estruturais.superior].map(x=>Number(x.toFixed(4)));
    const faixa=usd27.faixas.find(f=>f[0]===limites[0]&&f[1]===limites[1]);assert.ok(faixa);
    assert.ok(faixa[1]-faixa[0]<=.5*c.atr14,'largura na calibracao de 27/10');
  }
  const superior=c.zonas.find(z=>z.id==='usd|diario|z48'),sobreposta=c.zonas.find(z=>z.id===usd27.regiao_nao_promovida.id);
  const F=usd27.faixas.find(f=>f[2]==='faixa_5_5780_5_6066');
  assert.ok(m.zonaJaRepresentadaPorFaixaParaRadar(sobreposta.limites_estruturais,F,c.atr14),'a sobreposicao ja tem cobertura suficiente no radar');
  const uniao=sobreposta.limites_estruturais.superior-superior.limites_estruturais.inferior;
  assert.ok(uniao>.5*c.atr14,'unir as superiores excederia o teto de largura');
  assert.ok(superior.score>sobreposta.score,'prioriza a referencia de maior pontuacao');
  assert.deepEqual(m.zonasCandidatas(c.zonas,cfg.niveis,c.fechamento,'diario',c.atr14),[],
    'regioes promovidas e sobreposta nao repetem recomendacao');
}
const adicional=usd27.conferencia_adicional,zAd=adicional.zona_promovida;
assert.equal(zAd.status,'ativa');
assert.deepEqual([zAd.score,zAd.numero_toques,zAd.numero_rejeicoes],[72,10,6]);
const fAd=usd27.faixas.find(f=>f[2]==='faixa_5_4980_5_5306');
assert.deepEqual([zAd.limites_estruturais.inferior,zAd.limites_estruturais.superior].map(x=>Number(x.toFixed(4))),fAd.slice(0,2));
assert.ok(fAd[1]-fAd[0]<=.5*adicional.atr14);
const semAd={...cfg.niveis,faixas:cfg.niveis.faixas.filter(f=>f[2]!==fAd[2])};
assert.equal(m.motivoObservacaoRadar({...zAd.limites_estruturais,score:zAd.score},semAd.faixas,adicional.atr14),null);
assert.equal(m.zonasCandidatas([zAd],semAd,adicional.fechamento,'diario',adicional.atr14).length,1);
assert.deepEqual(m.zonasCandidatas([zAd],cfg.niveis,adicional.fechamento,'diario',adicional.atr14),[]);
const obs=adicional.zona_em_observacao;
assert.equal(obs.score,70);
assert.match(m.motivoObservacaoRadar({...obs.limites_estruturais,score:obs.score},cfg.niveis.faixas,adicional.atr14),/pivô único/);
console.log('  ok     promocao USD/BRL de 27/10: tres faixas, sobreposicao, observacao e radar');
