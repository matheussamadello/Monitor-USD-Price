# Monitor USD Price

Monitor técnico automatizado de **USD/BRL** que coleta candles de câmbio, calcula indicadores, acompanha estrutura de mercado e publica um relatório estático em HTML, texto e JSON para consulta humana ou consumo por bots, agentes e LLMs.

É o terceiro monitor da mesma família — depois de [Monitor-BTC-Price](https://github.com/matheussamadello/Monitor-BTC-Price) e [Monitor-XMR-Price](https://github.com/matheussamadello/Monitor-XMR-Price) — e reaproveita a mesma engenharia: mesmos indicadores, mesma máquina de estados de rompimento/reteste, mesmas zonas automáticas, mesmo formato de `relatorio.json`.

O projeto foi desenhado para acompanhamento de **swing trades e operações de prazo mais longo**, com o gráfico diário como referência principal de timing e o semanal como filtro de contexto estrutural.

## Links públicos

- Repositório: https://github.com/matheussamadello/Monitor-USD-Price
- Página do monitor: https://matheussamadello.github.io/Monitor-USD-Price/
- Relatório JSON: https://matheussamadello.github.io/Monitor-USD-Price/relatorio.json
- JSON bruto no repositório: https://raw.githubusercontent.com/matheussamadello/Monitor-USD-Price/main/docs/relatorio.json

## Os dois pares

O monitor analisa **dois pares**, com o mesmo tratamento técnico completo — indicadores, estrutura de pivôs, divergências, padrões de candle, máquina de rompimento/reteste, zonas automáticas, níveis manuais e gatilhos:

| Par | Papel | Fonte | Volume |
| --- | --- | --- | --- |
| **USD/BRL** | referência analítica — o dólar em si | Yahoo Finance | não existe |
| **USDT/BRL** | instrumento de execução — é nele que se dolariza e desdolariza rápido | Binance → Mercado Bitcoin | real |

Cada par tem os **seus** níveis manuais (`NIVEIS_USD` e `NIVEIS_USDT`), a sua cascata de fontes e o seu prefixo de gatilho (`usd_*` e `usdt_*`). Nada é derivado do outro — em particular, os níveis do USDT **não** são os do dólar somados de um prêmio fixo, porque o prêmio não é fixo: medido em 518 dias, foi de −2,10% a +3,60%. Um nível derivado estaria errado justamente nos dias em que o prêmio se mexe, que são os que importam para quem vai atravessar.

Além dos dois blocos por par, há a seção `TRILHO DE EXECUCAO`, que publica o prêmio de um sobre o outro — a informação que nenhum dos dois dá sozinho.

## Referência técnica: USD/BRL

O par de referência é **USD/BRL**, ou seja, **quantos reais custa um dólar**.

O ativo monitorado é o dólar; o real é a moeda de cotação. O preço sobe quando o dólar se valoriza frente ao real, e cai quando o real se fortalece. Um `rompimento_confirmado` é, portanto, dólar rompendo para cima — não o contrário.

Os preços são publicados com **4 casas decimais**. Não é preciosismo: o USD/BRL se move em milésimos, e duas casas apagariam a diferença entre um dia parado e um dia de meio por cento.

## Fonte de dados e timeframes

Câmbio não tem uma "bolsa oficial" com endpoint público equivalente ao da Kraken. O monitor usa **OHLC do Yahoo Finance** (`USDBRL=X`), buscado em cascata por dois hosts da provedora — `query1` e depois `query2` —, valendo o primeiro que responder.

O cabeçalho do relatório sempre diz qual elo respondeu:

```text
fonte: OHLC de cambio (diario=yahoo/query1, semanal=yahoo/query1)
```

Quando a cascata inteira cai, o bloco do par sai marcado com `FALHA:` citando o erro de cada elo, e o estado persistido do dia anterior é preservado em vez de apagado.

Toda vela é ancorada na **meia-noite UTC do próprio dia**. O Yahoo carimba a vela no fuso da bolsa; sem a ancoragem, uma mudança de fuso jogaria velas para o dia seguinte e o estado persistido passaria a comparar velas que não são a mesma vela.

Os timeframes são dois: `interval=1d` e `interval=1wk`.

### Por que não há uma segunda provedora

Havia. O **Stooq** era o segundo elo e **saiu em 2026-08-30**: passou a responder HTTP 200 com um desafio de JavaScript (`This site requires JavaScript to verify your browser`) em vez do CSV. Um `fetch` de Node nunca resolve esse desafio, então o fallback estava morto sem fazer barulho — só falharia junto com o Yahoo, que é exatamente quando precisaria funcionar.

Foram sondados como substitutos, e todos reprovaram:

| Candidato | Resultado |
| --- | --- |
| FXCM `candledata` | 404, serviço desativado |
| AwesomeAPI | 429 `QuotaExceeded` a partir de IP de runner |
| Pyth Network | só 1 mês de histórico (`Valid ranges: 1H, 1D, 1W, 1M`) |
| Frankfurter / BCE | só fechamento, sem máxima e mínima |

O que restou é um **espelho de host** da mesma provedora. Isso não protege contra o Yahoo mudar o formato ou tirar o par do ar; protege contra o modo de falha que de fato acontece, que é um host específico bloquear ou limitar o IP do runner. É menos redundância do que havia no papel, e mais do que havia na prática.

### Por que não ICE / IDC

O `FX_IDC:USDBRL` que aparece no TradingView é o feed da IDC (Interactive Data), hoje da ICE. É dado licenciado: não existe endpoint público, e usá-lo exigiria assinatura do ICE Data Services com credencial própria.

O mesmo vale, em graus diferentes, para as outras fontes que o TradingView exibe: `OANDA:USDBRL` e `SAXO:USDBRL` precisam de conta na corretora, `FX:USDBRL` (FXCM) teve a API pública desativada, e `TVC:USDBRL` é composição interna do próprio TradingView, sem API. O Pyth (`PYTH:USDBRL`) tem API pública e gratuita, mas o histórico de 1 mês não cobre nem a EMA89 diária, quanto mais as 89 velas da semanal.

### Fim de semana e feriado

O câmbio à vista não negocia sábado e domingo, e os dois monitores anteriores nunca precisaram lidar com isso — cripto negocia todo dia. Aqui há duas consequências práticas:

- Fora do pregão, a "vela atual" já é uma vela fechada. A linha `vela_atual_em_formacao: nao` é o que separa os dois casos para quem lê só o JSON.
- `retestMaxCandles` conta **dias corridos**, não pregões. Os 30 do diário valem cerca de 21 velas diárias reais.

### A vela-fantasma

Fora do pregão o Yahoo não simplesmente para de mandar velas: ele **acrescenta uma vela carimbada agora**, com o último preço repetido nas quatro pontas e amplitude zero. Não é uma sessão.

Isso apareceu na primeira execução real, num sábado. Se a vela entra na série, ela vira a "vela em formação" do sábado, o relatório publica como `preco_atual` um número que não fechou em lugar nenhum, e `vela_atual_em_formacao` diz `sim` com o mercado fechado.

O monitor descarta qualquer vela de **amplitude zero** (`high === low`). O critério é esse, e não o calendário, porque assim pega fim de semana, feriado e meio-pregão do mesmo jeito, sem precisar embutir o calendário de nenhuma praça. Um dia inteiro de USD/BRL sem um pip de variação não existe, então nenhuma vela legítima é descartada.

O **diário** é o timeframe principal para timing de pullbacks, rompimentos, retestes, perda/recuperação de níveis, candles e mudanças de momentum.

O **semanal** funciona principalmente como contexto e filtro estrutural: ajuda a identificar se um sinal diário está alinhado, neutro ou em conflito com a estrutura maior. O relatório também calcula os mesmos indicadores principais no semanal e distingue os valores da vela semanal fechada dos valores provisórios da semana em formação.

## Trilho de execução (USDT/BRL)

O par **analisado** é USD/BRL e continua sendo. Este bloco responde a outra pergunta: quando a leitura técnica disser que é hora de dolarizar ou desdolarizar, **quanto custa atravessar de fato**, e o pedágio está caro ou barato hoje?

O relatório publica uma seção própria:

```text
========== TRILHO DE EXECUCAO ==========

trilho_disponivel: sim
trilho_par: USDT/BRL
trilho_fonte: binance
trilho_preco: 5.2117
trilho_premio_pct: 0.98
trilho_usd_referencia: 5.1611
trilho_usd_referencia_dia: 2026-08-28
trilho_premio_defasagem_dias: 2
trilho_premio_comparavel: nao
trilho_premio_percentil: 89
trilho_premio_mediana: 0.18
trilho_premio_classificacao: caro
trilho_volume_usdt_ultimo_fechado: 603339
```

`trilho_premio_pct` é quanto o USDT/BRL está acima (ou abaixo) do USD/BRL agora. `trilho_premio_percentil` situa esse número na distribuição dos últimos 180 dias, e `trilho_premio_classificacao` resume: `caro` acima do percentil 75, `barato` abaixo do 25, `normal` entre os dois.

A direção importa e é fácil inverter: **prêmio alto encarece dolarizar** (você compra USDT) e **favorece desdolarizar** (você vende USDT).

### Defasagem: por que `trilho_premio_comparavel` existe

A cripto negocia 24/7 e o câmbio não. Num domingo, o preço do USDT é de agora e o do dólar é de sexta — o "prêmio" entre os dois carrega dois dias em que uma ponta andou e a outra estava fechada. Isso não é pedágio, é o mercado tendo se mexido.

Por isso o bloco publica de que dia é o dólar de referência (`trilho_usd_referencia_dia`), quantos dias separam as duas pontas (`trilho_premio_defasagem_dias`) e, direto, se o número vale como comparação (`trilho_premio_comparavel`). Com o câmbio fechado, o prêmio continua publicado mas marcado como `nao` — leia como curiosidade, não como custo.

O exemplo acima é real, de um domingo: `caro` no percentil 89, mas com dois dias de defasagem.

### Volume: última vela fechada, não a em formação

A cripto não fecha, então às 3h da manhã a vela do dia tem três horas de giro. Comparar isso com a mediana de dias inteiros produziria um "volume 100× abaixo da mediana" que só significa que o dia mal começou — foi exatamente o que a primeira execução real publicou, antes da correção. A referência é a última vela **fechada**, e a mediana de 30 dias exclui a que está em formação.

### Por que o USDT/BRL não entra nos indicadores

Porque foi medido, não suposto. Sobre 518 dias comparáveis:

| Métrica | Valor |
| --- | --- |
| Prêmio mediano do USDT/BRL sobre o USD/BRL | +0,31% |
| Percentil 5 / percentil 95 | −0,67% / +1,42% |
| Mínimo / máximo | −2,10% / +3,60% |
| Correlação das variações diárias | 0,43 |

Uma faixa de quase 6 pontos percentuais, com níveis manuais calibrados na casa do décimo de por cento. Alimentar RSI, DMI, EMA e zonas com essa série trocaria a leitura do dólar pela leitura do dólar **mais** o prêmio do balcão cripto. Aqui ele fica onde serve: no custo de execução.

Parte da correlação baixa é artefato de janela — a cripto opera 24/7 e o câmbio não, então o fechamento do mesmo dia do calendário não cobre o mesmo intervalo. O cálculo do prêmio casa as duas pontas **por data** e descarta os dias em que só uma delas negociou, justamente para não chamar de prêmio o que é diferença de sessão.

### Fontes do trilho

Aqui, ao contrário da série de USD/BRL, existe uma segunda provedora de verdade:

1. **`data-api.binance.vision`** — espelho público de dados da Binance. O `api.binance.com` devolve HTTP 451 a partir de IP de runner do GitHub, que fica nos EUA; o espelho responde normalmente.
2. **Mercado Bitcoin** (`api.mercadobitcoin.net`) — 3,5 anos de histórico diário com volume real.

O trilho é **auxiliar e falha sozinho**: se as duas caírem, a seção sai com `trilho_disponivel: nao` e o motivo de cada uma, e o relatório do par analisado continua inteiro.

## Indicadores e leituras calculadas

### RSI(14)

O monitor calcula **RSI de 14 períodos** usando suavização de Wilder/RMA.

O relatório separa:

- `rsi14_fechado`: calculado apenas com velas fechadas;
- `rsi14_provisorio`: inclui a vela atualmente em formação.

O código também detecta divergências RSI confirmadas e provisórias a partir de pivôs de preço.

### DMI/ADX(14)

São calculados:

- `di_plus14_fechado` / `di_plus14_provisorio`;
- `di_minus14_fechado` / `di_minus14_provisorio`;
- `adx14_fechado` / `adx14_provisorio`.

O cálculo usa a suavização de Wilder/RMA. O ADX mede força direcional e deve ser interpretado junto de DI+ e DI−; o monitor não trata ADX isoladamente como direção de mercado.

### EMA89

O monitor calcula uma **EMA exponencial de 89 períodos** e publica, entre outros campos:

- `ema89`;
- `posicao_vs_ema89`;
- `distancia_ema89_pct`.

No uso do relatório por agentes externos, a EMA89 diária pode funcionar como suporte/resistência dinâmica para timing, enquanto a EMA89 semanal é especialmente útil como filtro de contexto maior.

### Candles

O monitor registra a anatomia das velas fechadas e da vela atual, incluindo:

- abertura, máxima, mínima e fechamento;
- corpo;
- sombra superior;
- sombra inferior;
- proporção do corpo e das sombras em relação ao range;
- direção da vela.

Também detecta padrões e contextos que realmente existem no código atual, entre eles:

- bullish engulfing;
- bearish engulfing;
- hammer;
- shooting star;
- Três Soldados Brancos;
- Três Corvos Negros;
- versões provisórias dos padrões de três velas;
- `advance_block` e `stalled_pattern` como sinais de enfraquecimento, não como reversão automática.

O código diferencia a geometria do padrão do contexto em que ele ocorre. Isso evita interpretar, por exemplo, uma sequência de três velas de alta em uma tendência já madura como se ela tivesse necessariamente o significado clássico de reversão.

### Volume — depende do par

Quem decide é a provedora, não o código. E os dois pares caem em lados opostos:

- **USDT/BRL negocia em corretora**, com livro e tape. O volume é real, e todo o subsistema funciona: alertas de rompimento com volume, volume decrescente na correção, fator de volume no score das zonas.
- **USD/BRL é câmbio à vista, mercado de balcão**: não existe volume consolidado público. As fontes ou mandam zero, ou não mandam o campo.

Tratar esse zero como dado seria pior do que não ter dado nenhum — o monitor leria "volume fraco" em todo candle do dólar e penalizaria toda zona por uma informação que nunca existiu.

Então, **para o USD/BRL apenas**, o volume está desligado e não zerado. Na prática:

- O relatório publica uma linha só, `volume_disponivel: nao`, e omite `volume_atual`, `volume_vs_media_pct`, `volume_classificacao`, `volume_tendencia_3_fechadas`, `trades_vela_atual` e a comparação semanal equivalente.
- Publicar esses campos como `--` seria pior: um consumidor concluiria que o dado existe e falhou hoje. `nao` diz que ele não existe neste par, nunca.
- Os alertas que dependiam de volume (`rompimento_com_volume_acima_da_media`, `queda_com_expansao_de_volume`, `pullback_com_volume_decrescente`) simplesmente não são emitidos.
- No score das zonas, o fator de volume sai da **normalização** em vez de entrar valendo zero. Valendo zero, ele viraria um desconto fixo em toda zona e as faixas de score (`ativa` / `enfraquece` / `remove`) deixariam de calibrar.

Continua publicada a `fracao_periodo_decorrida`, que agora serve para o que sempre serviu de fato: dizer o quanto do período já passou.

### A classificação olha a vela fechada, não a em formação

Vale para o USDT/BRL, que é quem tem volume.

Volume é **acumulado**. Às 6h da manhã, uma vela diária tem só as horas já decorridas. Compará-la com a média de dias completos dá sempre um número catastrófico — a primeira versão publicou `volume_vs_media_pct: -96,72` e `contracao_forte` num dia que tinha 25% andado. Não havia contração nenhuma.

Num par 24/7 isso não é um caso raro: aconteceria **toda madrugada**, das 00h às ~06h UTC. E o efeito prático seria pior que um número feio — um rompimento real nessa janela sairia carimbado como `rompimento_com_volume_fraco`.

A correção óbvia seria escalar a média pela fração decorrida (`média × 0,25`), mas isso supõe que o giro se espalha por igual ao longo do dia, o que não acontece em cripto. A saída sem suposição nenhuma é comparar **dia inteiro contra dia inteiro**: `volume_vs_media_pct` e `volume_classificacao` passaram a olhar a última vela **fechada**, e o relatório declara isso em `volume_referencia: ultima_vela_fechada`.

O volume da vela em formação continua publicado, cru, em `volume_atual`, com `volume_parcial: sim` ao lado.

Isso também resolveu uma incoerência anterior: `rompimento_confirmado` é avaliado sobre a vela **fechada**, mas buscava a confirmação de volume na vela **viva** — duas velas diferentes na mesma frase. Como efeito colateral, o estado `inconclusivo_periodo_inicial` deixou de existir: não há mais período inicial a desconfiar.

### Pivôs e estrutura de mercado

O monitor usa pivôs fractais confirmados para classificar estrutura de preço e publica campos como:

- `estrutura_preco`;
- `estrutura_tendencia`;
- `estrutura_ultimo_topo`;
- `estrutura_ultimo_fundo`;
- `estrutura_eventos`;
- `pivos_topos_recentes`;
- `pivos_fundos_recentes`.

Internamente aparecem classificações como HH, HL, LH e LL, que correspondem a:

- HH = topo mais alto;
- HL = fundo mais alto;
- LH = topo mais baixo;
- LL = fundo mais baixo.

Essas classificações são usadas para reconhecer estrutura de alta, estrutura de baixa e combinações transicionais/indefinidas.

### Divergências

O monitor publica:

- `divergencia_rsi`: divergências confirmadas;
- `divergencia_rsi_provisoria`: divergências que ainda dependem da vela em formação.

A confirmação usa pivôs; por isso uma divergência provisória pode desaparecer antes do fechamento.

## Dados fechados x dados provisórios

Essa distinção é central no projeto.

Campos `*_fechado` usam somente velas concluídas e são a referência principal para confirmação. Campos `*_provisorio` incorporam a vela em formação e podem mudar até o fechamento.

O mesmo princípio vale para padrões, divergências, candle atual e volume parcial.

Em integrações com bots ou LLMs, é recomendável que sinais de maior convicção exijam fechamento quando a regra depender explicitamente de confirmação, enquanto dados provisórios podem ser usados para acompanhamento antecipado sem serem tratados como equivalentes ao fechamento.

## Níveis manuais

Os níveis manuais ficam centralizados em `NIVEIS_USD` dentro de `monitor.mjs`.

Os valores atuais foram calibrados na primeira execução real, em 2026-08-29, com o USD/BRL fechando a 5,1611.

**USD/BRL** (`NIVEIS_USD`):

| Faixa | Label | De onde veio |
| --- | --- | --- |
| R$ 5,25–5,36 | `faixa_5_25_5_36` | zona automática de resistência acima do preço |
| R$ 5,13–5,21 | `faixa_5_13_5_21` | campo de batalha atual (zona de maior score) |
| R$ 5,05–5,12 | `regiao_suporte_5_05_5_12` | zona de suporte imediatamente abaixo |

Além das faixas, o código mantém uma resistência pontual em **R$ 5,30** e um suporte pontual em **R$ 5,13** para a máquina de estados de rompimento/reteste. Nenhum dos dois é número redondo por acaso:

- **5,30** é o centro da zona automática mais forte acima do preço (5,2255–5,3604, centro 5,2930) e coincide com a **EMA89 semanal** em 5,2926. Duas leituras independentes apontando o mesmo lugar.
- **5,13** é tríplice confluência: **EMA89 diária** em 5,1321, borda inferior da zona de maior score (5,1306) e o último fundo mais alto da estrutura, o pivô de 2026-08-24 em 5,1308.

**USDT/BRL** (`NIVEIS_USDT`), calibrado na primeira execução do par, com o USDT a 5,2133:

| Faixa | Label |
| --- | --- |
| R$ 5,27–5,35 | `faixa_5_27_5_35` |
| R$ 5,17–5,22 | `faixa_5_17_5_22` |
| R$ 5,12–5,16 | `regiao_suporte_5_12_5_16` |

Resistência pontual em **R$ 5,31** e suporte em **R$ 5,15**, também por confluência:

- **5,31** — centro da zona diária mais testada acima do preço (13 toques, 11 rejeições), com a **EMA89 semanal** logo acima em 5,3296 e a zona semanal cobrindo 5,2755–5,4300.
- **5,15** — tríplice confluência: **EMA89 diária** em 5,1549, centro da zona diária de score 81 em 5,1532, e a zona semanal de score 80 (5,1050–5,2300) por dentro.

São uma leitura de um dia, não uma verdade permanente. Reveja quando o preço sair dessas regiões — o próprio relatório sinaliza isso quando as faixas deixam de conter o preço.

Os labels usam `_` no lugar da vírgula decimal (`5_60`, e não `5,60` nem `5.60`): eles entram em identificadores como `rompimento_confirmado_5_60` e em chaves de `docs/estado.json`, e um ponto ali atrapalha quem consome.

### Calibragem para câmbio

Alguns limiares foram reduzidos em relação aos monitores de cripto, porque um dia de USD/BRL anda tipicamente 0,3%–0,8%, e não 3%–5%:

| Constante | BTC/XMR | USD/BRL | Por quê |
| --- | --- | --- | --- |
| `RETEST_TOLERANCE_PCT` | 0,5 | 0,25 | Com 0,5%, quase toda vela cairia "na zona" do nível e a máquina ficaria presa em `em_reteste`. |
| `RETEST_RESET_DISTANCE_PCT` | 3 | 1,5 | Com 3%, o ciclo praticamente nunca encerraria por afastamento. |
| `DIV_MIN_PRECO_PCT` | 0,3 | 0,15 | Variação mínima de preço entre pivôs para uma divergência valer. |
| `ZONA_LARGURA_MIN_PCT` | 0,15 | 0,08 | Piso da largura da zona; 0,15% já seria mais largo que meio ATR diário. |
| `ZONA_LARGURA_MAX_PCT` | 1,5 | 1,0 | Teto da largura da zona. |

As faixas são publicadas diretamente no objeto `niveis_manuais` do `relatorio.json`, derivadas da configuração do código. Portanto, consumidores externos devem preferir o JSON como fonte de verdade dos valores atuais em vez de manter cópias eternas desses números.

## Máquina de estados de rompimento e reteste

Os níveis pontuais possuem estado persistente, avaliado sobre a **última vela fechada**, para evitar oscilações intradiárias da máquina de estados.

Os principais estados implementados são:

- `rompimento_candidato`;
- `rompido`;
- `em_reteste`;
- `reteste_confirmado`;
- `rompimento_falhou`;
- `recuperado`.

O registro também pode marcar `afastado` quando o preço já se distanciou do nível depois de um reteste confirmado ou recuperação. Estados inativos podem ser arquivados sem apagar o histórico do ciclo.

A máquina diferencia um critério sensível, que apenas arma um `rompimento_candidato`, de um critério mais rigoroso usado para classificar `rompido`.

## Zonas automáticas de suporte e resistência

Além dos níveis manuais, o monitor calcula **zonas automáticas** a partir dos pivôs confirmados.

No código atual essas zonas são **contexto técnico**. Elas não alteram sozinhas os gatilhos manuais, a máquina de estados dos níveis ou as confluências principais do monitor.

### ATR e agrupamento de pivôs

As zonas usam ATR(14) de Wilder calculado sobre velas fechadas. Cada pivô recebe o ATR correspondente à época em que ocorreu.

Os pivôs são agrupados por distância normalizada pela volatilidade histórica, com uma verificação entre todos os membros do cluster para evitar o efeito de encadeamento em que A≈B e B≈C acabariam unindo A e C mesmo quando estão distantes entre si.

### Limites estruturais

`limites_estruturais` representam a região histórica da zona. São derivados dos pivôs que formam o cluster e da volatilidade da época desses pivôs.

Esses limites são usados principalmente para:

- identidade da zona;
- matching entre execuções;
- merge de regiões;
- confluência histórica.

Eles não são recalculados retroativamente apenas porque a volatilidade atual mudou.

### Limites operacionais

`limites_operacionais` são ajustados ao regime atual de volatilidade. No código atual, são construídos em torno do centro da zona usando o ATR fechado atual.

São usados principalmente para medir:

- interação atual do preço com a zona;
- estado `em_teste`, `acima` ou `abaixo`;
- distância operacional.

Assim, uma mesma zona pode manter sua identidade estrutural enquanto sua faixa operacional se adapta à volatilidade corrente.

### Score e qualidade da zona

Cada zona recebe um `score` normalizado de 0 a 100 com base nos fatores aplicáveis ao timeframe. O código atual considera:

- número de episódios/toques;
- número de rejeições;
- recência;
- força média da reação em ATR;
- confluência semanal para zonas diárias;
- `role_reversal`;
- contexto de volume — **inaplicável neste monitor**, ver a seção de volume acima. O fator é removido da normalização, não contado como zero.

Também existem penalidades multiplicativas para casos como repetidos rompimentos sem reação, episódio único e wick isolado sem rejeição.

A proximidade do preço não entra no score: ela serve para ordenar quais zonas próximas são publicadas, não para medir a força histórica da zona.

### Toques, rejeições e role reversal

O monitor reconstrói episódios históricos de contato com cada zona e registra `numero_toques`, `numero_rejeicoes` e `forca_reacao_atr`.

Um `role_reversal` não é marcado apenas porque o preço apareceu do outro lado da região. O código exige uma sequência cronológica de interação de um lado, cruzamento confirmado e nova reação/rejeição pelo lado oposto.

### Confluências

Uma zona pode publicar, entre outros campos:

- `timeframes_confirmando`;
- `confluencia_nivel_manual`;
- `confluencia_faixa_manual`;
- `confluencia_manual_qualquer`;
- `cruzamento_confirmado`;
- `volume_contexto` — sempre `nao_aplicavel` aqui;
- `volume_relativo_mediano` — sempre `null` aqui;
- `distancia_preco_atual_pct`.

`confluencia_nivel_manual` cobre apenas os níveis pontuais: é verdadeiro quando o nível cai dentro dos limites estruturais da zona.

`confluencia_faixa_manual` cobre as faixas de `NIVEIS_USD.faixas`. Como faixa é região e não linha, o critério é interseção entre a faixa e os limites estruturais da zona.

`confluencia_manual_qualquer` agrega as duas. Consumidores externos não devem inferir que `confluencia_nivel_manual` representa sozinho toda forma possível de confluência manual.

Existe ainda `confluencia_resistencia_macro`, publicado apenas quando há uma âncora macro configurada em `NIVEIS_USD.resistenciaMacro`. Na configuração atual não há, então o campo não aparece. Sua ausência é esperada, não é erro.

No relatório público são mostradas até **três zonas acima e três abaixo do preço** entre as zonas publicáveis. O `estado.json` mantém todas as zonas vivas necessárias para preservar identidade e histórico, mesmo quando alguma delas não aparece entre as mais próximas no relatório público.

## `relatorio.json`

`docs/relatorio.json` é a principal interface estruturada do projeto para integrações.

Ele contém:

- cabeçalho e timestamp, incluindo qual fonte respondeu;
- bloco diário de USD/BRL;
- bloco semanal de USD/BRL;
- preço e OHLC atual;
- EMA89;
- RSI e DMI/ADX fechados e provisórios;
- candles recentes;
- `volume_disponivel: nao`;
- estrutura e pivôs;
- divergências;
- padrões;
- alertas técnicos internos;
- confluências e deteriorações;
- `niveis_manuais`;
- `zonas_automaticas`;
- `trilho_execucao`, num objeto separado dos blocos de par;
- `gatilhos_ativos`.

O JSON é construído a partir do mesmo relatório textual usado para a página, e as zonas automáticas são injetadas a partir do objeto canônico calculado pelo monitor. A intenção do código é impedir que a página e o endpoint JSON passem a representar leituras calculadas diferentes.

Para bots, agentes e LLMs, este é o arquivo recomendado para leitura periódica.

## `estado.json`

`docs/estado.json` é a memória persistente entre execuções.

Ele armazena atualmente:

- `ativos`: gatilhos internos ativos;
- `em`: timestamp de atualização do estado;
- `niveis`: estado persistente da máquina de rompimento/reteste;
- `zonas`: coleção completa de zonas vivas por timeframe, inclusive zonas que podem não estar entre as publicadas no relatório;
- `contadoresZona`: contadores usados para preservar a identidade das zonas.

O arquivo não substitui `relatorio.json` como interface de consumo. Sua principal finalidade é impedir que o monitor esqueça ciclos de níveis, IDs de zonas, históricos e contadores entre uma execução e outra.

## Arquivos gerados

Ao executar `node monitor.mjs`, o monitor cria ou atualiza:

```text
docs/
├── .nojekyll
├── estado.json
├── index.html
├── index.txt
└── relatorio.json
```

Também pode ser criado `alerta.txt` na raiz quando surgem novos gatilhos internos. O workflow oficial, entretanto, faz `git add docs`, portanto esse arquivo não é publicado pelo processo automático atual.

## Estrutura simplificada do repositório

Considerando a estrutura atual e os dois arquivos de documentação deste pacote:

```text
Monitor-USD-Price/
├── .github/
│   └── workflows/
│       └── monitor.yml
├── docs/
│   ├── .nojekyll
│   ├── estado.json
│   ├── index.html
│   ├── index.txt
│   └── relatorio.json
├── monitor.mjs
├── teste-fumaca.mjs
├── README.md
└── PROMPT_USD_TECHNICAL_WATCH.md
```

## Teste de fumaça

`teste-fumaca.mjs` existe neste monitor e não nos outros dois por um motivo concreto: aqui a fonte de dados é nova e tem fallback, e um erro de parse só apareceria em produção.

Ele serve séries sintéticas de USD/BRL nos **dois** formatos de fonte, sem tocar na rede, e verifica:

- que a fonte primária produz um relatório inteiro, sem `NaN` e sem `undefined`;
- que o volume sai declarado como indisponível e os campos de volume ficam fora;
- que o `relatorio.json` continua parseável e tipado;
- que uma segunda execução lê o estado da anterior sem quebrar;
- que o espelho de host assume quando o primário é limitado;
- que o trilho de execução sai com prêmio, percentil e classificação;
- que a segunda provedora do trilho assume quando a Binance bloqueia;
- que o trilho fora do ar não derruba o relatório do par analisado;
- que nenhum campo do trilho vaza para o bloco diário, no texto e no JSON;
- que um prêmio conhecido de 1% é calculado como 1%;
- que a defasagem é medida em dias e marca o prêmio como não comparável;
- que o volume vem da última vela fechada, e a mediana ignora a em formação;
- que a cascata inteira caída vira `FALHA:` citando o status de cada elo;
- que a vela-fantasma de fim de semana não vira a vela em formação;
- que a ancoragem de fuso não joga uma vela para o dia seguinte.

Rode com:

```bash
node teste-fumaca.mjs
```

O workflow roda esse teste **antes** de gerar o relatório: se um refactor quebrou o parse de alguma das fontes, o job para ali em vez de publicar um relatório pela metade.

## GitHub Actions

O workflow oficial está em `.github/workflows/monitor.yml`.

### Frequência

O cron atual é:

```yaml
- cron: "40 * * * *"
```

Ou seja, o GitHub Actions solicita uma execução **uma vez por hora, no minuto 40 UTC**. O minuto foi escolhido para não coincidir com os outros dois monitores (o de BTC roda no minuto 20), de modo que as chamadas às fontes fiquem espalhadas e dê para saber qual execução é qual só pelo horário no log. Como todo cron do GitHub Actions, o início efetivo pode sofrer atraso de fila da própria plataforma.

O workflow também possui `workflow_dispatch`, permitindo execução manual pela aba **Actions**.

### Node.js usado oficialmente

O workflow atual usa:

```yaml
- uses: actions/setup-node@v5
  with:
    node-version: "22"
```

Portanto, **Node.js 22 é a versão usada pelo workflow oficial**.

Isso não significa, por si só, que Node.js 22 seja uma exigência absoluta para execução local. O próprio `monitor.mjs` não possui dependências externas e declara usar o `fetch` nativo disponível em Node 20+. Assim, a configuração oficialmente exercitada em CI é Node 22, enquanto o código atual foi escrito para não depender de pacotes npm e usa recursos compatíveis com Node moderno.

### Persistência e publicação

A cada execução, o workflow:

0. roda `node teste-fumaca.mjs`;
1. faz `git fetch origin main`;
2. faz `git reset --hard origin/main` antes de rodar o monitor;
3. executa `node monitor.mjs`;
4. adiciona a pasta `docs` ao commit;
5. cria um commit se houver mudança;
6. tenta enviar o commit para `main`;
7. em caso de conflito por outro push concorrente, repete o ciclo até cinco vezes.

O `reset` antes da execução é importante porque `docs/estado.json` funciona como memória persistente. Dessa forma, cada tentativa lê o estado mais recente já publicado antes de recalcular o relatório.

O checkout usa `fetch-depth: 0`. Push a partir de clone raso funciona no GitHub, mas o ciclo de `fetch` e `reset --hard` dentro do loop de retry fica mais previsível com o histórico completo.

## Executando localmente

Clone o repositório:

```bash
git clone https://github.com/matheussamadello/Monitor-USD-Price.git
cd Monitor-USD-Price
```

Confirme sua versão do Node:

```bash
node --version
```

O workflow usa Node.js 22. O código atual não possui `package.json` nem dependências npm e usa `fetch` nativo, portanto não há etapa de `npm install`.

Execute:

```bash
node monitor.mjs
```

Os arquivos em `docs/` serão atualizados localmente. O monitor consulta o Yahoo Finance pela internet durante a execução.

Se quiser validar o código sem depender da rede, rode `node teste-fumaca.mjs`.

## Fazendo um fork

1. Abra o repositório no GitHub.
2. Clique em **Fork**.
3. Crie o fork na sua conta.
4. Abra a aba **Actions** do fork e habilite os workflows se o GitHub os tiver deixado desativados.
5. Confira em **Settings → Actions → General** se o workflow tem permissão para gravar no repositório. O arquivo `monitor.yml` solicita `contents: write`; políticas da conta ou organização ainda podem restringir essa permissão.
6. Execute manualmente o workflow `Monitor USD` uma vez com **Run workflow** para validar o fork.

Não há secrets obrigatórios no workflow atual.

## Configurando GitHub Pages

O projeto gera o conteúdo estático dentro de `docs/`.

Para publicar um fork no mesmo modelo:

1. abra **Settings → Pages**;
2. em **Build and deployment**, selecione publicação a partir de uma branch;
3. escolha a branch `main`;
4. escolha a pasta `/docs`;
5. salve e aguarde a publicação.

Com isso, `docs/index.html` passa a ser a página principal e `docs/relatorio.json` fica disponível como endpoint estático do GitHub Pages.

Em um fork com outro nome de usuário/repositório, ajuste os URLs usados por bots ou LLMs para o novo endereço do Pages.

## Personalizando níveis e faixas

A configuração manual fica no objeto `NIVEIS_USD` de `monitor.mjs`.

Exemplo da estrutura atual:

```js
const NIVEIS_USD = {
  faixas: [
    [5.25, 5.36, "faixa_5_25_5_36"],
    [5.13, 5.21, "faixa_5_13_5_21"],
    [5.05, 5.12, "regiao_suporte_5_05_5_12"],
  ],
  resistencia: 5.30,
  resistenciaLabel: "5_30",
  suporte: 5.13,
  suporteLabel: "5_13",
};
```

As faixas são automaticamente refletidas em `niveis_manuais.faixas` no `relatorio.json`.

Ao alterar níveis pontuais, mantenha coerentes o valor e o respectivo label, pois o label participa dos nomes de campos da máquina de estados publicada no relatório.

## Usando o JSON com bots, agentes e LLMs

Uma integração externa pode consultar periodicamente:

```text
https://matheussamadello.github.io/Monitor-USD-Price/relatorio.json
```

Um consumidor robusto deve, no mínimo:

1. guardar o maior `timestamp` já processado;
2. ignorar snapshots iguais ou mais antigos;
3. diferenciar campos fechados de provisórios;
4. ler `niveis_manuais.faixas` dinamicamente;
5. tratar zonas automáticas como contexto/confluência, e não como gatilho isolado;
6. evitar transformar cada campo de `alertas_tecnicos` em uma notificação independente;
7. fundir sinais relacionados para reduzir spam;
8. **não esperar campos de volume** — neste par eles não existem, e `volume_disponivel: nao` é a forma de descobrir isso sem adivinhar.

O arquivo [`PROMPT_USD_TECHNICAL_WATCH.md`](./PROMPT_USD_TECHNICAL_WATCH.md) contém uma política pronta e mais completa para uma LLM/agente transformar o `relatorio.json` em alertas seletivos, incluindo hierarquia de sinais, regras anti-spam, interpretação de RSI/DMI/ADX e tratamento dos níveis e zonas automáticas.

## Relação entre o monitor e o prompt de alerta

São duas camadas separadas:

- **`monitor.mjs`** coleta dados, calcula indicadores, estrutura, níveis, estados e zonas e publica o snapshot técnico.
- **`PROMPT_USD_TECHNICAL_WATCH.md`** define como uma LLM/agente deve interpretar snapshots sucessivos para decidir se existe uma mudança nova e material que merece uma mensagem.

O prompt não é necessário para gerar `relatorio.json`; ele serve como camada externa de interpretação e notificação.
