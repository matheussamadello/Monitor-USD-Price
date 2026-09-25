# Revisão de largura das zonas — USD

Dados capturados em **2026-09-25T01:23:22.587000+00:00**. Comparação dos dois códigos usando os mesmos candles e o mesmo estado inicial. Base: `d675179681698b9677c00dea48e591a76e7baace`.

## Causa e alteração

O cluster antigo aceitava distância de até 1 ATR histórico entre seus membros e acrescentava 0,15 ATR por borda. A fusão por sobreposição não voltava a verificar todos os pares nem limitava a largura resultante. Além disso, o ATR dos membros era descartado antes da fusão. O centro suavizado de uma ficha antiga podia ficar entre os novos agrupamentos.

A revisão mantém a arquitetura: pivôs, clusters, episódios, score, casamento e ciclo de vida. Adiciona teto de 0,8 ATR diário e 1,2 ATR semanal na admissão e fusão, incluindo as margens. Separa concentrações com evidência ou conserva o núcleo compacto mais povoado quando não há duas concentrações. Não cria duas zonas a partir de dois pivôs isolados. A janela operacional passa a centro ±0,25 ATR, respeitando o teto percentual do ativo.

O split exige pelo menos dois pivôs de datas diferentes por parte, vão ≥0,2 ATR de referência e ≥2 vezes o espaçamento interno médio de cada lado. A divisão é recursiva. Uma filha não herda o score ou os episódios da mãe: esses valores são recalculados, com os mesmos pesos, penalidades e condições de confirmação. Apenas uma filha pode herdar cada ID anterior. Fichas legadas largas permanecem dormentes no estado durante a carência e não são publicadas.

## Faixas manuais

O teto foi aplicado na data da calibração. As faixas continuam fixas, portanto poderão precisar de nova revisão se a volatilidade mudar. Faixas já dentro do teto foram mantidas, inclusive as de XMR/USD e a faixa promovida de 0,00524–0,00544 no XMR/BTC.

### USDT/BRL

ATR diário de referência: **0,0384**.

| Antes | Depois |
| --- | --- |
| 5,27–5,35 | 5,3342–5,3599 / 5,2892–5,3059 / 5,2697–5,2858 |
| 5,17–5,22 | 5,1868–5,2124 |
| 5,12–5,16 | 5,138–5,1668 |
### USD/BRL

ATR diário de referência: **0,0557**.

| Antes | Depois |
| --- | --- |
| 5,25–5,36 | 5,3301–5,3481 / 5,25–5,2895 |
| 5,13–5,21 | 5,1615–5,203 / 5,1223–5,1607 |
| 5,05–5,12 | 5,0646–5,1072 |
| 5–5,05 | 5,0318–5,0617 / 4,9875–5,0231 |

No USD/BRL, 5,0646–5,1072 preserva as concentrações próximas em 5,0696–5,0791 e 5,0899–5,1022 com margem de aproximadamente 0,005 por lado, sem multiplicar faixas. No USDT/BRL, 5,1868–5,2124 reúne as referências próximas de 5,1926, 5,1948 e 5,2066. Os demais novos limites seguem as regiões estruturais registradas na comparação.

## Zonas automáticas publicadas

A comparação por ID mostra a continuidade da ficha, não uma garantia de que todos os pivôs antigos pertencem à nova região. IDs novos identificam as demais regiões resultantes.

