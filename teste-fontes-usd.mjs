// Dados horarios completos, incompletos e fallback: sem rede.
import assert from 'node:assert/strict';
import * as m from './monitor.mjs';
const DIA=86400, H=3600, epoch=s=>Date.parse(s)/1000;
const originalNow=Date.now;
const resp=rows=>JSON.stringify({chart:{error:null,result:[{meta:{gmtoffset:0},timestamp:rows.map(r=>r.time),indicators:{quote:[{open:rows.map(r=>r.open),high:rows.map(r=>r.high),low:rows.map(r=>r.low),close:rows.map(r=>r.close)}]}}]}});
try {
  Date.now=()=>Date.parse('2026-10-01T15:00:00Z');
  const days=[];
  for(let t=epoch('2025-01-01T00:00:00Z');t<=epoch('2026-10-01T00:00:00Z');t+=DIA)
    if(![0,6].includes(new Date(t*1000).getUTCDay()))days.push(t);
  const daily=days.map(time=>({time,open:5.1,high:5.3,low:5,close:5.1}));
  const hours=days.slice(-60).flatMap(time=>Array.from({length:11},(_,i)=>({time:time+(11+i)*H,open:5.1+i*.015,high:5.12+i*.015,low:5.09+i*.015,close:5.115+i*.015})))
    .filter(r=>r.time<Date.now()/1000);
  const diario=m.TIMEFRAMES_TESTE.find(t=>t.key==='diario'), semanal=m.TIMEFRAMES_TESTE.find(t=>t.key==='semanal');
  const cfg=m.PARES_TESTE.find(c=>c.key==='usd');
  const target=epoch('2026-09-30T00:00:00Z');
  const parse=(hs,tf=diario,ds=daily)=>m.parseYahooHibrido([resp(hs),resp(ds),resp(ds)],tf);
  for(const tf of [diario,semanal]) {
    const good=parse(hours,tf);
    assert.equal(good.degradada,false);
    for(const hour of [11,15,21])
      assert.throws(()=>parse(hours.filter(h=>h.time!==target+hour*H),tf),/cobertura incompleta/,'hora inicial, intermediaria e final');
    const invalid=hours.map(h=>h.time===target+21*H?{...h,close:null}:h);
    assert.throws(()=>parse(invalid,tf),/cobertura incompleta.*OHLC invalido/);
    assert.throws(()=>parse(hours.filter(h=>h.time<target||h.time>=target+DIA),tf),/sessao ausente/,'pregao inteiro nao some do agregado');
    const holiday=parse(hours.filter(h=>h.time<target||h.time>=target+DIA),tf,daily.filter(r=>r.time!==target));
    assert.ok(holiday.times.length>0,'feriado sem pregao na serie diaria nao exige horas');
    const flat=hours.map(h=>h.time===target+15*H?{...h,open:5.16,high:5.16,low:5.16,close:5.16}:h);
    assert.doesNotThrow(()=>parse(flat,tf),'hora plana recebida satisfaz cobertura');
  }
  // Horas esparsas fora do nucleo da sessao nao sao obrigatorias.
  const sparse=[...hours,...days.slice(-8).filter(t=>t!==target).map(time=>({time:time+6*H,open:5.1,high:5.12,low:5.09,close:5.11}))];
  assert.doesNotThrow(()=>parse(sparse));
  const calls=[];
  const fetchBy=(primary)=>async url=>{
    calls.push(url);
    if(url.includes('interval=1h')) {
      if(url.includes('query1')&&primary==='offline')return {ok:false,status:503};
      const hs=url.includes('query1')&&primary==='partial'?hours.filter(h=>h.time!==target+21*H):hours;
      return {ok:true,text:async()=>resp(hs)};
    }
    return {ok:true,text:async()=>resp(daily)};
  };
  for(const mode of ['offline','partial']) {
    const r=await m.buscarSerie(fetchBy(mode),cfg,diario);
    assert.equal(r.ok,true); assert.equal(r.fonte,'yahoo/query2');
    assert.equal(r.parsed.degradada,false);
  }
  const degraded=await m.buscarSerie(async url=>url.includes('interval=1h')?{ok:false,status:503}:{ok:true,text:async()=>resp(daily)},cfg,diario);
  assert.equal(degraded.ok,true,'serie longa ainda pode reparar fechamentos com sucessora e vela viva');
  assert.equal(degraded.parsed.degradada,true);
  const friday=epoch('2026-09-25T00:00:00Z'), ds=daily.filter(r=>r.time<=friday), hs=hours.filter(r=>r.time<friday+DIA);
  Date.now=()=>Date.parse('2026-09-26T12:00:00Z');
  for(const tf of [diario,semanal]) {
    assert.throws(()=>m.parseYahooHibrido([null,resp(ds)],tf),/ultimo fechamento sem horas/);
    const semFontes=await m.buscarSerie(async url=>url.includes('interval=1h')?{ok:false,status:503}:{ok:true,text:async()=>resp(ds)},cfg,tf);
    assert.equal(semFontes.ok,false);
    assert.match(semFontes.erro,/query1:.*sem horas.*query2:.*sem horas/);
    const real=parse(hs,tf,ds);
    assert.equal(real.emFormacao,false,'fechamento com horas validas continua disponivel no sabado');
  }
  // Correcao nao avanca memoria durante a falha; a mesma vela valida
  // ainda pode ser avaliada quando as horas voltarem.
  const fetchOk=async url=>{
    if(!url.includes('yahoo'))return {ok:false,status:503};
    return {ok:true,text:async()=>resp(url.includes('interval=1h')?hs:ds)};
  };
  const before=await m.build(fetchOk);
  const saved={niveis:before.estadoNiveis,zonas:before.zonasEstado,contadoresZona:before.contadoresZona,ema89Semanal:before.estadoEma89Semanal,ultimaVelaProcessada:before.ultimaVelaProcessada};
  const failing=await m.build(async url=>url.includes('interval=1h')?{ok:false,status:503}:fetchOk(url),saved);
  assert.deepEqual(failing.estadoNiveis,saved.niveis);
  assert.deepEqual(failing.estadoEma89Semanal,saved.ema89Semanal);
  assert.deepEqual(failing.ultimaVelaProcessada,saved.ultimaVelaProcessada);
  const fresh=await m.build(fetchOk,saved);
  assert.deepEqual(fresh.estadoNiveis,before.estadoNiveis);
  console.log('  ok     fontes USD: cobertura diaria/semanal, feriado, fallback e memoria');
} finally {Date.now=originalNow;}
