# Zonas automáticas mais próximas das manuais — USD

Comparação com dados capturados em **2026-09-25T01:23:22.587Z**, mantendo a mesma entrada e o mesmo estado anterior. Base: `effb3620858611a0df9aa577fb7b473165305ca5`.

## Mudança cirúrgica

- Teto estrutural total: diário **0,8 → 0,5 ATR diário**; semanal **1,2 → 0,3 ATR semanal**.
- Folga em cada borda: **0,15 → 0,05 ATR de referência**. A referência continua sendo o menor entre o ATR médio dos pivôs e o ATR fechado atual.
- A redução da folga evita gastar 0,3 ATR só em margem, preservando mais espaço para os pivôs dentro do teto menor. Um pivô isolado passa a gerar cerca de 0,1 ATR estrutural, sem se tornar uma linha.
- Clustering, split com evidência, fusão condicionada ao teto, filtros de qualidade, pesos, penalidades e publicação de até três zonas por lado permanecem iguais. Não se corta uma zona deixando seus próprios membros fora.

A tolerância operacional permanece em **centro ±0,25 ATR**, respeitando o teto percentual do par. Toques e rejeições automáticos continuam medidos nessa janela histórica de ATR, não exclusivamente dentro da faixa estrutural desenhada. Isso é diferente da auditoria estrita das faixas manuais. O score não foi artificialmente conservado: depois de um reagrupamento, cada zona recalcula suas interações. A perda de sobreposição semanal pode reduzir o score mesmo com contagens idênticas.

## Comparação diária/semanal

IDs identificam continuidade da região, não igualdade dos membros. Uma linha pode ter menos pivôs e janela histórica diferente depois do reagrupamento. Zonas novas não herdam contagens da antiga.

### USDT/BRL — diario

ATR: **0,03841531**. Teto em preço: **0,01920765**. Publicadas: **6 → 6**. Contagens de toques/rejeições iguais em **4 de 5** IDs comparáveis.

| ID | Faixa anterior | Faixa atual | Score antes → agora | Toques antes → agora | Rejeições antes → agora |
|---|---|---|---:|---:|---:|
| usdt|diario|z21 | 5,2008377–5,2123623 | 5,20467923–5,20852077 | 84 → 73 | 7 → 7 | 3 → 3 |
| usdt|diario|z5 | 5,2375377–5,2657623 | 5,25767923–5,26192077 | 68 → 58 | 7 → 6 | 5 → 4 |
| usdt|diario|z42 | 5,2697377–5,2857623 | 5,27357923–5,28192077 | 73 → 86 | 10 → 10 | 9 → 9 |
| usdt|diario|z37 | 5,18685655–5,20054345 | 5,19068552–5,19671448 | 76 → 63 | 3 → 3 | 2 → 2 |
| usdt|diario|z47 | nova na seleção | 5,15214675–5,16275325 | — → 98 | — → 5 | — → 4 |
| usdt|diario|z4 | 5,1380377–5,1667623 | 5,14187923–5,16062077 | 81 → 81 | 13 → 13 | 9 → 9 |

O conjunto completo não dormente, incluindo zonas candidatas/enfraquecidas fora da seleção pública, passou de 29 para 30. Registros antigos dormentes continuam no estado durante a carência.

### USD/BRL — diario

ATR: **0,05571277**. Teto em preço: **0,02785639**. Publicadas: **6 → 6**. Contagens de toques/rejeições iguais em **4 de 6** IDs comparáveis.

| ID | Faixa anterior | Faixa atual | Score antes → agora | Toques antes → agora | Rejeições antes → agora |
|---|---|---|---:|---:|---:|
| usd|diario|z37 | 5,23234285–5,2623571 | 5,23791413–5,25678583 | 82 → 82 | 4 → 4 | 4 → 4 |
| usd|diario|z5 | 5,25006879–5,28940522 | 5,26344641–5,28407423 | 83 → 85 | 7 → 8 | 6 → 7 |
| usd|diario|z23 | 5,33014311–5,34805714 | 5,33571438–5,34248586 | 61 → 61 | 5 → 5 | 5 → 5 |
| usd|diario|z4 | 5,16154302–5,20295702 | 5,1671143–5,18258567 | 82 → 72 | 13 → 4 | 10 → 3 |
| usd|diario|z24 | 5,12239326–5,16062199 | 5,12796454–5,15505071 | 96 → 83 | 6 → 6 | 4 → 4 |
| usd|diario|z36 | 5,0815431–5,11055695 | 5,08711438–5,10498567 | 81 → 81 | 9 → 9 | 5 → 5 |

O conjunto completo não dormente, incluindo zonas candidatas/enfraquecidas fora da seleção pública, passou de 26 para 25. Registros antigos dormentes continuam no estado durante a carência.

### USDT/BRL — semanal

ATR: **0,12208914**. Teto em preço: **0,03662674**. Publicadas: **6 → 6**. Contagens de toques/rejeições iguais em **1 de 3** IDs comparáveis.

| ID | Faixa anterior | Faixa atual | Score antes → agora | Toques antes → agora | Rejeições antes → agora |
|---|---|---|---:|---:|---:|
| usdt|semanal|z17 | nova na seleção | 5,21389554–5,23610446 | — → 67 | — → 7 | — → 2 |
| usdt|semanal|z19 | nova na seleção | 5,26939554–5,30110446 | — → 73 | — → 4 | — → 2 |
| usdt|semanal|z3 | 5,24128663–5,36821337 | 5,32389554–5,35600446 | 70 → 70 | 9 → 9 | 5 → 5 |
| usdt|semanal|z2 | 5,11868663–5,24831337 | 5,14389554–5,17010446 | 63 → 81 | 7 → 10 | 1 → 4 |
| usdt|semanal|z16 | 5,08668663–5,18231337 | 5,13089554–5,15610446 | 80 → 69 | 13 → 5 | 7 → 2 |
| usdt|semanal|z1 | nova na seleção | 5,07519554–5,10610446 | — → 91 | — → 5 | — → 3 |

