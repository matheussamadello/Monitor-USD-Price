# Auditoria de qualidade das faixas manuais — USD

> Registro histórico anterior ao [reajuste seletivo das faixas](REAJUSTE_FAIXAS_2026-09-25.md). As tabelas abaixo preservam os limites e resultados daquela auditoria.

Séries capturadas em **2026-09-25T01:23:22.587Z**. As medidas abaixo são uma auditoria retrospectiva específica dos limites manuais, não scores canônicos publicados pelo monitor nem probabilidades de sucesso.

## Método

- Contato exige interseção da máxima/mínima com a faixa exata. Nenhuma margem ATR aumenta suas bordas.
- Várias velas do mesmo episódio contam como um toque. Novo episódio exige saída confirmada de pelo menos 1 ATR histórico.
- Rejeição exige retorno ao lado de origem, com reação de pelo menos 1 ATR. A excursão é medida em até três velas, como no motor atual. Episódios abertos não são tratados como rejeições.
- Pesos, penalidades, volume histórico e role reversal reutilizam as funções do monitor. Volume é não aplicável no USD/BRL.
- Confirmação semanal conserva o critério do motor: sobreposição de pelo menos 35% com zona semanal ativa/candidata não absorvida. O score sem esse bônus também é mostrado para distinguir evidência própria de corroboração contextual.
- Antes/depois usam a mesma janela desde o primeiro pivô da faixa anterior. Isso inclui contatos anteriores à seleção do núcleo. Uma segunda medição começa depois da confirmação do primeiro pivô do núcleo atual (cinco velas à direita), excluindo a formação inicial.
- O contador pode subir ao estreitar: a borda muda a distância de saída de 1 ATR e, portanto, pode separar episódios antes agrupados. Isso não representa mais velas de contato.
- No semanal, entram apenas velas cujo início está dentro da janela; uma semana iniciada antes do corte não é contada parcialmente. Isso pode excluir a vela de formação inicial.
- A auditoria usa velas fechadas OHLC. Não é backtest, não demonstra rentabilidade e não resolve a ordem intradiária dos movimentos.

## Diário — mesma janela histórica para antes/depois

| Par | Faixa atual | Início da janela | Score antes → depois | Depois sem bônus semanal | Toques antes → depois | Rejeições antes → depois | Último toque |
|---|---|---|---|---|---|---|---|
| USDT/BRL | 5,338–5,3465 | 2025-10-29 | 72 → 72 | 72 | 8 → 8 | 7 → 7 | 2026-04-01 |
| USDT/BRL | 5,2935–5,3015 | 2025-10-01 | 73 → 73 | 73 | 11 → 12 | 10 → 11 | 2026-06-25 |
| USDT/BRL | 5,274–5,2815 | 2025-09-18 | 73 → 62 | 62 | 10 → 10 | 9 → 7 | 2026-07-06 |
| USDT/BRL | 5,191–5,1965 | 2026-03-25 | 85 → 85 | 74 | 9 → 10 | 5 → 4 | 2026-09-24 |
| USDT/BRL | 5,1525–5,162 | 2026-01-28 | 81 → 85 | 74 | 12 → 13 | 8 → 9 | 2026-09-23 |
| USD/BRL | 5,3315–5,341 | 2025-10-29 | 59 → 59 | 59 | 8 → 9 | 5 → 6 | 2026-03-23 |
| USD/BRL | 5,2525–5,2595 | 2024-04-17 | 72 → 71 | 60 | 9 → 6 | 7 → 4 | 2026-03-31 |
| USD/BRL | 5,168–5,181 | 2024-05-01 | 82 → 83 | 71 | 13 → 15 | 10 → 11 | 2026-09-24 |
| USD/BRL | 5,129–5,1395 | 2026-02-12 | 90 → 76 | 65 | 5 → 6 | 3 → 3 | 2026-09-23 |
| USD/BRL | 5,068–5,0805 | 2024-04-03 | 83 → 81 | 69 | 8 → 8 | 5 → 5 | 2026-09-11 |
| USD/BRL | 5,049–5,0545 | 2024-03-19 | 75 → 75 | 64 | 9 → 9 | 6 → 6 | 2026-07-31 |
| USD/BRL | 4,9945–5,0005 | 2024-01-23 | 66 → 73 | 61 | 6 → 9 | 3 → 6 | 2026-06-03 |

## Diário — testes depois da confirmação do núcleo atual

Esta janela é menor quando o pivô que ancora o núcleo é recente. Ela verifica retestes posteriores sem reaproveitar a reação da própria formação.

| Par | Faixa | Desde | Score | Sem bônus semanal | Toques / rejeições | Episódios abertos |
|---|---|---|---|---|---|---|
| USDT/BRL | 5,338–5,3465 | 2025-11-03 | 72 | 72 | 7 / 6 | 0 |
| USDT/BRL | 5,2935–5,3015 | 2025-10-06 | 73 | 73 | 11 / 10 | 0 |
| USDT/BRL | 5,274–5,2815 | 2025-09-23 | 62 | 62 | 9 / 6 | 0 |
| USDT/BRL | 5,191–5,1965 | 2026-09-12 | 57 | 44 | 2 / 1 | 1 |
| USDT/BRL | 5,1525–5,162 | 2026-02-17 | 85 | 74 | 11 / 7 | 0 |
| USD/BRL | 5,3315–5,341 | 2025-11-05 | 59 | 59 | 8 / 5 | 0 |
| USD/BRL | 5,2525–5,2595 | 2025-11-20 | 68 | 55 | 3 / 2 | 0 |
| USD/BRL | 5,168–5,181 | 2026-02-05 | 97 | 84 | 11 / 9 | 1 |
| USD/BRL | 5,129–5,1395 | 2026-03-18 | 60 | 49 | 4 / 1 | 1 |
| USD/BRL | 5,068–5,0805 | 2024-05-27 | 75 | 63 | 5 / 3 | 0 |
| USD/BRL | 5,049–5,0545 | 2024-03-26 | 75 | 64 | 8 / 5 | 0 |
| USD/BRL | 4,9945–5,0005 | 2024-01-30 | 73 | 61 | 8 / 5 | 0 |

