// Replay do pipeline com respostas reais congeladas e estado anterior.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from './monitor.mjs';
const ler=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const cap=ler('./fixture-auto-equivalencia-2026-09-25.json');
const ref=ler('./comparacao-auto-equivalencia-2026-09-25.json');
const urls=new Map(cap.respostas.map(r=>[r.url,r]));
const ff=async url=>{const r=urls.get(url);assert.ok(r,'fonte gravada');return {ok:r.ok,status:r.status,text:async()=>r.corpo,json:async()=>JSON.parse(r.corpo)}};
const medida=z=>({id:z.id,limites:z.limites_estruturais,score:z.score,toques:z.numero_toques,rejeicoes:z.numero_rejeicoes,status:z.status,pivos:z.membros.map(p=>p.preco),role_reversal:z.role_reversal});
const relogio=Date.now;
try {
 Date.now=()=>cap.instante;
 let r=await m.build(ff,structuredClone(cap.estado));
 assert.ok(!r.texto.includes('FALHA:'));
 // Revisoes posteriores a captura saem do historico da configuracao
 // (niveis.revisoes), comparando os niveis de hoje com os da data da
 // captura: faixa acrescentada so pode acrescentar o aviso de entrada na
 // mesma entrada gravada; linha movida e' avaliada na vela gravada e
 // ganha gatilho proprio; linha que saiu da configuracao nao pode mais
 // aparecer. O resto dos gatilhos tem de bater com a captura.
 const dataCaptura=new Date(cap.instante).toISOString().slice(0,10);
 const FAIXAS_POSTERIORES=[],LINHAS_POSTERIORES=[];
 for(const c of m.PARES_TESTE){
  const antes=m.niveisEm(c.niveis,dataCaptura),nv=c.niveis,tinha=new Set(antes.faixas.map(f=>f[2]));
  FAIXAS_POSTERIORES.push(...nv.faixas.map(f=>f[2]).filter(l=>!tinha.has(l)));
  if(antes.resistenciaLabel!==nv.resistenciaLabel)LINHAS_POSTERIORES.push(`${c.key}_rompe_${nv.resistenciaLabel}`);
  if(antes.suporteLabel!==nv.suporteLabel)LINHAS_POSTERIORES.push(`${c.key}_perde_${nv.suporteLabel}`);
 }
 const linhasAtuais=new Set(m.PARES_TESTE.flatMap(c=>[`${c.key}_rompe_${c.niveis.resistenciaLabel}`,`${c.key}_perde_${c.niveis.suporteLabel}`]));
 const retirada=g=>/^[a-z]+_(rompe|perde)_/.test(g.id)&&!linhasAtuais.has(g.id);
 const posterior=g=>FAIXAS_POSTERIORES.some(f=>g.id.endsWith('_'+f))||LINHAS_POSTERIORES.includes(g.id);
 assert.ok(r.gatilhos.filter(g=>FAIXAS_POSTERIORES.some(f=>g.id.endsWith('_'+f))).every(g=>/entrou na regiao/.test(g.msg)),'faixa nova so acrescenta o aviso de entrada');
 assert.deepEqual(r.gatilhos.filter(g=>!posterior(g)),ref.gatilhos_antes.filter(g=>!retirada(g)),'geometria nao altera gatilhos na mesma entrada');
 for(const p of ref.pares){
  const cfg=m.PARES_TESTE.find(c=>c.label===p.par),k=cfg.key+'|'+p.tf;
  assert.deepEqual(r.zonas[k].map(medida),p.depois,'score, toques e rejeicoes reais reproduziveis');
  assert.ok(r.zonas[k].length<=6,'limite de publicacao mantido');
  for(const z of r.zonasEstado[k].filter(z=>!z.absorvida&&z.status!=='remover')){
   assert.ok(z.limites_estruturais.superior-z.limites_estruturais.inferior<=m.ZONA_ESTRUTURAL_MAX_ATR[p.tf]*p.atr+1e-8);
   assert.ok((z.membros||[]).every(v=>v.preco>=z.limites_estruturais.inferior&&v.preco<=z.limites_estruturais.superior));
  }
 }
 for(let i=0;i<3;i++){
  const next=await m.build(ff,{...cap.estado,zonas:r.zonasEstado,contadoresZona:r.contadoresZona,niveis:r.estadoNiveis,ema89Semanal:r.estadoEma89Semanal,ultimaVelaProcessada:r.ultimaVelaProcessada});
  assert.deepEqual(next.zonas,r.zonas,'retry nao altera zonas ou score');assert.deepEqual(next.contadoresZona,r.contadoresZona,'retry nao fabrica IDs');r=next;
 }
 console.log('ok: dados reais, limites, scores, contagens, gatilhos e tres retries estaveis');
} finally {Date.now=relogio;}