| Par / período | ID | Antes | Depois | Score / toques / rejeições depois |
| --- | --- | --- | --- | --- |
| USDT/BRL / semanal | `usdt\|semanal\|z3` | 5,2596–5,43 | 5,24128663–5,36821337 | 70 / 9 / 5 |
| USDT/BRL / semanal | `usdt\|semanal\|z12` | não publicado | 5,36338663–5,44831337 | 67 / 7 / 5 |
| USDT/BRL / semanal | `usdt\|semanal\|z4` | 5,451–5,614 | 5,43268663–5,55431337 | 71 / 9 / 6 |
| USDT/BRL / semanal | `usdt\|semanal\|z2` | 5,105–5,23 | 5,11868663–5,24831337 | 63 / 7 / 1 |
| USDT/BRL / semanal | `usdt\|semanal\|z16` | não publicado | 5,08668663–5,18231337 | 80 / 13 / 7 |
| USDT/BRL / semanal | `usdt\|semanal\|z11` | não publicado | 4,98868663–5,11831337 | 87 / 4 / 3 |
| USD/BRL / semanal | `usd\|semanal\|z47` | não publicado | 5,18968747–5,3251126 | 81 / 12 / 7 |
| USD/BRL / semanal | `usd\|semanal\|z39` | 5,22359991–5,4282999 | 5,26798747–5,40211274 | 70 / 12 / 6 |
| USD/BRL / semanal | `usd\|semanal\|z54` | não publicado | 5,35024951–5,41449144 | 70 / 9 / 6 |
| USD/BRL / semanal | `usd\|semanal\|z10` | 5,04320002–5,24601507 | 5,14538739–5,21621253 | 84 / 12 / 4 |
| USD/BRL / semanal | `usd\|semanal\|z53` | não publicado | 5,0253875–5,13412835 | 82 / 13 / 8 |
| USD/BRL / semanal | `usd\|semanal\|z52` | não publicado | 4,97972939–5,06040933 | 76 / 13 / 8 |
| USDT/BRL / diario | `usdt\|diario\|z21` | 5,1926–5,22 | 5,2008377–5,2123623 | 84 / 7 / 3 |
| USDT/BRL / diario | `usdt\|diario\|z5` | 5,2373787–5,2659213 | 5,2375377–5,2657623 | 68 / 7 / 5 |
| USDT/BRL / diario | `usdt\|diario\|z42` | não publicado | 5,2697377–5,2857623 | 73 / 10 / 9 |
| USDT/BRL / diario | `usdt\|diario\|z37` | não publicado | 5,18685655–5,20054345 | 76 / 3 / 2 |
| USDT/BRL / diario | `usdt\|diario\|z4` | 5,122–5,161 | 5,1380377–5,1667623 | 81 / 13 / 9 |
| USDT/BRL / diario | `usdt\|diario\|z3` | 5,0396–5,0876 | 5,0665377–5,0933623 | 95 / 10 / 9 |
| USD/BRL / diario | `usd\|diario\|z37` | não publicado | 5,23234285–5,2623571 | 82 / 4 / 4 |
| USD/BRL / diario | `usd\|diario\|z5` | 5,24069977–5,28579998 | 5,25006879–5,28940522 | 83 / 7 / 6 |
| USD/BRL / diario | `usd\|diario\|z23` | 5,33284521–5,39417887 | 5,33014311–5,34805714 | 61 / 5 / 5 |
| USD/BRL / diario | `usd\|diario\|z4` | 5,1602086–5,23519145 | 5,16154302–5,20295702 | 82 / 13 / 10 |
| USD/BRL / diario | `usd\|diario\|z24` | 5,12030407–5,17944625 | 5,12239326–5,16062199 | 96 / 6 / 4 |
| USD/BRL / diario | `usd\|diario\|z36` | não publicado | 5,0815431–5,11055695 | 81 / 9 / 5 |

## Alertas e compatibilidade

A alteração isolada do detector preservou os gatilhos, os estados dos níveis pontuais, a EMA89 semanal, RSI, DMI/ADX, divergências e estrutura. As faixas manuais alteram onde as condições de entrada em faixa são verdadeiras.

No snapshot: **2 gatilhos ativos antes e 2 depois**. As listas exatas constam no JSON desta revisão. Labels de faixas alteradas mudaram. Essa manutenção pode gerar uma diferença de assinatura na primeira execução, sem representar por si só movimento novo do mercado.

Não é possível concluir a frequência futura de notificações da automação externa a partir de um snapshot. As regras de sinais, horários e anti-spam não foram alteradas. Faixas menores cobrem menos preços, mas faixas divididas criam fronteiras distintas. `docs/historico.jsonl` não foi reescrito. Os nomes de campos dos relatórios e estados foram preservados, e memórias antigas continuam legíveis.

## Validação

A suíte `teste-zonas.mjs` cobre os casos solicitados e a calibração manual. As suítes completas, os retratos e a paridade passaram nos três projetos. A validação com dados reais confirmou os tetos e três reexecuções estáveis por monitor. A comparação real utiliza as séries da Kraken para BTC/XMR, Binance para USDT/BRL e Yahoo para USD/BRL, sem troca de fonte entre antes e depois.