## Reação, volume e papel — núcleo diário

| Par | Faixa | Reação média em ATR | Volume relativo mediano nos contatos | Role reversals confirmados | Toques / rejeições nas últimas 90 velas | Velas desde último contato |
|---|---|---|---|---|---|---|
| USDT/BRL | 5,338–5,3465 | 2.28 | 1.32 | 1 | 0 / 0 | 176 |
| USDT/BRL | 5,2935–5,3015 | 2.79 | 1.3 | 1 | 0 / 0 | 91 |
| USDT/BRL | 5,274–5,2815 | 2.41 | 1.28 | 1 | 1 / 1 | 80 |
| USDT/BRL | 5,191–5,1965 | 2.01 | 1.38 | 3 | 6 / 2 | 0 |
| USDT/BRL | 5,1525–5,162 | 2.33 | 1.22 | 2 | 6 / 4 | 1 |
| USD/BRL | 5,3315–5,341 | 1.73 | não aplicável | 1 | 0 / 0 | 133 |
| USD/BRL | 5,2525–5,2595 | 1.92 | não aplicável | 2 | 0 / 0 | 127 |
| USD/BRL | 5,168–5,181 | 1.63 | não aplicável | 3 | 6 / 5 | 0 |
| USD/BRL | 5,129–5,1395 | 1.65 | não aplicável | 0 | 3 / 1 | 1 |
| USD/BRL | 5,068–5,0805 | 1.93 | não aplicável | 1 | 4 / 3 | 9 |
| USD/BRL | 5,049–5,0545 | 1.98 | não aplicável | 3 | 4 / 3 | 39 |
| USD/BRL | 4,9945–5,0005 | 2.13 | não aplicável | 1 | 2 / 1 | 81 |

## Semanal — mesmos limites manuais

| Par | Faixa | Score antes → depois | Toques antes → depois | Rejeições antes → depois | Último toque |
|---|---|---|---|---|---|
| USDT/BRL | 5,338–5,3465 | 63 → 63 | 3 → 3 | 2 → 2 | 2026-03-30 |
| USDT/BRL | 5,2935–5,3015 | 85 → 85 | 4 → 4 | 3 → 3 | 2026-06-22 |
| USDT/BRL | 5,274–5,2815 | 84 → 66 | 4 → 3 | 3 → 2 | 2026-07-06 |
| USDT/BRL | 5,191–5,1965 | 43 → 43 | 2 → 2 | 0 → 0 | 2026-09-14 |
| USDT/BRL | 5,1525–5,162 | 55 → 56 | 3 → 3 | 1 → 1 | 2026-09-14 |
| USD/BRL | 5,3315–5,341 | 67 → 67 | 3 → 3 | 2 → 2 | 2026-03-23 |
| USD/BRL | 5,2525–5,2595 | 63 → 50 | 4 → 3 | 2 → 1 | 2026-03-30 |
| USD/BRL | 5,168–5,181 | 44 → 45 | 3 → 3 | 0 → 0 | 2026-09-14 |
| USD/BRL | 5,129–5,1395 | 39 → 39 | 2 → 2 | 0 → 0 | 2026-09-14 |
| USD/BRL | 5,068–5,0805 | 44 → 45 | 2 → 2 | 0 → 0 | 2026-09-07 |
| USD/BRL | 5,049–5,0545 | 75 → 74 | 3 → 3 | 2 → 2 | 2026-07-27 |
| USD/BRL | 4,9945–5,0005 | 53 → 53 | 2 → 2 | 1 → 1 | 2026-06-01 |

## Interpretação

Todas as faixas conservam histórico de contatos e rejeições. **USD/BRL 5,2525–5,2595** perde episódios/rejeições ao estreitar e não recebe toque desde março. **USD/BRL 5,3315–5,3410** também é antiga e tem score 59. **USDT/BRL 5,1910–5,1965** tem histórico amplo, mas apenas dois episódios e uma rejeição após a confirmação do núcleo. As faixas superiores de USDT/BRL não devem receber aparência de confirmação recente apenas pelo score histórico.

O corte de ativação do detector é 45, mas ultrapassá-lo nesta auditoria não ativa uma faixa manual nem garante sua maturidade. A máquina automática também considera evidência, duas velas e envelhecimento. Nenhuma faixa ou regra operacional foi alterada nesta validação.

## Reprodução e testes

```sh
node auditar-faixas-manuais.mjs
node teste-auditoria-faixas.mjs
```

Os [dados congelados](auditoria-faixas-dados-2026-09-25.json) incluem as séries e fontes utilizadas. Os [resultados detalhados](auditoria-faixas-qualidade-2026-09-25.json) registram cada episódio, rejeição, penalidade e role reversal. Os testes verificam equivalência com o motor quando a geometria coincide, exclusão de contatos fora do núcleo, independência de episódios, rejeição versus travessia, episódio aberto, volume, role reversal e ausência de mutação das entradas.
