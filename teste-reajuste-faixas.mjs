// Reproduz as medidas da revisao manual e verifica evidencia espacial.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {medirFaixa} from './auditar-faixas-manuais.mjs';
import {acharPivos,PARES_TESTE} from './monitor.mjs';
const ler=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const ref=ler('./reajuste-faixas-manuais-2026-09-25.json');
const input=ler('./auditoria-faixas-dados-2026-09-25.json');
const original=ler('./auditoria-faixas-qualidade-2026-09-25.json');
const resumo=x=>{const {episodios,role_reversals,...rest}=x;return {...rest,numero_role_reversals:role_reversals.length};};
let alteradas=0;
for(const r of ref.faixas_manuais){
 const cfg=PARES_TESTE.find(c=>c.key===r.key);
 // O reajuste continua valendo faixa a faixa. Promocoes posteriores do
 // radar ACRESCENTAM faixas e nao podem mexer nas reajustadas, entao a
 // correspondencia com o audit e' por label, nao pela lista inteira.
 const porLabel=new Map(cfg.niveis.faixas.map(f=>[f[2],f]));
 for(const esperada of r.depois)
  assert.deepEqual(porLabel.get(esperada[2]),esperada,`faixa reajustada ${esperada[2]} intacta`);
 assert.equal(r.antes.length,r.depois.length,'nao multiplica faixas');
 const d=input.series[r.key+'|diario'];
 const p=acharPivos(d.highs,d.lows,5,5);
 const pivos=[...p.altos.map(i=>({time:d.times[i],preco:d.highs[i],tipo:'topo'})),...p.baixos.map(i=>({time:d.times[i],preco:d.lows[i],tipo:'fundo'}))];
 for(let i=0;i<r.depois.length;i++){
  const b=r.antes[i],n=r.depois[i],anc=r.ancoras[i],ev=r.avaliacao[i];
  assert.ok(n[0]<=b[0]&&n[1]>=b[1],'nao descarta o nucleo ja validado');
  assert.ok(n[1]-n[0]<=.5*r.atr_diario_referencia+1e-10);
  assert.ok(anc.pivos.every(x=>pivos.some(p=>p.time===x.time&&p.preco===x.preco&&p.tipo===x.tipo)),'pivos registrados existem e estao confirmados');
  const fi=input.faixas.find(f=>f.key===r.key&&f.depois[0]===b[0]&&f.depois[1]===b[1]);
  assert.equal(ev.inicio,fi.inicio);assert.equal(ev.inicio_pos_confirmacao,fi.inicio_pos_confirmacao,'nao alonga janela posterior para elevar score');
  for(const tf of ['diario','semanal'])for(const[metrica,faixa,inicio]of [['antes',b,ev.inicio],['depois',n,ev.inicio],['pos_confirmacao_antes',b,ev.inicio_pos_confirmacao],['pos_confirmacao_depois',n,ev.inicio_pos_confirmacao]]){
   const medida=medirFaixa(faixa,input.series[r.key+'|'+tf],tf,inicio,input.zonas_semanais[r.key]);
   assert.deepEqual(resumo(medida),ev.timeframes[tf][metrica],`${r.par} ${metrica}: resultado reproduzivel`);
  }
  if(!anc.alterada){assert.deepEqual(n,b);continue;}
  alteradas++;
  const novos=anc.pivos.filter(p=>p.preco<b[0]||p.preco>b[1]);
  if(novos.length){
   const ordenados=anc.pivos.map(p=>p.preco).sort((a,b)=>a-b);
   for(let k=1;k<ordenados.length;k++)assert.ok(ordenados[k]-ordenados[k-1]<=.25*r.atr_diario_referencia,'sem ponte para concentracao distante');
  }else{
   // Alargamento sem novo fractal precisa recuperar rejeicao real,
   // nao apenas incluir mais velas de uma travessia sem reacao.
   const audit=original.faixas.find(f=>f.key===r.key&&f.depois[0]===b[0]&&f.depois[1]===b[1]);
   const recuperadas=audit.timeframes.diario.antes.episodios.filter(e=>e.rejeitado).filter(e=>{
    let antes=false,depois=false;
    for(let k=e.inicioIdx;k<=e.fimIdx;k++){
     antes ||= d.highs[k]>=b[0]&&d.lows[k]<=b[1];
     depois ||= d.highs[k]>=n[0]&&d.lows[k]<=n[1];
    }
    return depois&&!antes;
   });
   assert.ok(recuperadas.length>0,'ampliacao sustentada por reacao antes excluida');
   assert.ok(ev.timeframes.diario.depois.numero_rejeicoes>ev.timeframes.diario.antes.numero_rejeicoes);
  }
 }
 if(r.macro_antes)assert.deepEqual(cfg.niveis.resistenciaMacro,r.macro_antes,'macro de pivô unico nao e alargada para simular robustez');
}
assert.ok(alteradas>0);
console.log(`ok: ${alteradas} reajuste(s), evidencia espacial, medidas reproduziveis e janelas comparaveis`);