O conjunto completo não dormente, incluindo zonas candidatas/enfraquecidas fora da seleção pública, passou de 16 para 20. Registros antigos dormentes continuam no estado durante a carência.

### USD/BRL — semanal

ATR: **0,11875008**. Teto em preço: **0,03562502**. Publicadas: **6 → 6**. Contagens de toques/rejeições iguais em **2 de 3** IDs comparáveis.

| ID | Faixa anterior | Faixa atual | Score antes → agora | Toques antes → agora | Rejeições antes → agora |
|---|---|---|---:|---:|---:|
| usd|semanal|z10 | 5,14538739–5,21621253 | 5,18662126–5,20433752 | 84 → 85 | 12 → 12 | 4 → 4 |
| usd|semanal|z47 | 5,18968747–5,3251126 | 5,23966272–5,25195258 | 81 → 44 | 12 → 2 | 7 → 1 |
| usd|semanal|z61 | nova na seleção | 5,25219066–5,28728335 | — → 90 | — → 4 | — → 3 |
| usd|semanal|z53 | 5,0253875–5,13412835 | 5,0869623–5,12225335 | 82 → 84 | 13 → 13 | 8 → 8 |
| usd|semanal|z60 | nova na seleção | 5,03726251–5,05659954 | — → 53 | — → 2 | — → 1 |
| usd|semanal|z38 | nova na seleção | 5,02956255–5,04853432 | — → 76 | — → 11 | — → 6 |

O conjunto completo não dormente, incluindo zonas candidatas/enfraquecidas fora da seleção pública, passou de 28 para 37. Registros antigos dormentes continuam no estado durante a carência.

## Limitações e compatibilidade

O semanal pode continuar mais largo em preço porque seu ATR é maior. Os números escolhidos aproximam as escalas, sem transformar zonas em linhas ou prometer identidade com os manuais. Uma zona de pivô único e score baixo não se torna forte por ficar estreita. Não foi aumentado nenhum score para compensar perda de evidência.

No USD/BRL diário, uma região passou de 13 toques/10 rejeições para 4/3 após selecionar um núcleo menor. No semanal, outra passou de score 81 e 12 toques para score 44 e dois toques. São perdas reais de evidência atribuível à geometria nova, não foram escondidas ou compensadas.

Os cálculos de RSI, DMI/ADX, EMA89, estrutura, divergências, níveis manuais e suas máquinas de estado foram comparados antes/depois e permaneceram iguais. Gatilhos ativos também ficaram idênticos nessa entrada. Nenhuma regra de alerta, prompt, campo canônico ou agendamento foi alterado. Os consumidores externos podem observar outra seleção de zonas, menos confluência ou avisos de manutenção, pois esses dados mudam legitimamente com a geometria. Isso não permite garantir frequência idêntica de notificações externas.

## Verificação reproduzível

```sh
node teste-fumaca.mjs
node teste-auditoria-faixas.mjs
```

O teste de fumaça inclui os novos testes de fronteira, folga e preservação das interações, além de `teste-auto-equivalencia.mjs`, que reproduz o pipeline com [respostas reais congeladas](fixture-auto-equivalencia-2026-09-25.json), valida o [resultado registrado](comparacao-auto-equivalencia-2026-09-25.json) e executa três retries para verificar estabilidade de zonas, IDs e score. Os testes anteriores de split, fusão, role reversal e qualidade continuam ativos; o de "ausência de microzonas" foi substituído pelo de reagrupamento dos restos (adendo abaixo).

## Adendo — restos reagrupados (2026-09-25, depois desta comparação)

O split original, quando não achava vão limpo entre duas concentrações, conservava o núcleo compacto e **descartava** o resto. Esses pivôs saíam de toda zona. Nas séries reais desta captura, isso tirava 2 a 42 pivôs por série do sistema de zonas, inclusive pivôs perto do preço e o 79.490,7 que ancora a faixa manual 79.300–79.700 do BTC.

Agora o resto de cada lado do núcleo é reagrupado pelo mesmo processo. Todo pivô confirmado termina em exatamente uma zona, e toda zona continua dentro do teto de largura. Com a mesma entrada congelada:

| Par | TF | Zonas calculadas | Seleção publicada |
|---|---|---:|---|
| USDT/BRL | diario | 30 → 54 | 3 entraram, 3 saíram |
| USD/BRL | diario | 25 → 47 | 3 entraram, 3 saíram |
| USDT/BRL | semanal | 20 → 43 | 4 entraram, 4 saíram |
| USD/BRL | semanal | 37 → 65 | 2 entraram, 2 saíram |

Gatilhos ativos inalterados. As zonas que entraram na seleção pública têm score mediano igual ou maior que o das que saíram. Em [comparacao-auto-equivalencia-2026-09-25.json](comparacao-auto-equivalencia-2026-09-25.json), `depois` e `calculadas_depois` passaram a refletir o reagrupamento; os valores desta comparação original continuam gravados em `depois_sem_reagrupamento` e `calculadas_depois_sem_reagrupamento`. `antes` não mudou.
