// Auditoria retrospectiva independente. Nao e' importada pelo monitor.
// Conserva a separacao de episodios e a reacao de calcularEpisodios,
// mas exige intersecao com a FAIXA FIXA, sem janela adicional em ATR.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as motor from './monitor.mjs';

export function episodiosFaixa(limites,d,atr,idxInicio,volRel=[]) {
  const {highs,lows,closes,times}=d;
  const {inferior:inf,superior:sup}=limites;
  const eps=[];
  let ep=null;
  for(let i=Math.max(1,idxInicio);i<closes.length;i++){
    const a=atr[i];
    // Sem ATR historico valido nao ha medida de saida/reacao.
    if(!(a>0))continue;
    if(highs[i]>=inf && lows[i]<=sup){
      if(!ep) ep={inicioIdx:i,inicio:times[i],fimIdx:i,fim:times[i],
        lado:closes[i-1]>sup?'acima':closes[i-1]<inf?'abaixo':'dentro',
        velas:1,rejeitado:false,excursaoAtr:0,volume_relativo:volRel[i]??null};
      else {ep.fimIdx=i;ep.fim=times[i];ep.velas++;}
      continue;
    }
    if(ep){
      const dist=closes[i]>sup?closes[i]-sup:inf-closes[i];
      if(dist>=a){
        let extremo=closes[i];
        for(let k=i;k<Math.min(i+3,closes.length);k++){
          extremo=closes[i]>sup?Math.max(extremo,highs[k]):Math.min(extremo,lows[k]);
        }
        ep.excursaoAtr=Math.abs(extremo-(closes[i]>sup?sup:inf))/a;
        ep.rejeitado=(ep.lado==='acima'?closes[i]>sup:ep.lado==='abaixo'?closes[i]<inf:false)&&ep.excursaoAtr>=1;
        ep.saidaIdx=i;eps.push(ep);ep=null;
      }
    }
  }
  if(ep){ep.aberto=true;eps.push(ep);}
  return eps;
}

function sobreposicao(a,b){
  const largura=Math.min(a.superior-a.inferior,b.superior-b.inferior);
  return largura>0?Math.max(0,Math.min(a.superior,b.superior)-Math.max(a.inferior,b.inferior))/largura:0;
}

export function medirFaixa(faixa,d,tfKey,inicio,semanais=[]){
  const limites={inferior:faixa[0],superior:faixa[1]};
  const atr=motor.atrSeries(d.highs,d.lows,d.closes);
  const idx=d.times.findIndex(t=>t>=inicio);
  const medias=motor.mediaVolMovel(d.volumes||[],20);
  const rel=(d.volumes||[]).map((v,i)=>medias[i]>0?v/medias[i]:null);
  const eps=idx<0?[]:episodiosFaixa(limites,d,atr,idx,rel);
  const z={limites_estruturais:limites,episodios:eps};
  const rr=motor.eventosRoleReversal(z,d.closes);z.role_reversal=rr.length>0;
  const vols=eps.map(e=>e.volume_relativo).filter(v=>Number.isFinite(v)).sort((a,b)=>a-b);
  const mediana=vols.length?vols[Math.floor(vols.length/2)]:null;
  const confirmando=semanais.filter(s=>!s.absorvida && ['ativa','candidata'].includes(s.status) && sobreposicao(s.limites_estruturais,limites)>=.35);
  const contexto={tfKey,velasDesdeUltimoToque:eps.length?d.closes.length-1-eps.at(-1).fimIdx:null,
    confluenciaSemanal:confirmando.length>0,volumeForte:mediana!==null&&mediana>=1.2,
    volumeAplicavel:d.temVolume!==false};
  const score=motor.pontuarZona(z,contexto);
  const semBonus=motor.pontuarZona(z,{...contexto,confluenciaSemanal:false});
  const ultimo=eps.at(-1)?.fim??null;
  return {...score,score_sem_bonus_semanal:semBonus.score,
    episodios_concluidos:eps.filter(e=>!e.aberto).length,episodios_abertos:eps.filter(e=>e.aberto).length,
    toques_ultimas_90_velas:eps.filter(e=>e.fimIdx>=d.closes.length-90).length,
    rejeicoes_ultimas_90_velas:eps.filter(e=>e.fimIdx>=d.closes.length-90&&e.rejeitado).length,
    velas_desde_ultimo_toque:contexto.velasDesdeUltimoToque,
    ultimo_toque:ultimo?new Date(ultimo*1000).toISOString().slice(0,10):null,
    volume_aplicavel:d.temVolume!==false,volume_relativo_mediano:mediana,
    confirmacao_semanal:tfKey==='diario'?confirmando.map(z=>z.id):[],role_reversals:rr,episodios:eps};
}

export function auditar(entrada){
  return {capturado_em:entrada.capturado_em,gerado_com_commit:entrada.gerado_com_commit,
    metodo:'Faixas exatas. ATR historico somente na saida minima de 1 ATR e na reacao de ate 3 velas. Pesos/penalidades e role reversal do monitor, sem herdar episodios ou score da zona ampla. Antes/depois usam a mesma janela desde o primeiro pivo da faixa anterior. A coluna pos_confirmacao recalcula somente desde a confirmacao do primeiro pivo do nucleo atual (5 velas a direita), sem contar sua formacao. Auditoria retrospectiva, nao backtest ou validacao de rentabilidade.',
    faixas:entrada.faixas.map(f=>{
      const resultado={par:f.par,key:f.key,antes:f.antes,depois:f.depois,macro:!!f.macro,inicio:new Date(f.inicio*1000).toISOString().slice(0,10),inicio_pos_confirmacao:new Date(f.inicio_pos_confirmacao*1000).toISOString().slice(0,10),timeframes:{}};
      for(const tf of ['diario','semanal']){
        const d=entrada.series[f.key+'|'+tf];
        resultado.timeframes[tf]={antes:medirFaixa(f.antes,d,tf,f.inicio,entrada.zonas_semanais[f.key]),depois:medirFaixa(f.depois,d,tf,f.inicio,entrada.zonas_semanais[f.key]),pos_confirmacao:medirFaixa(f.depois,d,tf,f.inicio_pos_confirmacao,entrada.zonas_semanais[f.key])};
      }
      return resultado;
    })};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const entrada=JSON.parse(readFileSync(process.argv[2]||new URL('./auditoria-faixas-dados-2026-09-25.json',import.meta.url)));
  const r=auditar(entrada);
  writeFileSync(process.argv[3]||new URL('./auditoria-faixas-qualidade-2026-09-25.json',import.meta.url),JSON.stringify(r,null,2)+'\n');
  for(const f of r.faixas){const d=f.timeframes.diario.depois,b=f.timeframes.diario.antes;
    console.log(f.par,f.depois.slice(0,2).join('–'),'antes',b.score,b.numero_toques,b.numero_rejeicoes,'depois',d.score,d.score_sem_bonus_semanal,d.numero_toques,d.numero_rejeicoes,'90v',d.toques_ultimas_90_velas,d.rejeicoes_ultimas_90_velas,'ultimo',d.ultimo_toque);
  }
}
