// Continuidade das zonas e confirmacao entre timeframes: sem rede.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from './monitor.mjs';
const originalNow=Date.now;
try {
  Date.now=()=>Date.parse('2026-09-10T12:00:00Z');
  const cassete=new Map(JSON.parse(readFileSync(new URL('./teste-retrato-cassete.json',import.meta.url))).map(r=>[r.url,r]));
  const fonte=async url=>{
    const r=cassete.get(url); if(!r)throw new Error('sem resposta gravada');
    const objeto=r.tipo==='text'?JSON.parse(r.corpo):r.corpo;
    return {ok:r.ok,status:r.status,json:async()=>objeto,text:async()=>JSON.stringify(objeto)};
  };
  const bom=await m.build(fonte);
  assert.ok(!bom.texto.includes('FALHA:'));
  const salvo={niveis:bom.estadoNiveis,zonas:bom.zonasEstado,contadoresZona:bom.contadoresZona,
    ema89Semanal:bom.estadoEma89Semanal,ultimaVelaProcessada:bom.ultimaVelaProcessada};
  assert.ok(Object.entries(salvo.zonas).some(([k,zs])=>k.endsWith('|diario')&&zs.some(z=>z.timeframes_confirmando.includes('semanal'))),'fixture tem confirmacao semanal');
  const falharSemanal=async url=> /[?&]interval=(?:10080|1w|1wk)(?:&|$)/.test(url)
    ? {ok:false,status:503}:fonte(url);
  const r=await m.build(falharSemanal,structuredClone(salvo));
  const json=m.relatorioParaJSON(r.texto,r.zonas);
  for(const cfg of m.PARES_TESTE){
    assert.ok(json.semanal[cfg.label].falha,'fonte semanal falhou');
    assert.ok(!json.diario[cfg.label].falha,'diario continua utilizavel');
    assert.deepEqual(r.zonasEstado[cfg.key+'|semanal'],salvo.zonas[cfg.key+'|semanal'],'memoria semanal preservada');
    for(const z of r.zonasEstado[cfg.key+'|diario'].filter(z=>!z.orfa&&!z.absorvida))
      assert.ok(!z.timeframes_confirmando.includes('semanal'),'memoria de bloco com falha nao confirma diario');
  }
  assert.deepEqual(r.estadoEma89Semanal,salvo.ema89Semanal);
  const voltou=await m.build(fonte,structuredClone(salvo));
  assert.deepEqual(voltou.zonasEstado,bom.zonasEstado,'retomada das duas fontes na mesma vela e estavel');

  const tf=m.TIMEFRAMES_TESTE.find(t=>t.key==='diario'),DIA=86400,t0=1704067200;
  const times=Array.from({length:150},(_,i)=>t0+i*DIA),closes=times.map((_,i)=>101+i*.02);
  const d={times,closes,opens:[...closes],highs:closes.map(c=>c+.1),lows:closes.map(c=>c-.1),volumes:closes.map(()=>100),live:{time:times.at(-1)+DIA,close:130}};
  const pivos=m.acharPivos(d.highs,d.lows,5,5);
  assert.deepEqual(pivos.altos,[]);assert.deepEqual(pivos.baixos,[]);
  const cfg={key:'audit',dec:2,niveis:{faixas:[]}};
  const anterior={id:'audit|diario|z1',tipo:'suporte',status:'ativa',score:80,centro:120,
    limites_estruturais:{inferior:119.9,superior:120.1},limites_operacionais:{inferior:119.5,superior:120.5},
    estado_atual:'em_teste',distancia_preco_atual_pct:0,velas_desde_ultimo_toque:8,
    ultimo_toque:times.at(-10),ultimaVelaAvaliada:times.at(-2)};
  const ctx={pivos,zonasAnteriores:[anterior],zonasSemanais:[],proximoId:2};
  const vazio=m.calcularZonas(cfg,tf,d,ctx),z=vazio.zonasEstado.find(z=>z.id===anterior.id);
  assert.ok(z?.orfa,'sem pivos, a ficha segue o ciclo de orfa');
  assert.equal(z.status,'enfraquecida');assert.equal(z.estado_atual,'acima');
  assert.equal(z.velas_desde_ultimo_toque,9);
  assert.ok(z.distancia_preco_atual_pct>8);
  assert.deepEqual(m.zonasCandidatas(vazio.zonasVivas,cfg.niveis,130,'diario',1),[]);
  assert.equal(anterior.estado_atual,'em_teste','entrada intacta');
  let estado=vazio.zonasEstado;
  for(let i=1;i<=15;i++){
    d.times.push(d.times.at(-1)+DIA);d.closes.push(104+i*.02);d.opens.push(d.closes.at(-1));
    d.highs.push(d.closes.at(-1)+.1);d.lows.push(d.closes.at(-1)-.1);d.volumes.push(100);d.live.time=d.times.at(-1)+DIA;
    estado=m.calcularZonas(cfg,tf,d,{...ctx,zonasAnteriores:estado}).zonasEstado;
  }
  assert.equal(estado.find(z=>z.id===anterior.id).status,'remover','sem pivos novos, a carencia termina');
  console.log('  ok     revisao de zonas: fonte semanal falha, retomada e serie sem pivos');
} finally {Date.now=originalNow;}
