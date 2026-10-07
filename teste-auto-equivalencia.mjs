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
 // Faixas manuais acrescentadas DEPOIS da captura disparam o proprio aviso
 // de entrada na mesma entrada gravada. Sao listadas uma a uma; o resto
 // dos gatilhos continua tendo de bater com a captura.
 //   2026-09-28: BTC 83750-84550 e 86250-86550; XMR/USD 558-568.
 //   2026-10-07: USDT/BRL 5.025-5.044, 4.946-4.965, 4.874-4.893.
 const FAIXAS_POSTERIORES=['faixa_83750_84550','faixa_86250_86550','faixa_558_568',
  'faixa_5_025_5_044','faixa_4_946_4_965','faixa_4_874_4_893'];
 // Linhas pontuais movidas depois da captura: a linha nova nao tem registro
 // no estado gravado e a maquina a avalia na vela gravada.
 //   2026-10-07: USDT/BRL resistencia 5.31 -> 5.08, suporte 5.15 -> 4.95.
 const LINHAS_POSTERIORES=['usdt_rompe_5_08','usdt_perde_4_95'];
 const posterior=g=>FAIXAS_POSTERIORES.some(f=>g.id.endsWith('_'+f))||LINHAS_POSTERIORES.includes(g.id);
 assert.ok(r.gatilhos.filter(g=>FAIXAS_POSTERIORES.some(f=>g.id.endsWith('_'+f))).every(g=>/entrou na regiao/.test(g.msg)),'faixa nova so acrescenta o aviso de entrada');
 assert.deepEqual(r.gatilhos.filter(g=>!posterior(g)),ref.gatilhos_antes,'geometria nao altera gatilhos na mesma entrada');
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
