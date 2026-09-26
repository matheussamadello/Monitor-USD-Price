# Monitor USD Price

Monitor técnico automatizado de **USD/BRL** que coleta candles de câmbio, calcula indicadores, acompanha estrutura de mercado e publica um relatório estático em HTML, texto e JSON para consulta humana ou consumo por bots, agentes e LLMs.

É o terceiro monitor da mesma família — depois de [Monitor-BTC-Price](https://github.com/matheussamadello/Monitor-BTC-Price) e [Monitor-XMR-Price](https://github.com/matheussamadello/Monitor-XMR-Price) — e reaproveita a mesma engenharia: mesmos indicadores, mesma máquina de estados de rompimento/reteste, mesmas zonas automáticas, mesmo formato de `relatorio.json`.

Este monitor é voltado a **swing trades de médio prazo** e **position trades**, com ênfase em **acumulação, realização parcial e decisões de prazo mais longo**. O gráfico diário é a referência principal de timing e o semanal, o filtro de contexto estrutural. Não é destinado a operações de curto prazo ou day trade.

## Links públicos

- Repositório: https://github.com/matheussamadello/Monitor-USD-Price
- Página do monitor: https://matheussamadello.github.io/Monitor-USD-Price/
- Relatório JSON: https://matheussamadello.github.io/Monitor-USD-Price/relatorio.json
- JSON bruto no repositório: https://raw.githubusercontent.com/matheussamadello/Monitor-USD-Price/main/docs/relatorio.json

## Os dois pares

O monitor analisa **dois pares**, com o mesmo tratamento técnico completo — indicadores, estrutura de pivôs, divergências, padrões de candle, máquina de rompimento/reteste, zonas automáticas, níveis manuais e gatilhos:

| Par | Papel | Fonte | Volume | Na página |
| --- | --- | --- | --- | --- |
| **USDT/BRL** | instrumento de execução — é nele que se dolariza e desdolariza rápido | Binance → Mercado Bitcoin | real | cartão + gráfico |
| **USD/BRL** | referência analítica — o dólar em si | Yahoo Finance | não existe | só no relatório completo |

**A ordem é de apresentação, não de análise.** O USDT/BRL vem primeiro no relatório e é o único com cartão no painel porque é o instrumento de execução, o único com volume real e o único cujo gráfico vem da mesma fonte do número — é o que se olha rápido. O USD/BRL continua com a análise técnica inteira, logo abaixo, e para o agente ele continua sendo a **referência macro**: é o dólar de verdade, sem o prêmio que o USDT carrega. Quando os dois divergem, o prompt manda o USD/BRL decidir a leitura macro e o USDT/BRL decidir o preço de execução.

Cada par tem os **seus** níveis manuais (`NIVEIS_USD` e `NIVEIS_USDT`), a sua cascata de fontes e o seu prefixo de gatilho (`usd_*` e `usdt_*`). Nada é derivado do outro — em particular, os níveis do USDT **não** são os do dólar somados de um prêmio fixo, porque o prêmio não é fixo: medido em 518 dias, foi de −2,10% a +3,60%. Um nível derivado estaria errado justamente nos dias em que o prêmio se mexe, que são os que importam para quem vai atravessar.

Além dos dois blocos por par, há a seção `TRILHO DE EXECUCAO`, que publica o prêmio de um sobre o outro — a informação que nenhum dos dois dá sozinho.

## Referência técnica: USD/BRL

O par de referência é **USD/BRL**, ou seja, **quantos reais custa um dólar**.

O ativo monitorado é o dólar; o real é a moeda de cotação. O preço sobe quando o dólar se valoriza frente ao real, e cai quando o real se fortalece. Um `rompimento_confirmado` é, portanto, dólar rompendo para cima — não o contrário.

Os preços são publicados com **4 casas decimais**. Não é preciosismo: o USD/BRL se move em milésimos, e duas casas apagariam a diferença entre um dia parado e um dia de meio por cento.

## Fonte de dados e timeframes

Câmbio não tem uma "bolsa oficial" com endpoint público equivalente ao da Kraken. O monitor usa **OHLC do Yahoo Finance** (`USDBRL=X`), buscado em cascata por dois hosts da provedora — `query1` e depois `query2` —, valendo o primeiro que responder.

O cabeçalho do relatório sempre diz qual elo respondeu, para cada par e cada timeframe, e qual era a cascata inteira — na ordem em que os pares saem no relatório, USDT/BRL primeiro:

```text
fonte: USDT/BRL diario=binance semanal=binance | USD/BRL diario=yahoo/query1 semanal=yahoo/query1
fontes_em_cascata: USDT/BRL binance -> mercadobitcoin | USD/BRL yahoo/query1 -> yahoo/query2 (vale a primeira que responder)
```

A cascata do USDT/BRL (Binance → Mercado Bitcoin) está descrita na seção do trilho de execução, mais abaixo.

Quando a cascata inteira cai, o bloco do par sai marcado com `FALHA:` citando o erro de cada elo, e o estado persistido do dia anterior é preservado em vez de apagado.

Toda vela é ancorada na **meia-noite UTC do próprio dia**. O Yahoo carimba a vela no fuso da bolsa; sem a ancoragem, uma mudança de fuso jogaria velas para o dia seguinte e o estado persistido passaria a comparar velas que não são a mesma vela.

Os timeframes são dois, diário e semanal, e desde 2026-09-26 **as velas do USD/BRL são montadas das velas de 1 hora** do Yahoo (`interval=1h&range=730d`), com a série longa (`1d` e `1wk`) só para o histórico mais antigo que as horas. A razão está na seção seguinte.

### O fechamento do Yahoo estava errado

A vela diária de `USDBRL=X` traz a **abertura certa, mas o fechamento é praticamente a própria abertura**. Foi medido no próprio runner, com um diagnóstico temporário, em 2026-09-26:

- corpo menor que 5% da amplitude em 84% a 100% das velas de **cada ano desde 2020**, e em 100% de 2023 a 2025;
- contra o dia reconstruído das velas de 1 hora da mesma provedora, o erro do fechamento tem mediana de **0,0231** e p90 de 0,0674 — do tamanho da amplitude de um dia inteiro. Em 23/09/2026 o dólar fechou em 5,1641; o Yahoo diário dizia 5,0999;
- a máxima e a mínima também vinham incompletas às vezes (a de 23/09 faltava 2,3 centavos);
- o semanal herda o defeito: o fechamento da semana era o fechamento quebrado da sexta;
- os dois hosts, o ticker `BRL=X`, `period1/period2`, `includePrePost` e o intervalo `5d` dão exatamente o mesmo.

Na prática, RSI, EMA89, ADX, padrões de candle, corpo e sombras, rompimentos e retestes do USD/BRL eram calculados sobre a abertura do dia, não sobre o fechamento. O USDT/BRL, que vem da Binance, nunca foi afetado.

**Como a vela é montada agora.** A série de 1 hora é coerente — a abertura de cada hora é o fechamento da anterior — e cobre 729 dias úteis, mais que as 720 velas guardadas. O dia é o **dia UTC**, a mesma fronteira do USDT/BRL. Ficam fora:

- **sábado e domingo**, que não são pregão (havia 86 horas carimbadas no fim de semana, cotação repetida);
- **horas sem amplitude** (máxima igual à mínima). São 2.782 de 17.520, concentradas entre 22h e 05h UTC: é a última cotação repetida durante a madrugada. Sem esse filtro a vela abria na cotação velha da véspera; com ele, abre no primeiro negócio do dia. Na segunda 21/09, por exemplo, as horas de 00h a 03h repetiam 5,1442 e o pregão abriu em 5,1287.

A vela diária fecha na virada do dia UTC e a semanal na virada de sexta para sábado UTC. O que for mais antigo que as horas vem da série longa com o **fechamento reparado pela abertura da vela seguinte** — o dado certo mais próximo, com erro mediano de 0,0021 no mesmo diagnóstico — e máxima/mínima alargadas para contê-lo.

**Se a consulta de 1 hora falhar**, o par não cai: a série inteira sai da longa reparada e `dados_avisos` diz `Yahoo 1h indisponivel (...)`. É muito melhor que o fechamento quebrado e bem pior que as horas, e por isso aparece escrito.

**Efeito na primeira execução.** Comparando o código anterior e o novo sobre as mesmas respostas, no runner: USDT/BRL **idêntico**, gatilhos idênticos; no USD/BRL mudaram os indicadores, as velas, os pivôs e as zonas. Exemplos: o diário de 24/09 passou a fechar em 5,1912 (era 5,1643), o ATR14 diário foi de 0,0553 para 0,0504, e o semanal passou de `lateral_contracao` (LH_HL) para `alta` (HH_HL). O estado persistido (níveis, zonas, EMA89 semanal) não foi reconstruído: segue a partir do que estava salvo, e as velas novas já entram certas. `docs/historico.jsonl` guarda os fechamentos antigos do USD/BRL como eram; análises históricas do USD/BRL anteriores a 2026-09-26 carregam o defeito.

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

- Depois do encerramento, a última cotação disponível também pertence à série fechada: a sexta-feira entra nos indicadores durante o fim de semana. `vela_atual_em_formacao: nao` identifica esse caso, e o bloco `candle_atual_*` sai em branco para a mesma barra não ser publicada duas vezes. Os campos provisórios repetem os indicadores fechados, sem anexar a mesma vela duas vezes; não são gerados padrões, divergências ou toques intradiários de uma vela inexistente.
- No USD/BRL, a vela montada das horas fecha na virada do dia UTC, e a semana na virada de sexta para sábado UTC. Sem calendário de feriados, um encerramento antecipado só é reconhecido nessa virada. (A leitura direta da série longa, usada só para o histórico antigo, ainda sabe usar `currentTradingPeriod.regular.end`.) Binance usa `closeTime`; Mercado Bitcoin usa o limite do período de 24 horas/7 dias. A semana cripto continua em formação no domingo.
- `retestMaxCandles` conta **dias corridos**, não pregões. Os 30 do diário valem cerca de 21 velas diárias reais.

### A vela-fantasma

Fora do pregão o Yahoo não simplesmente para de mandar velas: ele **acrescenta uma vela carimbada agora**, com o último preço repetido nas quatro pontas e amplitude zero. Não é uma sessão.

Isso apareceu na primeira execução real, num sábado. Se a vela entra na série, ela vira a "vela em formação" do sábado, o relatório publica como `preco_atual` um número que não fechou em lugar nenhum, e `vela_atual_em_formacao` diz `sim` com o mercado fechado.

O parser do Yahoo mantém o filtro de **amplitude zero** (`high === low`) para essas repetições. É uma heurística da fonte, não uma prova de que houve ou não pregão. O filtro não se aplica à Binance ou ao Mercado Bitcoin: uma vela cripto recém-aberta pode legitimamente estar plana. O fim da vela é verificado separadamente, como descrito acima.

**O filtro de amplitude não bastava.** Em 2026-09-13, um domingo, o Yahoo mandou `open=5.1262 high=5.1270 low=5.1262 close=5.1270` — amplitude de 0,0008 contra uns 0,04 de um pregão de verdade, mas diferente de zero, então a barra passou. Enquanto ela era a última linha da série, ficava de fora das fechadas de qualquer jeito. Quando o período dela venceu, passou a ser tratada como **fechada** e entrou na série: virou `candle_fechado_1`, empurrou a sexta-feira para trás e levou um true range de 0,0008 para dentro do ATR. Medido na série de teste: ATR14 caindo 6,8%, RSI21 de 100,00 para 90,91, e uma vela a mais na semana. No semanal foi pior — `inicioSemana(domingo)` cai na segunda da **mesma** semana, então a cotação de domingo virava o fechamento da semana inteira.

Por isso o parser do câmbio descarta também, nominalmente, **qualquer barra carimbada em sábado ou domingo** (`ignorarFimDeSemana`). Câmbio à vista não negocia nesses dias: a barra não é pregão, é a última cotação repetida. Como o filtro de amplitude, ele vale só para a fonte de câmbio — Binance e Mercado Bitcoin negociam todo dia e não passam essa opção.

**Migração dos dados já gravados (2026-09-14).** Descartar a barra na fonte não desfazia o reteste de 5,13 nem os avanços indevidos dos contadores das zonas diárias já salvos. O estado diário de USD/BRL foi restaurado a partir do último estado anterior ao processamento da barra falsa ([commit a5c7ba4](https://github.com/matheussamadello/Monitor-USD-Price/commit/a5c7ba4ac979b1879e3999d8b43237335b8a556b)), preservando os outros pares e o semanal. A recuperação mantém os IDs e o histórico válido, sem anunciar um reteste novo. Cinco snapshots afetados pela cotação falsa ou pelo estado dela derivado foram retirados de `docs/historico.jsonl` e preservados em [docs/historico-invalidado.jsonl](docs/historico-invalidado.jsonl), com o motivo; esse arquivo não participa da análise histórica. O parser continua filtrando novas barras de fim de semana, e o teste de regressão verifica também o estado e o histórico persistidos.

O **diário** é o timeframe principal para timing de pullbacks, rompimentos, retestes, perda/recuperação de níveis, candles e mudanças de momentum.

O **semanal** funciona principalmente como contexto e filtro estrutural: ajuda a identificar se um sinal diário está alinhado, neutro ou em conflito com a estrutura maior. O relatório também calcula os mesmos indicadores principais no semanal e distingue os valores da vela semanal fechada dos valores provisórios da semana em formação.

### A semana em pedaços

O Yahoo tem um segundo defeito de carimbo, só no semanal: a barra da semana **em andamento** vem carimbada com a data do dia, não com a segunda-feira — e às vezes vem em dois pedaços, um "segunda a quarta" carimbado na segunda e um "quinta até agora" carimbado na quinta. Cada carimbo virava uma vela própria: a semana corrente saía como **fechada** com o fechamento de quarta, e nascia uma "semana" de um dia. O filtro da vela-fantasma não pega isso, porque o pedaço tem amplitude — é meio pregão de verdade.

Foi flagrado em 2026-09-10, quinta, com `ultimo_fechamento_data: 2026-09-07` no semanal e uma `candle_atual_data: 2026-09-10`. O histórico mostrou que vinha oscilando desde terça, e a máquina de estados já tinha registrado um rompimento semanal de 5,13 sobre um fechamento que não existiu.

No semanal, `montarSerie` passou a agrupar as barras pela **segunda-feira da semana** (`inicioSemana`) e a fundir pedaços da mesma semana: abertura do primeiro, extremos do conjunto, fechamento do último. Essa ancoragem semanal é compartilhada pelas três fontes; para barra que já vem ancorada na segunda (Binance, Mercado Bitcoin) a chave é identidade e nada muda. O diário não é afetado. `fracao_periodo_decorrida` do semanal, que era medida a partir do carimbo errado, passa a ser medida da segunda.

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

### RSI

**O período é diferente em cada timeframe**, e o relatório declara qual usou:

| Timeframe | RSI Length | Papel |
| --- | --- | --- |
| Diário | 21 | momentum, perda de força e retomada, na escala de swing e position |
| Semanal | 14 | leitura estrutural de momentum |

Até 2026-09-11 o RSI usava 14 nos dois timeframes, por herdar o mesmo `PERIOD` que o DMI usava. O 14 no diário oscila demais para o horizonte deste monitor.

Uma relação foi preservada de propósito: **em cada timeframe o RSI continua mais responsivo que o DMI/ADX** — 21 contra 28/42 no diário, 14 contra 14/21 no semanal. É do RSI que se espera perceber momentum e retomada antes do DMI confirmar; se ele ficasse mais lento que o ADX, perderia essa função. Há teste fixando isso.

O cálculo usa suavização de Wilder/RMA — igual desde o início, só o período mudou.

O relatório separa:

- `rsi_length`: o período usado **naquele bloco**;
- `rsi_fechado`: calculado apenas com velas fechadas;
- `rsi_provisorio`: inclui a vela atualmente em formação.

Os campos perderam o `14` do nome pelo mesmo motivo dos de DMI: `rsi14_fechado` guardando um RSI de 21 seria mentira.

**Os limiares não mudaram** — 70, 30 e 40 continuam onde estavam. Mas um RSI de 21 é menos extremo que um de 14: `rsi_acima_70` e `rsi_abaixo_30` passam a disparar menos no diário, e `rsi_esfriando` (que exige RSI acima de 40) muda de frequência. As divergências também usam o RSI como oscilador, então mudam de período junto.

O código também detecta divergências RSI confirmadas e provisórias a partir de pivôs de preço.

### DMI/ADX

**Os períodos são diferentes em cada timeframe**, e o relatório declara qual usou:

| Timeframe | DI Length | ADX Smoothing | Papel |
| --- | --- | --- | --- |
| Diário | 28 | 42 | leitura **operacional** de tendência e força, para swing e position |
| Semanal | 14 | 21 | **contexto** da tendência de prazo maior |

Até 2026-09-11 havia um único período, 14, servindo ao mesmo tempo de DI Length e de ADX Smoothing nos dois timeframes. O 14/14 no diário reagia a ruído de curto prazo demais para o horizonte deste monitor; 28/42 alonga a janela e alisa o ADX. No semanal, 14/21 já é lento o bastante nessa escala — alongar mais só atrasaria a leitura sem ganhar filtragem.

São calculados:

- `dmi_di_length` / `dmi_adx_smoothing` — a configuração usada **naquele bloco**;
- `di_plus_fechado` / `di_plus_provisorio`;
- `di_minus_fechado` / `di_minus_provisorio`;
- `adx_fechado` / `adx_provisorio`.

Os campos perderam o `14` do nome na mesma mudança: um campo chamado `adx14_fechado` guardando um ADX alisado em 42 seria mentira. Quem precisa do período lê `dmi_di_length` e `dmi_adx_smoothing`, que saem ao lado dos valores, e o cabeçalho do relatório lista os dois timeframes.

O **semanal não é gatilho de entrada isoladamente** — serve de confirmação e contexto. E o ADX não é o gatilho principal em nenhum dos dois: preço, estrutura, rompimentos/retestes e candles continuam com prioridade.

O cálculo usa a suavização de Wilder/RMA em todas as etapas — só os períodos mudaram. O ADX mede força direcional e deve ser interpretado junto de DI+ e DI−; o monitor não trata ADX isoladamente como direção de mercado.

### EMA89

O monitor calcula uma **EMA exponencial de 89 períodos** e publica, entre outros campos:

Campos que olham a vela **em formação**:

- `ema89`;
- `posicao_vs_ema89`;
- `distancia_ema89_pct`.

`posicao_vs_ema89` e `distancia_ema89_pct` comparam a média com o preço vivo, então mudam durante o dia. Servem para contexto, nunca para confirmação.

Campos calculados **só com velas fechadas**:

- `ema89_fechada_atual`;
- `ema89_fechada_anterior`;
- `ema89_cruzamento_fechado`;
- `distancia_ema89_fechada_atr`.

`ema89_fechada_anterior` é a média no fechamento anterior. Sem ela, quem lê o relatório não conseguia saber se houve travessia sem depender da própria memória de execuções passadas — o monitor publica de hora em hora e não garante essa memória. `ema89_cruzamento_fechado` traz o veredito pronto (`acima`, `abaixo` ou `nenhum`) e `distancia_ema89_fechada_atr` mede a distância do fechamento até a média em ATR do próprio timeframe, que é a margem usada para separar travessia real de simples encostada.

Nada disso exige cálculo novo nem estado guardado entre execuções: são dois pontos de uma série que o monitor já tinha em memória e não publicava.

No uso do relatório por agentes externos, a EMA89 diária pode funcionar como suporte/resistência dinâmica para timing, enquanto a EMA89 semanal é especialmente útil como filtro de contexto maior.

### Dois horizontes

O mesmo relatório atende dois horizontes de swing, sem nenhum campo novo no JSON:

- **tático**, de 1 a 6 semanas, em que o diário pesa mais;
- **estratégico**, de vários meses a mais de um ano, em que o semanal pesa mais.

A separação vive no prompt, não no monitor: `monitor.mjs` publica fatos de mercado e não sabe qual é o horizonte de quem lê. Divergência entre os dois — semanal íntegro e diário cedendo — é o estado normal de um pullback, não erro de dados.

### ATR(14) — volatilidade

O monitor calcula **ATR de 14 períodos** por Wilder sobre velas fechadas e publica:

- `atr14` — em unidade de preço;
- `atr14_pct` — o mesmo em porcentagem do fechamento.

O ATR sempre existiu internamente, dimensionando a largura das zonas automáticas, mas não era publicado. Agora sai no relatório, porque é a leitura que permite dimensionar distância de stop e tamanho de posição sem refazer a conta por fora.

Use `atr14_pct` para comparar **o mesmo timeframe ao longo do tempo**: o valor absoluto não diz nada sozinho. `0,05` é muito ou pouco dependendo do par e da época; `1,18%` é comparável com qualquer coisa.

Já comparar o ATR diário com o semanal não rende conclusão. A amplitude escala com a raiz do número de períodos, então o semanal fica naturalmente em torno de 2 a 2,5 vezes o diário — a diferença é aritmética, não sinal.

Ele também é a unidade em que a obsolescência dos níveis manuais é medida — ver abaixo.

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

### Estrutura recente e sequência ampliada no painel

O título **Estrutura dos últimos pivôs confirmados** delimita a leitura recente: dois topos e dois fundos, sem concluir a tendência geral do ativo. Os seis valores canônicos não mudam. Na página, `estrutura_de_baixa` aparece como `estrutura_recente_de_baixa`, e `estrutura_de_alta_preservada` como `estrutura_recente_de_alta_preservada`; chips de eventos estruturais também qualificam o horizonte recente. Relatório, estado, histórico, prompts e automações conservam os identificadores originais.

| Pivôs recentes | Sequência ampliada | Síntese visual |
|---|---|---|
| Baixa | Alta | Correção recente dentro de estrutura ampliada ainda altista |
| Alta | Baixa | Recuperação recente dentro de estrutura ampliada ainda baixista |
| Alta / baixa | Mesma direção | Estrutura recente e ampliada alinhadas em alta / baixa |
| Lateral | Alta / baixa | Estrutura recente lateral dentro de contexto ampliado predominantemente altista / baixista |
| Indefinidos ou sequência incompleta | Qualquer | Texto neutro que identifica a limitação da comparação |

Essa divergência pode ocorrer porque as janelas são diferentes. Os tooltips esclarecem que a leitura recente não significa automaticamente uma reversão da tendência geral e deve ser comparada com a sequência ampliada e os demais indicadores.

O painel mantém a **estrutura recente**, calculada pelos dois últimos topos e dois últimos fundos confirmados, e acrescenta a **sequência ampliada**: os quatro últimos pivôs de cada tipo, com três comparações por grupo. O diário continua confirmando pivôs com cinco velas posteriores fechadas; o semanal, com duas. A vela em formação não participa. Os pivôs podem abranger períodos diferentes, e suas datas e preços ficam acessíveis em “Ver pivôs e comparações”.

- **Consistente:** as três comparações de topos e as três de fundos concordam com o padrão mostrado.
- **Predomínio:** pelo menos duas das três comparações de cada grupo concordam com ele.
- **Sequência mista:** pelo menos um dos grupos não tem direção predominante. Preços iguais são neutros.
- **Histórico insuficiente:** faltam quatro topos ou quatro fundos confirmados; o painel informa quantos existem.

Topos e fundos subindo indicam alta; ambos caindo, baixa; topos caindo com fundos subindo, contração; o inverso, expansão. Se a estrutura recente divergir do padrão ampliado, o painel mostra essa divergência. A contagem descreve a sequência observada e não mede a probabilidade de sucesso de uma operação.

Essa informação é **exclusivamente visual**. Os campos existentes de estrutura, o relatório JSON/texto, o histórico, os gatilhos e os prompts dos alertas mantêm seu comportamento. Os dados visuais são calculados por par e timeframe na mesma execução que gera o HTML. Os tooltips explicam as duas janelas, os fractais 5/5 no diário e 2/2 no semanal e o atraso de confirmação (cinco velas diárias ou duas semanais fechadas à direita). Uma síntese descritiva visível relaciona os horizontes sem indicar compra, venda ou entrada. Quantidades insuficientes também ficam no “?” da sequência ampliada. O campo “EMA89 (fechado)” acrescenta “cruzou” somente quando houve mudança de lado no último fechamento, mantendo a distância em porcentagem.

### Validação dos candles do Yahoo

Uma barra com os quatro preços ausentes é ignorada como sessão sem dados. Cotações repetidas do mesmo dia são deduplicadas antes da validação: vale a última não vazia, para uma versão parcial anterior não invalidar a atualização completa. Ausência parcial ou preço não positivo/não finito rejeita a resposta e aciona a próxima fonte; se todas falharem, o bloco publica falha. Candles históricos completos com OHLC inconsistente são descartados, sem inventar preços; as datas ficam em `dados_avisos` no relatório. Se o candle mais recente for inconsistente, a resposta é rejeitada, para não apresentar uma cotação anterior como atual. Os filtros de calendário continuam valendo. Um `null` nunca é convertido em mínima zero. A validação aceita números do JSON, sem converter texto ou valores booleanos em preços.

### Correções de lógica e continuidade

- Eventos de estrutura são publicados somente no fechamento que confirma o novo pivô; o padrão antigo não reaparece como evento nos candles seguintes.
- Topos ou fundos iguais recebem `lateral_empate`, sem produzir `estrutura_de_baixa`. No painel, a classificação aparece como “estrutura com empate”.
- A retomada dos níveis processa os candles disponíveis em ordem. Um contato na vela atual impede arquivamento por inatividade; o estado dormente também registra a última vela avaliada.
- **Carimbo de última vela processada.** A retomada acima parte do estado do próprio nível. Só que a máquina de um nível só abre registro quando ele é rompido pela primeira vez — e a maioria dos níveis configurados não tem registro nenhum. Para esses, não havia de onde partir: uma interrupção longa fazia um rompimento ocorrido durante a queda ser tratado como novo na volta. O estado agora guarda `ultimaVelaProcessada`, uma data por par e timeframe, que separa dois casos até então idênticos aos olhos do código: *primeira execução do monitor*, em que não há o que retomar, e *nível que simplesmente nunca rompeu*, em que há.
- Para retomar um nível sem registro próprio, o carimbo precisa estar na janela da série atual. Um carimbo antigo fora da janela permite estabelecer a referência na última vela, sem inventar história. Havendo registro próprio, a retomada parte dele. Separadamente, o carimbo protege todo o par/timeframe contra respostas anteriores: se a fonte devolver uma última vela mais antiga que a já processada, o bloco falha e a memória é preservada. Ele **só avança depois de um bloco lido com sucesso**, nunca para trás.
- Nada disso vira notícia atrasada: o evento publicado continua sendo só o da última vela. Um ciclo que se fechou durante a interrupção é **recuperado no estado e silencioso no relatório**. Sem carimbo — primeira execução, ou estado gravado antes do campo existir — o comportamento é exatamente o anterior, o que torna a migração um não-evento.
- Os READMEs, prompts e ajudas distinguem faixas manuais de níveis pontuais. A ausência de novidade em níveis/estrutura não exclui eventos próprios da EMA89 ou dos indicadores.

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

**O fractal é por timeframe**, pelo mesmo motivo do RSI e do DMI, e o relatório declara qual usou em `pivos_fractal`:

| Timeframe | Fractal | Confirmação exigida |
| --- | --- | --- |
| Diário | 5/5 | 5 velas à esquerda e 5 à direita; o pivô só é confirmado depois que as 5 velas à direita fecham |
| Semanal | 2/2 | 2 velas à esquerda e 2 à direita; o pivô só é confirmado depois que as 2 velas semanais à direita fecham |

Até 2026-09-11 os dois usavam 2/2, que era o único parâmetro de análise nunca desacelerado quando o monitor assumiu horizonte de swing e position. Na série sintética de 720 velas **sem tendência nenhuma** usada na auditoria, a `estrutura_tendencia` publicada mudou de direção 98 vezes com 2/2 e 43 vezes com 5/5. O ganho do 5/5 diário vem da janela local mais larga e do maior atraso de confirmação, que filtram extremos curtos e reduzem ruído. Isso **não** significa que exista uma distância mínima fixa de 10, 7 ou qualquer outro número de velas entre pivôs consecutivos. O detector de divergências continua exigindo cinco velas entre os pivôs; o 5/5 diário também reduziu leituras recusadas por pivôs próximos. O semanal fica em 2/2 porque cada vela já cobre uma semana: levá-lo a 5/5 faria um pivô candidato esperar cinco velas semanais à direita para ser confirmado, atraso excessivo para a janela útil deste monitor.

`estrutura_tendencia` tem **seis** valores:

- `alta` — HH + HL;
- `baixa` — LH + LL;
- `lateral_contracao` — LH + HL, o range aperta com o fundo subindo;
- `lateral_expansao` — HH + LL, o range abre pelas duas pontas;
- `lateral_empate` — pelo menos um extremo repetiu o preço anterior (EH = topo igual; EL = fundo igual). Empate não confirma alta nem baixa;
- `indefinida` — não há pivôs suficientes para declarar estrutura.

Antes, contração, expansão e ausência de dados saíam todas como `lateral_indefinida`. Isso juntava duas situações opostas, contração e expansão, e chamava de lateral um mercado cujo range está **abrindo**. Pior, afirmava um estado de mercado quando o que havia era ausência de dado. A distinção não é acadêmica: o prompt usa a estrutura semanal como uma das condições que promovem um alerta tático a estratégico, e um semanal fazendo fundo mais alto contava como deterioração da tese de prazo longo.

### Divergências

O monitor publica:

- `divergencia_rsi`: divergências confirmadas;
- `divergencia_rsi_provisoria`: divergências que ainda dependem da vela em formação.

A confirmação usa pivôs; por isso uma divergência provisória pode desaparecer antes do fechamento.

## Dados fechados x dados provisórios

Essa distinção é central no projeto.

Campos `*_fechado` usam somente velas concluídas e são a referência principal para confirmação. Campos `*_provisorio` incorporam a vela em formação e podem mudar até o fechamento.


### Quando não existe vela em formação

`vela_atual_em_formacao` responde isso, e vem logo antes do bloco que ele qualifica.

Em cripto a resposta é sempre `sim`: o mercado não fecha, então a última barra está sempre aberta. Em fonte com pregão não: encerrado o pregão, a última barra **já é uma barra fechada**. Nesse caso o relatório publica `vela_atual_em_formacao: nao`, e o bloco `candle_atual_*` e a `fracao_periodo_decorrida` saem como `--`.

Saem em branco de propósito. Com valores, o mesmo período aparecia duas vezes no mesmo bloco — uma como "atual", com `close_provisorio` e fração de período decorrida, outra como `ultimo_fechamento_*` —, e nada dizia que eram a mesma barra. Para quem lê, é a diferença entre uma evidência e duas. Nenhuma informação se perde: a barra continua em `ultimo_fechamento_*` e, com o OHLC completo, em `candle_fechado_1`.

Os campos `*_provisorio` continuam publicados nesse caso, e repetem os fechados — o cabeçalho da seção diz isso em vez de prometer que ainda podem mudar.

O mesmo princípio vale para padrões, divergências, candle atual e volume parcial.

Em integrações com bots ou LLMs, é recomendável que sinais de maior convicção exijam fechamento quando a regra depender explicitamente de confirmação, enquanto dados provisórios podem ser usados para acompanhamento antecipado sem serem tratados como equivalentes ao fechamento.

## Níveis manuais

Faixas revistas em 2026-09-25 conforme as concentrações de pivôs e reações. O teto de segurança na calibração é **0,5 ATR diário de largura total**, sem largura alvo uniforme nem limite percentual de 1%. Apenas faixas que excluíam evidência próxima foram alargadas. Permanecem fixas até revisão manual. Os níveis pontuais e seus ciclos de rompimento/reteste continuam iguais.

As faixas não mudam automaticamente com o ATR. A revisão preservou o número de referências e manteve separadas as concentrações distantes. Score e contagens da faixa antiga não são herdados pelos limites novos. O detector automático e sua tolerância operacional continuam iguais.

### USDT/BRL

| Faixa atual | Label | Pivôs confirmados incluídos |
| --- | --- | --- |
| 5,338–5,3465 | `faixa_5_338_5_3465` | 5,34, 5,3415, 5,3448 |
| 5,2935–5,3015 | `faixa_5_2935_5_3015` | 5,295, 5,3001 |
| 5,274–5,2858 | `faixa_5_274_5_2858` | 5,2755, 5,28 |
| 5,191–5,1965 | `faixa_5_191_5_1965` | 5,1926, 5,1948 |
| 5,1525–5,162 | `regiao_suporte_5_1525_5_162` | 5,1539, 5,1587, 5,161 |
| 5,12–5,137 | `faixa_5_12_5_137` | 5,122, 5,135 (e 5,123, 5,137 de 2024) |
| 5,0725–5,0896 | `faixa_5_0725_5_0896` | 5,0745, 5,0768, 5,0813, 5,0852, 5,0856, 5,0876 (e 5,079 de 2024) |

Resistência pontual: **5,31**. Suporte pontual: **5,15**.

As duas últimas foram **promovidas em 2026-09-26** a partir do radar, com os limites estruturais das zonas arredondados para fora na quarta casa:

- **5,0725–5,0896** (zona `usdt|diario|z3`): score 94, 10 toques, 9 rejeições, confirmada no diário e no semanal, sem penalidade. Dois topos de maio viraram suporte em quatro fundos de julho a setembro.
- **5,12–5,137** (zona `usdt|diario|z65`): score 78, 10 toques, 6 rejeições, confirmada nos dois timeframes, com a penalidade de ter sido rompida duas vezes sem reação.

Nenhuma sobrepõe outra faixa: a mais próxima é 5,1525–5,162, a 0,0155 acima. O suporte pontual de 5,15 fica no vão entre elas, fora de qualquer faixa, e a máquina de rompimento/reteste dele não muda. A terceira região que o radar apontava no mesmo dia, 5,2181–5,2219 (6 toques e 0,0038 de largura, nascida da divisão de zonas em 2026-09-24), ficou em observação.

### USD/BRL

| Faixa atual | Label | Pivôs confirmados incluídos |
| --- | --- | --- |
| 5,3315–5,341 | `faixa_5_3315_5_341` | 5,33284521, 5,33850002, 5,33970022 |
| 5,2525–5,2675 | `faixa_5_2525_5_2675` | 5,25400019, 5,25812817, 5,26617479 |
| 5,168–5,181 | `faixa_5_168_5_181` | 5,16900015, 5,16989994, 5,17980003 |
| 5,129–5,1395 | `faixa_5_129_5_1395` | 5,13075018, 5,13780689 |
| 5,068–5,0805 | `regiao_suporte_5_068_5_0805` | 5,06960201, 5,0790782 |
| 5,049–5,0545 | `regiao_suporte_5_049_5_0545` | 5,05053997, 5,05066204, 5,0532999 |
| 4,9945–5,0005 | `regiao_suporte_4_9945_5_0005` | 4,99590015, 4,99780607, 4,99849987, 4,99900007 |

Resistência pontual: **5,3**. Suporte pontual: **5,13**.

Os [resultados do reajuste](REAJUSTE_FAIXAS_2026-09-25.md) e a [evidência com pivôs, janelas e medidas](reajuste-faixas-manuais-2026-09-25.json) documentam os limites atuais. A [auditoria anterior](AUDITORIA_FAIXAS_2026-09-25.md) e a [calibração mais estreita](revisao-faixas-manuais-2026-09-25.json) permanecem como registros históricos.

O relatório atual é a fonte de verdade para `niveis_manuais.faixas`. A mudança não reescreve o histórico. Labels anteriores permanecem nos registros antigos. Novos limites podem aumentar o tempo dentro da faixa e alterar a assinatura no primeiro processamento; isso é manutenção de configuração, não movimento novo do preço.

## Vigilância dos níveis manuais

Os níveis manuais são a espinha da política de alerta: janela agressiva, confirmação conservadora e a própria revisão de níveis partem todos deles. Quando envelhecem, o monitor não passa a errar — ele fica **mudo** justamente na parte que mais importa, e nada avisa.

Foi o que aconteceu no monitor de XMR: o preço rompeu a resistência manual em 17/08 e seguiu até 29% acima da faixa mais alta configurada, republicando de hora em hora um rompimento que havia muito deixara de ser notícia. Detectar isso estava delegado a quem lesse o relatório, e é exatamente o tipo de coisa que ninguém nota, porque nada acontece.

Agora o relatório publica, por par e por timeframe:

| Campo | O que traz |
| --- | --- |
| `niveis_manuais_situacao` | `atual`, `monitorar` ou `obsoleto` |
| `niveis_manuais_distancia_atr` | distância do **último fechamento** até a faixa manual mais próxima, em ATR |
| `niveis_manuais_faixa_mais_proxima` | qual faixa é essa |
| `niveis_manuais_alinhamento` | `alinhado`, `parcial`, `desalinhado` ou `indefinido` |
| `niveis_manuais_faixas_corroboradas` | quantas faixas caem sobre uma zona automática |

Os cortes são **1 ATR** e **3 ATR**: dentro de uma faixa ou a menos de 1 ATR dela é `atual`; entre 1 e 3 é `monitorar`; além de 3 é `obsoleto`.

As duas pontas da conta usam **vela fechada** — o fechamento e o ATR. A primeira versão passava o preço da vela em formação, o que misturava provisório com confirmado num híbrido sem significado limpo, e contrariava a convenção do próprio monitor, em que o que alimenta decisão usa vela fechada. E este campo alimenta uma: a revisão dos níveis manuais. O custo é uma vela de latência, irrelevante para um sinal cujo caso de origem levou 19 dias para ser notado.

A distância é medida em ATR, e não em porcentagem, de propósito. Cinco por cento é muito num par de câmbio e pouco num de cripto, enquanto "três vezes a volatilidade diária" quer dizer a mesma coisa em qualquer um — um limiar só serve para os três monitores, sem recalibragem.

**Situação e alinhamento medem coisas diferentes.** A situação mede a distância do preço; o alinhamento mede se as faixas continuam caindo onde o mercado de fato reage, comparando cada uma com as zonas automáticas pelo mesmo critério de sobreposição usado nas confluências. A comparação usa **todas as zonas vivas do par**, não a lista publicada.

Essa distinção não é detalhe. A página mostra no máximo três zonas de cada lado do preço, e o alinhamento herdava esse corte — então uma faixa longe do preço só podia ser comparada com zonas perto do preço, e estava condenada a sair como não corroborada para sempre. Uma faixa de suporte profundo, marcada exatamente sobre uma zona de dez toques, seria acusada de desalinhada pelo relatório. O corte de três é de exibição; medir alinhamento com ele era medir a coisa errada. Medido no retrato de regressão do BTC com as faixas mantidas fixas, para isolar o conserto do resto: o diário sai de `desalinhado`, 0 de 5, para `parcial`, 3 de 5, e o semanal de 3 para 4 corroboradas. Nos dados ao vivo do dia ele não mexeu em nenhuma faixa antiga — o que ele fez foi permitir que a faixa de suporte profundo recém-promovida fosse corroborada, e nenhuma zona publicada a corrobora. Os dois podem discordar, e é justamente a discordância que interessa: uma faixa pode estar a 0,66 ATR do preço, portanto `atual`, e mesmo assim estar deslocada da região que o mercado respeita.

Era o caso do monitor de BTC quando este campo foi criado. Nenhuma das três faixas manuais atingia o limite de sobreposição em nenhum dos dois timeframes, e as duas do diário ficavam logo abaixo dele porque estavam cerca de 1.500 dólares abaixo de onde o mercado reagia: a zona automática de score 99 ficava em 79.536 a 81.093, contra a faixa configurada de 78.000 a 80.000. Nada no relatório dizia isso, porque o único campo que olhava as faixas media distância até o preço. O sinal existia por zona, em `confluencia_faixa_manual`, mas nunca era somado.

`obsoleto` não é alerta de mercado: é aviso de manutenção. Significa que os níveis descrevem um regime que ficou para trás e precisam de revisão.

### Perda de suporte: forte x fraca

`rompimento_confirmado_X` só sai quando o **corpo inteiro** da vela fechada está acima da resistência; se só o fechamento passou, sai `rompimento_confirmado_fraco_X`. O suporte não tinha essa distinção: qualquer fechamento abaixo, por qualquer margem, virava `perda_suporte_confirmada_X` e entrava em `deterioracao_tendencia`.

O caso que expôs isso foi o XMR/USD em 2026-09-08: abriu 519,23 e fechou 499,77 com suporte em 500. Fechou 0,23 abaixo — menos de um centésimo de ATR — com o corpo inteiro em cima do nível. Saía como perda confirmada enquanto a máquina de estados, que olha o corpo, dizia `sem_registro`.

Agora o suporte espelha a resistência: `perda_suporte_confirmada_X` exige o corpo abaixo; só o fechamento abaixo vira `perda_suporte_confirmada_fraca_X`. A versão fraca continua contando como `suporte_sob_pressao` em `riscos_tecnicos`, mas não entra em `deterioracao_tendencia`. A síntese também passou a ignorar a versão fraca do rompimento em `confluencia_entrada`, que antes escapava por causa do prefixo.

**A mesma fuga por prefixo tinha uma terceira ocorrência, achada depois: a confirmação de volume.** `rompimento_confirmado_` casa com `rompimento_confirmado_fraco_`, e `perda_suporte_confirmada_` com `perda_suporte_confirmada_fraca_`. Enquanto `deterioracao_tendencia` e `confluencia_entrada` já excluíam a versão fraca, o gatilho do volume não excluía — então uma encostada no fechamento saía acompanhada de `rompimento_com_volume_acima_da_media` ou `queda_com_expansao_de_volume`, empurrando para o lado oposto da regra que o prompt enuncia: a fraca deve ser lida como um toque intradiário, e toque intradiário não recebe volume. Agora as três saídas usam o mesmo critério.

**E havia uma quarta captura, de natureza diferente.** O gatilho que suprime `pullback_com_volume_decrescente` usava o prefixo `rompimento_`, que casa com `rompimento_falhou_X` — o *oposto* de um rompimento, já que o preço atravessou e voltou para o lado de origem. Numa vela com estrutura de alta, volume caindo e tentativa rejeitada, pullback é exatamente a descrição correta, e era justamente ali que ela sumia. `rompimento_candidato_X` e `rompimento_intradiario_X` continuam suprimindo, e devem: lá o rompimento está acontecendo, e chamar a mesma vela de pullback tranquilo seria contradição. Nos 109 registros gravados, 6 traziam `rompimento_falhou` e nenhum com estrutura de alta, então nenhum relatório publicado teria mudado. Nos 101 registros de histórico gravados até aqui, 13 traziam um evento fraco e nenhum deles coincidiu com confirmação de volume, então o defeito era alcançável mas ainda não tinha chegado ao relatório.

## Máquina de estados de rompimento e reteste

Os níveis pontuais possuem estado persistente, avaliado apenas sobre **velas fechadas**. Após uma interrupção, o monitor percorre em ordem os candles disponíveis posteriores ao estado salvo, usando o ATR de cada um. Só as mudanças pertencentes ao último fechamento são publicadas como eventos atuais. Sem estado anterior, a referência inicial é o último fechamento; não são reconstruídos alertas antigos.

Os principais estados implementados são:

- `rompimento_candidato`;
- `rompido`;
- `em_reteste`;
- `reteste_confirmado`;
- `rompimento_falhou`;
- `recuperado`.

O registro marca `afastado` sempre que o preço estiver além da distância de reset do nível, **em qualquer estado**. Isso já foi diferente: a marcação só valia ao encerrar um ciclo de reteste, então um nível rompido semanas antes e deixado 29% para trás continuava publicando `afastado: nao`, e quem lesse concluía que o preço ainda estava por perto. O encerramento do ciclo — voltar de `reteste_confirmado` ou `recuperado` para `rompido` — continua restrito aos dois estados em que faz sentido. Estados inativos podem ser arquivados sem apagar o histórico do ciclo.

A máquina diferencia um critério sensível, que apenas arma um `rompimento_candidato`, de um critério mais rigoroso usado para classificar `rompido`.

**A tolerância e a distância de reset são medidas em ATR**, como todo o resto do projeto: 0,25 ATR de largura em torno do nível e 1,5 ATR para encerrar o ciclo. Eram percentuais fixos, e um percentual fixo vale coisas diferentes em cada ativo. Com 0,5%, a janela de reteste valia 0,077 ATR no XMR/USD e 0,592 ATR no USDT/BRL, quase oito vezes mais larga: num par ela era dez vezes mais estreita que uma zona automática e no outro quase do tamanho de uma zona inteira, de modo que `reteste_confirmado` queria dizer coisas diferentes em cada lugar. O reset do USDT/BRL chegava a 3,55 ATR, além dos 3 ATR em que os níveis já são declarados obsoletos, então o ciclo praticamente nunca reiniciava. O monitor de câmbio já tinha os números cortados pela metade à mão para contornar isso; medidos em ATR, aqueles valores ajustados davam 0,23 a 0,30 ATR e 1,36 a 1,78 ATR, quase exatamente os valores que agora valem para qualquer par sem ajuste por fonte.

**Um nível abandonado é arquivado, nunca apagado.** Quando passa da janela de inatividade sem contato, o registro vira `arquivado` e fica dormente; se o preço voltar a encostar, ele acorda e o ciclo recomeça em reteste. Antes o registro era apagado quando ainda não tinha histórico, e na vela seguinte o nível nascia do zero em `rompido` — que o relatório anuncia como rompimento novo. Uma resistência rompida com o preço indo embora reanunciava o mesmo rompimento a cada 32 velas diárias, indefinidamente: sete anúncios em duzentos dias, contra o que o prompt promete, que um rompimento vira notícia uma vez só.

## Zonas automáticas de suporte e resistência

Além dos níveis manuais, o monitor calcula **zonas automáticas** a partir dos pivôs confirmados.

No código atual essas zonas são **contexto técnico**. Elas não alteram sozinhas os gatilhos manuais, a máquina de estados dos níveis ou as confluências principais do monitor.

### ATR e agrupamento de pivôs

Usa ATR(14) de Wilder sobre velas fechadas e conserva o ATR da época de cada pivô. O agrupamento inicial continua exigindo compatibilidade entre **todos os pares** de pivôs, evitando encadeamento.

A [calibração de equivalência espacial](AUTO_EQUIVALENCIA_2026-09-25.md) aproxima a geometria automática das faixas manuais sem copiar seus preços ou scores. A folga estrutural caiu de 0,15 para 0,05 ATR por borda; a janela operacional continua com até 0,5 ATR total. O semanal usa coeficiente menor por ter ATR maior. A equivalência é aproximada, não uma garantia da mesma largura em preço.

O limite estrutural total, incluindo a folga, é **0,5 ATR fechado atual no diário** e **0,3 ATR no semanal**. Se um cluster exceder esse limite, procura-se o maior vão que separe duas concentrações: pelo menos dois pivôs de datas distintas em cada parte, vão de pelo menos 0,2 ATR de referência e pelo menos duas vezes o espaçamento médio interno de cada lado. O processo pode repetir-se para mais de duas concentrações.

Sem evidência de duas concentrações, separa-se o núcleo compacto com mais pivôs (recência e menor amplitude desempatam) e **o que sobra de cada lado é reagrupado** pelo mesmo processo. Todo pivô confirmado termina em exatamente uma zona, e toda zona respeita o teto de largura. Um cluster já compacto mantém todos os membros.

Até 2026-09-25 o resto era **descartado**. Medido nas séries reais daquele dia, isso tirava de toda zona de 2 a 42 pivôs por série — 28% no BTC diário, 34% no USD diário, 41% no USDT semanal —, vários perto do preço. Um deles era o 79.490,7 que ancora a faixa manual 79.300–79.700 do BTC, que por isso saía **sem corroboração**: o monitor acusava a faixa de desalinhada tendo jogado fora a própria evidência dela. O receio que motivava o descarte, zona fraca demais, já é resolvido adiante: zona fraca não passa do score mínimo de publicação nem dos critérios do radar. Com o reagrupamento, as zonas que entraram na lista publicada tinham score mediano igual ou maior que o das que saíram, nos três repositórios. Os filtros de score, rejeições, maturidade e o limite de três zonas publicadas por lado continuam valendo.

### Limites estruturais

As bordas são os extremos dos **membros selecionados**, com folga de 0,05 vezes o menor entre o ATR médio desses pivôs e o ATR fechado atual de cada lado. Não se corta a borda de uma zona deixando seus membros fora dela.

A fusão topo/fundo continua exigindo sobreposição estrutural mínima de 50%, mas agora também verifica todos os pares de pivôs e a largura final. O ATR dos membros é conservado até essa etapa. A suavização do centro só é aproveitada se permanecer dentro da concentração de pivôs da zona recalculada.

Um ATR atual menor pode exigir novo agrupamento. Mantidos os mesmos membros, um ATR atual maior não infla a folga histórica. Fichas antigas que excedem o teto ficam dormentes durante sua carência, sem aparecer no relatório ou corroborar outras zonas. Seus registros permanecem no estado até o envelhecimento normal.

### Limites operacionais

A janela operacional usa **centro ±0,25 ATR**, até 0,5 ATR de largura total. O teto percentual específico do ativo continua limitando volatilidades extremas. O piso percentual é apenas fallback quando não há ATR válido, para não alargar a janela em períodos de baixa volatilidade.

Os episódios históricos usam o ATR de cada vela. Mantido o centro, a volatilidade de hoje não reescreve os toques passados. Quando há divisão ou mudança de agrupamento, os episódios, as rejeições, o volume e o role reversal são recalculados para cada região resultante, sem copiar o score da região antiga.

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

### Ciclo de vida da ficha de cada zona

O desenho das zonas é refeito **do zero a cada execução**, a partir de todo o histórico de preço. O que sobrevive entre execuções é a *ficha* de cada região: id, primeiro toque, contagem de toques, maturidade e situação. É a ficha que faz uma região amadurecer, e é da maturidade dela que o radar de promoção depende.

Cada ficha passa por quatro situações:

| Situação | O que significa |
| --- | --- |
| `candidata` | região nova, em observação: ainda não se provou |
| `ativa` | score alto por duas velas seguidas **e** evidência estrutural independente |
| `enfraquecida` | score caiu abaixo de 30 **ou** o preço parou de visitar (30 velas no diário, 8 no semanal) |
| `remover` | passou a carência enfraquecida (15 velas no diário, 4 no semanal) e sai do estado |

Duas correções de 2026-09-12 fecharam buracos nesse ciclo, ambos encontrados por medição e não por leitura:

**A ficha coberta agora dorme, em vez de ser rasgada.** O casamento entre fichas antigas e zonas recalculadas é um para um. Quando uma execução desenha menos zonas que a anterior — três regiões estreitas viram uma larga —, sobram fichas sem dona. A versão anterior descartava na hora as que ficavam cobertas por uma zona calculada, para não publicar a mesma região duas vezes. O efeito real foi outro: varrendo os 244, 162 e 156 commits de `estado.json` dos três monitores, **seis execuções em 18 dias apagaram de 3 a 18 zonas de uma vez, com o código parado**, e elas voltaram na execução seguinte com id novo e maturidade zerada. Num dos casos, rastreado hora a hora: 19 zonas às 20h48, 6 às 23h06, 19 de novo à 1h17 — mas as 13 que voltaram vieram em branco. Agora a ficha coberta fica **dormente**: continua no estado, para poder ser reencontrada com a história inteira, mas não é publicada nem conta como confluência semanal. A duplicata que o descarte evitava continua não existindo, e se o desenho novo veio para ficar, a ficha expira sozinha na carência do timeframe.

**`candidata` também envelhece.** Antes, essa situação só tinha uma saída: virar `ativa`. Uma região que nunca se provou também nunca era descartada — ficava no estado para sempre. Havia zona em observação **sem toque há 435 semanas** no estado do dólar, presente em todas as execuções registradas. E como `candidata` conta para a confluência semanal, que vale pontos no score das zonas diárias, regiões abandonadas anos atrás ainda ajudavam a empurrar o score que o radar usa para recomendar uma faixa manual nova. Agora `candidata` tem o mesmo envelhecimento que `ativa` sempre teve.

**Uma terceira, de 2026-09-25: a rebaixa não espera a vela seguinte.** Numa reexecução sobre a mesma vela fechada, o ciclo não anda — contadores e promoção dependem de vela nova, porque repetir a consulta não é evidência nova. A versão anterior aplicava isso a tudo, inclusive à rebaixa. Numa reexecução comum isso não fazia diferença, porque a rebaixa depende só do score e dos toques da vela, que a primeira avaliação já tinha conferido. Fazia diferença quando a ficha **mudava de conteúdo sem vela nova**: em 2026-09-24 o teto de largura dividiu zonas largas, e o pedaço que herdou o id herdou também a situação da mãe. No USD/BRL, o pedaço 5,2634–5,2841, **sem toque havia 127 velas**, seguiu `ativa` e o radar de promoção recomendou virar faixa manual uma região que o próprio ciclo de vida já devia ter enfraquecido. Quatro fichas estavam nesse estado nos três monitores. Agora a rebaixa (score abaixo de 30 ou sem toque além do limite) é conferida também na mesma vela; a contagem da carência e a promoção continuam só em vela nova. No pente fino seguinte, um teste de propriedades — séries aleatórias processadas vela a vela, conferindo o ciclo em cada passo — achou o **mesmo estado por outro caminho**: a promoção de `candidata` a `ativa` conferia score e evidência, mas não o tempo sem toque. Score alto decai devagar e pode seguir acima do corte depois do limite, e a zona virava `ativa` com 9 a 90 velas sem toque, sobretudo no semanal. Promover agora exige também região viva. Esse teste ficou em `teste-zonas.mjs`, com semente fixa.

Nenhuma das três muda o que o monitor considera suporte, resistência, rompimento ou reteste. Elas mudam por quanto tempo uma região é lembrada.

### Radar de promoção

As zonas automáticas são **contexto**. Elas não alimentam a máquina de rompimento e reteste, não entram na linha de gatilhos e não geram alerta de entrada em faixa: isso tudo roda só sobre os níveis manuais. Promover uma região a faixa manual acrescenta uma referência às regras de faixas, mas não cria uma máquina de rompimento/reteste para essa região: o ciclo persistente acompanha somente os preços pontuais de suporte e resistência. E zonas **expiram** depois de semanas sem toque, enquanto faixas manuais não — o ciclo inteiro está na seção acima.

`zonas_candidatas_a_faixa` existe para essa promoção não depender de alguém reparar nela. Lista regiões com **score 70 ou mais, pelo menos 5 toques e situação `ativa`** que nenhuma faixa manual cobre, no máximo três, das de maior score para as menores, dizendo de que lado do preço cada uma está.

**O radar lê o conjunto inteiro de zonas vivas, não a lista publicada.** A página mostra no máximo três zonas de cada lado do preço, porque uma lista maior deixa de ser legível. Esse corte é de exibição, e durante um tempo o radar herdou ele: uma região madura e descoberta ficava invisível para a promoção só porque havia três outras mais perto do preço na frente dela. Agora o radar recebe todas as zonas vivas do par e o corte de três continua valendo só para a página.

Abrir o conjunto inteiro sozinho traria lixo junto. Medido no dia da mudança, nos cinco pares dos três repositórios: 9 candidatas, 7 delas **enfraquecidas** — uma sem toque há 147 velas. Zona enfraquecida é uma região que está *perdendo* validade, e virar faixa manual é o oposto disso, porque faixa manual não expira. Por isso o radar exige situação `ativa`: nem `enfraquecida`, nem `candidata` (que nunca se provou), nem `remover`. Com o filtro, as 9 viraram 2 — as duas de fato escondidas pelo corte de exibição.

**Só no bloco diário.** No semanal a estrutura fica num patamar diferente do diário, e um único conjunto de faixas serve aos dois timeframes: promover uma zona semanal quebraria o alinhamento diário, que é o operacional. Sinalizar lá seria uma lista enorme, permanente e sem ação possível, então o campo sai sempre como `nenhuma` no semanal.

Os três cortes filtram exatamente o que não serve. Zonas de 1 toque e score baixo aparecem acima do preço em quase todo par e não significam nada ainda; zona de score alto com 2 toques também não, porque o radar exige as três coisas juntas — score, toques e situação `ativa`. Quando o campo trouxer algo, é manutenção de configuração, não alerta de mercado: a região merece virar faixa manual para permanecer como referência até revisão explícita. Essa promoção não cria uma máquina de rompimento/reteste: o ciclo persistente acompanha apenas os preços pontuais configurados como suporte e resistência.

Na página, a linha só ocupa espaço quando há candidata.

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

`confluencia_faixa_manual` cobre as faixas de `NIVEIS_USD.faixas`. Como faixa é região e não linha, o critério é interseção entre a faixa e os limites operacionais da zona.

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
- `ema89Semanal`: travessias semanais pendentes, confirmadas ou canceladas da EMA89, por par;
- `ultimaVelaProcessada`: última vela fechada processada por par e timeframe; permite retomar níveis sem registro e rejeitar respostas anteriores;
- `zonas`: coleção completa de zonas vivas por timeframe, inclusive zonas que podem não estar entre as publicadas no relatório;
- `contadoresZona`: contadores usados para preservar a identidade das zonas;
- `historicoAssinaturas`: a assinatura da última condição registrada por par e timeframe. É o que faz a execução seguinte, sobre a mesma vela fechada, não repetir linha em `historico.jsonl`.

O arquivo não substitui `relatorio.json` como interface de consumo. Sua principal finalidade é impedir que o monitor esqueça ciclos de níveis, IDs de zonas, históricos e contadores entre uma execução e outra.

## Arquivos gerados

Ao executar `node monitor.mjs`, o monitor cria ou atualiza:

```text
docs/
├── .nojekyll
├── estado.json
├── historico.jsonl
├── index.html
├── index.txt
└── relatorio.json
```

`historico.jsonl` é o único que **cresce por acréscimo**: os outros cinco são reescritos inteiros a cada execução, e nele o monitor só acrescenta linhas.

### A página publicada (`index.html`)

A página serve a dois leitores ao mesmo tempo, com prioridades opostas.

**Tema.** Segue o **`prefers-color-scheme` do sistema**: quem usa tema escuro no SO ou no navegador abre em *night mode* — fundo azul-noite, azul nos títulos e nas etiquetas —, quem usa claro abre no tema claro, com fundo quase branco e texto quase preto. O botão no topo alterna, e a partir daí a escolha fica salva no navegador e passa a mandar sobre o sistema. Quem nunca clicou continua seguindo o SO até enquanto a página está aberta: trocar o tema do sistema muda a página na hora.

Não há regra por **horário**, de propósito. Quem quer tema escuro à noite já liga o agendamento automático do próprio sistema, e o `prefers-color-scheme` entrega isso de graça. Uma regra própria brigaria com quem escolheu claro deliberadamente, e faria a página mudar de cara sozinha conforme a hora de abrir — o que se lê como defeito, não como recurso. O tema claro **só redefine tokens de cor**: nenhuma regra de layout existe duas vezes, então os dois não têm como divergir de estrutura. Há um teste que compara os dois conjuntos de tokens e falha se alguém acrescentar uma cor no escuro e esquecer do claro — senão o tema claro herdaria uma cor de fundo escuro em silêncio.

Para **você**: um cartão do **USDT/BRL** com o resumo dos dois timeframes — último fechamento, lado e distância da EMA89 **em porcentagem**, RSI e ADX com DI+/DI− (ambos rotulados com os períodos daquele timeframe), estrutura, situação dos níveis manuais —, mais os alertas técnicos como etiquetas.

**O ATR não aparece no cartão**, e a distância da EMA89 sai em porcentagem em vez de em múltiplos de ATR. Isso é só apresentação, e a razão é que ATR é unidade de **cálculo**, não leitura de relance: `0,0418` é muito ou pouco dependendo do par, enquanto `0,56%` se lê na hora.

Internamente nada mudou. O ATR continua dimensionando a largura das zonas automáticas, medindo a obsolescência dos níveis manuais e servindo de unidade para as margens do prompt — 0,25 ATR para a travessia semanal, 1,0 ATR para a corroboração da perda diária. E o relatório continua publicando `atr14`, `atr14_pct` e `distancia_ema89_fechada_atr` para quem dimensiona stop e tamanho de posição.

A porcentagem da EMA89 é calculada direto pela relação entre o **fechamento** e a EMA89, não convertida do múltiplo de ATR. O denominador é a própria EMA, mesma convenção do `distancia_ema89_pct` — só que com o fechamento no lugar do preço vivo, para o cartão não voltar a misturar vela fechada com vela em formação. O que está em `deterioracao_tendencia` sai em vermelho; o resto, em azul. O carimbo de tempo no topo calcula sozinho, no navegador, há quanto tempo o relatório foi gerado, e muda de cor a partir de 90 minutos.

Para o **agente**: o relatório inteiro continua saindo *verbatim* dentro de um único `<pre>`, em texto puro, com o mesmo escape de sempre (`&` e `<`, nada mais). O prompt usa esta página como fallback quando o `relatorio.json` não responde, e quem lê procura linhas `campo: valor` no fonte — uma única `<span>` ali dentro quebraria isso, e quebraria justamente quando a fonte principal já estivesse fora do ar. Por isso o tema é moldura em volta do bloco, nunca dentro dele, e há um teste de fumaça que compara o `<pre>` byte a byte com o relatório e falha se aparecer qualquer tag lá.

Os cartões **não** reparseiam o texto: eles leem o mesmo objeto de `relatorioParaJSON` que vira o `relatorio.json`, gerado uma vez só e passado para os dois. Dois leitores do mesmo objeto não têm como discordar.

O USD/BRL não tem cartão: ele fica só no relatório completo, logo abaixo do USDT/BRL. Não é descarte — a análise técnica dele sai inteira, com os mesmos campos de sempre. É que o painel de cima existe para o que se olha rápido, e o que se olha rápido aqui é o par de execução. Tirar o cartão é uma linha na configuração do par (`semCartao: true`), como o gráfico.

Só o **USDT/BRL** tem gráfico embutido, com `BINANCE:USDTBRL` — a mesma fonte primária do relatório. Vem com a **EMA89** e o **RSI** já carregados, e uma barra com **Diário** e **Semanal** logo acima dele. Trocar ali troca o intervalo do desenho **e o período do RSI junto** — 21 no diário, 14 no semanal, os mesmos que o cartão de cada timeframe publica, para o desenho nunca contradizer o número ao lado. Os períodos são **derivados da configuração**: mudar `tf.rsi.length` move o desenho junto, sem ninguém precisar lembrar de vir aqui. A EMA89 é a mesma nos dois intervalos, porque não é um valor por timeframe.

Esses botões são **nossos**, e não os da barra do TradingView. O widget público roda num iframe de outra origem e não avisa quando alguém troca o intervalo por dentro dele: trocar por lá muda as velas e deixa o RSI como estava. Acompanhar a troca feita na barra do próprio widget exigiria a Charting Library licenciada, que é outro produto — por isso o controle fica do lado de fora, onde dá para redesenhar o widget inteiro com o período certo. Um clique em qualquer uma das barras move todos os gráficos da página, que assim nunca ficam mostrando intervalos diferentes. A EMA é a mesma linha que o cartão cita, e o RSI vai sem a média móvel que o TradingView inclui por padrão nele, que só polui. O ADX/DMI fica de fora de propósito: junto com o RSI o embed fica carregado, e o padrão dele já serve quando se adiciona na hora, pelo próprio widget. Ele é desenhado pelo TradingView e redesenhado quando o tema muda, porque mora num iframe e o tema dele é escolhido na criação do widget, não por CSS.

O **USD/BRL não tem gráfico**, de propósito. Em todos os outros pares do projeto o desenho vem da mesma origem do número — Kraken nos monitores de cripto, Binance no USDT/BRL. Aqui não daria: o TradingView não serve a série do Yahoo Finance, e as fontes que ele usa para USD/BRL foram sondadas e reprovadas (FX_IDC é licenciado, OANDA e SAXO pedem conta na corretora, FXCM desativou a API, TVC é composição interna). Um gráfico de uma fonte ao lado de um número de outra convida a comparar duas coisas que não são a mesma, e a diferença apareceria justamente nos detalhes que importam — o fechamento e os extremos da vela. Preencher `grafico` na configuração do par volta a ligá-lo, se um dia houver fonte que bata.

Também pode ser criado `alerta.txt` na raiz quando surgem novos gatilhos internos. O workflow oficial, entretanto, faz `git add docs`, portanto esse arquivo não é publicado pelo processo automático atual.

## Estrutura simplificada do repositório

Considerando a estrutura atual e os dois arquivos de documentação deste pacote:

```text
Monitor-USD-Price/
├── .github/
│   └── workflows/
│       ├── monitor.yml
│       └── paridade.yml
├── docs/
│   ├── .nojekyll
│   ├── estado.json
│   ├── historico.jsonl
│   ├── index.html
│   ├── index.txt
│   └── relatorio.json
├── monitor.mjs
├── ema89-semanal.mjs
├── analisar-historico.mjs
├── paridade.mjs
├── paridade-esperada.mjs
├── teste-fumaca.mjs
├── teste-regressoes.mjs
├── teste-ema89-semanal.mjs
├── teste-paridade.mjs
├── teste-niveis.mjs
├── teste-limiares.mjs
├── teste-retrato.mjs
├── teste-retrato-cassete.json
├── teste-retrato.txt
├── README.md
└── PROMPT_USD_TECHNICAL_WATCH.md
```

## Contexto: as duas linhas para quem não é trader

O relatório tem mais de cem campos por bloco. Quase todos são refinamento, e refinamento serve para quem opera com frequência. Quem acumula ao longo do tempo e às vezes gasta precisa responder uma pergunta só: **é um momento melhor para comprar mais, para esperar ou para converter parte?**

A seção **Contexto**, no topo da página antes dos cartões, responde isso em **duas linhas por par**, dentro de uma caixa só: `longo` diz onde o preço está, `curto` diz o que aconteceu. Foram duas seções separadas até 2026-09-12, e as notas explicativas respondiam por **73% do texto do topo** (684 caracteres de nota contra 209 de leitura). Juntas, some um título e uma nota inteira, o topo cai de 933 para 545 caracteres, e as duas leituras passam a ser lidas lado a lado, que é como se completam. A explicação longa mora aqui no README, que é o lugar dela. Ela usa **doze campos, todos do bloco semanal**: o fechamento, a EMA89, a distância entre os dois em ATR, o RSI, a estrutura, DI+, DI− e ADX, e a situação, a distância, a faixa mais próxima e o alinhamento dos níveis manuais.

A ordem da linha segue a **lista de prioridade de leitura do prompt**: níveis primeiro, média longa depois, indicadores por último. RSI e DMI ficam os dois, porque dizem coisas diferentes: o RSI mede o quanto o preço se esticou, o DMI mede se o movimento tem força. Medidos em série sintética, a correlação entre os dois fica em torno de 0,34 em regime de tendência e cai para praticamente zero em lateralização, ou seja, cerca de nove décimos do que cada um diz o outro não diz.

| Rótulo | Quando aparece |
| --- | --- |
| barato ante a média longa | 1 ATR ou mais **abaixo** da EMA89 semanal, sem queda instalada |
| barato, mas ainda caindo | o mesmo, porém com estrutura semanal em `baixa` **ou** DI− dominante com ADX em 25 ou mais |
| esticado, mas a alta ainda tem força | 1 ATR ou mais **acima**, RSI em 70 ou mais, com DI+ dominante e ADX em 25 ou mais |
| esticado e a alta perdendo força | o mesmo, porém sem essa força |
| acima da média, sem esticamento | longe acima, mas o RSI não acompanha |
| na média longa | a menos de 1 ATR da EMA89, para qualquer lado |

Nenhuma regra nova de mercado nasce aí. O corte de 1 ATR é o mesmo que o monitor usa para separar perto de longe na obsolescência dos níveis, 70 é a referência de RSI que o prompt usa em todo lugar, e 25 é o mesmo corte de força de ADX que a linha de eventos já usava.

**O DMI entrou porque o RSI sozinho juntava situações opostas.** RSI alto diz que subiu bastante nas últimas semanas. Não diz se a alta continua viva. Subiu muito com a compra ainda mandando e subiu muito com o movimento morrendo pedem ações contrárias, e até 2026-09-11 as duas saíam com o mesmo rótulo. Quem separa é o ADX com os DIs, não o RSI. Do lado barato vale o espelho, com uma vantagem: o DMI denuncia a queda viva **antes** da estrutura, que depende de pivôs confirmados e por isso é lenta. Qualquer um dos dois basta para marcar `ainda caindo`.

Abaixo do corte de 25 a razão diz `sem tendência firme` e não nomeia direção. ADX fraco significa que não há tendência instalada, e escrever "alta perdendo força" com ADX em 14 seria inventar uma alta que não existe.

Barato e caindo saem com rótulos diferentes de propósito: juntar os dois seria mentira. E uma alta longe da média sem RSI esticado não vira alarme, porque alta saudável é o estado normal de uma tendência.

**A linha mostra os números que a produziram, e nenhum deles em jargão.** Essa é a única parte da página escrita para quem não sabe análise técnica, e um número numa unidade que a pessoa não entende não deixa nada conferível, que era a razão de a linha existir. Então:

- a linha começa pelos **níveis**, que são a prioridade 1 da lista do prompt. A faixa nascia apoiada na média longa (prioridade 3) e nos indicadores (prioridade 5), pulando o item mais importante. Sai como `dentro da faixa manual de 76.000 a 78.000`, `dentro da região de suporte manual de …`, `encostando na`, `perto da` ou `longe das faixas manuais`. **A frase nomeia os limites da faixa**, porque sem isso ela afirmava algo sobre "uma faixa" e obrigava quem lê a procurar o rótulo no cartão, e ainda a lembrar que esta leitura sai do bloco **semanal**, não do diário. Longe de todas, nomear uma não ajudaria, então ali o intervalo não aparece. As casas decimais se ajustam ao par: 76.000 sai inteiro, 0,00656 sai com cinco casas, 5,12 com duas;
- uma faixa que as zonas observadas não corroboram é citada **com a ressalva** `(sem corroboração das zonas automáticas semanais atuais)`. Dar destaque a um nível desalinhado sem avisar seria pior que omiti-lo. A ressalva dizia `(que o mercado não vem respeitando)`, e foi trocada por ser mais forte do que o código mede: `alinhamentoNiveis` só compara as faixas com as zonas automáticas daquele timeframe pelo corte de sobreposição, então `desalinhado` quer dizer que as zonas atuais não corroboram a faixa — não que o mercado deixou de respeitá-la. Uma faixa pode ter sido muito respeitada e simplesmente não ter zona viva em cima dela agora. O adjetivo do timeframe entra por parâmetro, e sem ele a frase sai neutra, `(sem corroboração das zonas automáticas atuais neste timeframe)`: hoje a função só é chamada da leitura longa, que lê o bloco semanal, mas ela própria não sabe de que timeframe vieram os números, e cravar "semanais" faria a frase mentir em silêncio no dia em que a leitura curta a usasse;
- a distância sai em **porcentagem**, que dispensa explicação, e não em ATR;
- o critério de 1 ATR vira **palavra**: `bem acima` e `bem abaixo` contra `perto`. A palavra carrega o critério, o número carrega o tamanho;
- o RSI vira `momentum esticado`, `normal` ou `muito fraco`, sem o número;
- o DMI vira `alta ainda forte`, `queda ainda forte` ou `sem tendência firme`;
- a estrutura sai da linha. Quando ela muda o veredito, isso já aparece no próprio rótulo.

O ATR continua sendo o que **decide**, e continua inteiro no relatório abaixo, para o agente e para quem consome os campos. Ele só não aparece aqui.

Um efeito colateral que confunde à primeira vista: `bem abaixo (−2,9%)` no dólar e `bem acima (+54,2%)` no Monero podem aparecer lado a lado. Está certo. Perto e longe são medidos contra o quanto **cada par** costuma oscilar, então 3% já é bastante no câmbio e é pouco numa cripto. A nota ao pé da faixa diz isso em uma linha.

Ela **descreve enquadramento, não recomenda operação e não gera alerta**. É contexto que muda de estado poucas vezes por ano, e é essa lentidão que a torna útil para horizonte longo.

### Um par por vez

Nos monitores com **mais de um par com cartão**, um seletor no topo mostra um par de cada vez, filtrando a caixa de contexto **e** o cartão ao mesmo tempo. A página inteira passa a falar de um par só, e a altura cai pela metade no monitor de XMR, que é o único onde isso aparece: os outros dois têm um par com cartão e o seletor nem é gerado, porque um botão que não faz nada é pior que nenhum botão.

Três cuidados que valem conhecer:

- **o relatório completo não é filtrado.** Ele é o fallback do prompt e sai sempre inteiro, com todos os pares. O seletor mexe só no resumo visual;
- **sem JavaScript nada fica escondido.** A classe que oculta só é aplicada pelo script, então a página servida traz tudo e continua completa se o script não rodar;
- **o gráfico é redesenhado a cada troca, e só o do par visível.** O widget do TradingView calcula o tamanho na criação, e um container escondido sairia com dimensão zero e ficaria quebrado ao aparecer. Recriar com ele já visível resolve. A carga não redesenha: quem desenha é o tema, uma vez só. Antes disso, a página de dois pares criava **quatro** iframes do TradingView por carga para exibir um gráfico — o seletor desenhava e o tema desenhava de novo, cada rodada passando também pelo cartão escondido.

Dentro de cada caixa, uma linha separa a leitura `longo` da `curto`. São duas leituras de escalas diferentes e a divisória deixa isso óbvio sem precisar de mais texto.

### O `(?)` ao lado de cada rótulo

O rótulo é curto por obrigação de layout: `esticado e a alta perdendo força` já é o limite do que cabe numa linha, e a explicação inteira não caberia em nenhuma. O `(?)` ao lado resolve isso sem custo de espaço — passando o mouse no computador, tocando no celular, ou com o foco do teclado. Quem já sabe o que o rótulo quer dizer nunca precisa abrir.

O texto vem do mapa `EXPLICACOES`, e a chave sai da **própria leitura**, não do texto do rótulo: casar por texto faria a explicação sumir em silêncio no dia em que alguém reescrevesse um rótulo. O teste de fumaça cobre os dois lados — toda chave que as leituras sabem produzir tem explicação, e nenhuma explicação fica órfã — e também que **nenhuma delas usa jargão**, a mesma regra que já vale para a razão de cada linha.

É markup só da parte visual: o relatório completo, que é o que o agente lê, sai idêntico.

### A linha `curto`: o que aconteceu no diário

A linha `longo` diz **onde** o preço está. A linha `curto`, logo abaixo dela na mesma caixa, diz o que está **acontecendo** no timeframe que o projeto usa para timing.

O diário não é day trade. Os períodos dele são todos calibrados para o horizonte tático de 1 a 6 semanas: RSI 21, DMI 28/42, pivôs 5/5 e janela de reteste de 30 velas. Nada aqui usa a vela em formação.

O núcleo é a **máquina de rompimento e reteste**, que roda só sobre os níveis manuais e é a prioridade 2 da lista de leitura do prompt. É a sequência que mais importa para decidir uma entrada: rompeu, voltou, segurou.

| Rótulo | Quando aparece |
| --- | --- |
| reteste confirmado | algum nível manual em `reteste_confirmado` |
| reteste em curso | em `em_reteste` |
| rompimento falhou | em `rompimento_falhou` |
| nível recuperado | em `recuperado` |
| nível rompido | em `rompido`; um reteste ou recuperação na vela tem prioridade na leitura |
| rompimento em avaliação | em `rompimento_candidato` |
| cruzou a média diária | sem evento de nível, mas a EMA89 diária foi cruzada no fechamento |
| sinais de enfraquecimento | sem os anteriores, mas `deterioracao_tendencia` traz algo |
| sem evento no diário | nada disso |

A ordem da tabela é a ordem de relevância: com dois níveis em estados diferentes, vence o mais decisivo, não o primeiro da configuração. A razão diz de qual nível se trata, se é resistência ou suporte, e onde o fechamento está em relação à média diária, em porcentagem.

**O destaque em amarelo quer dizer "vale olhar", não quer dizer bom nem ruim.** Um reteste confirmado de resistência rompida para cima e um de suporte perdido para baixo têm o mesmo nome e significados opostos. Inventar a direção aqui seria palpite disfarçado de leitura, então a cor sinaliza atenção e o texto nomeia o nível, deixando o julgamento com quem lê.

Sem jargão, pela mesma razão da faixa longa. E quando o fechamento fica a menos de 0,05% da média, a razão diz `em cima da média diária` em vez de arredondar para `0,0% abaixo`, que afirmaria um lado que o número não sustenta.

## Histórico: o substrato para medir

Nenhum parâmetro deste projeto foi validado contra resultado. Os períodos, os limiares, os pesos do score das zonas: tudo foi escolhido por raciocínio, e raciocínio bem argumentado continua sendo palpite até alguém medir. `docs/historico.jsonl` existe para que um dia seja possível medir.

É um arquivo **append-only**, uma linha JSON por entrada, versionado junto com o resto. Ele não altera o relatório, não dispara nada e não é lido por nenhuma decisão do monitor.

**Por que registra condição, e não alerta.** Os alertas não saem daqui. Quem decide alertar é o agente no ChatGPT, que lê o prompt e resolve sozinho, e o monitor não tem como ver essa decisão. O histórico guarda as condições publicadas e os fechamentos; a análise usa apenas condições calculadas integralmente com velas fechadas.

Grava uma linha por par e timeframe sempre que a **vela fechada** muda ou qualquer condição muda. Execuções horárias sobre a mesma vela fechada não repetem linha, porque a assinatura que decide isso ignora o horário. Como a vela entra na assinatura, todo fechamento gera linha mesmo sem condição nenhuma, e é dessa série de preços que saem os retornos futuros. Bloco em falha não vira entrada: registrar uma queda de fonte como se fosse leitura de mercado contaminaria a medição depois.

Cada linha traz a vela, o fechamento, o ATR, RSI, ADX com DI+/DI−, estrutura, lado e cruzamento da EMA89, os alertas técnicos, deterioração, confluências, riscos, mudanças de nível e a situação e o alinhamento das faixas manuais.

### Como medir

```bash
node analisar-historico.mjs 10
```

O argumento é um inteiro positivo: o horizonte em fechamentos disponíveis no histórico. O script mede condições de velas fechadas a partir do fechamento correspondente e imprime, por condição, a quantidade de amostras, o retorno mediano **em ATR** e a fração de vezes em que subiu. Lacunas de coleta não são preenchidas. Em ATR, e não em porcentagem, pelo mesmo motivo do resto do projeto: 3% é muito num par de câmbio e pouco num de cripto, e uma tabela que mistura os dois não quer dizer nada.

**Condições intradiárias ficam fora da medição.** Faixas de preço, toques e rompimentos intradiários, condições mistas como `pullback_com_volume_decrescente` e nomes desconhecidos são excluídos e contabilizados separadamente na saída. O arquivo permanece intacto, mas não guarda o preço observado necessário para calcular o retorno dessas condições: usar o fechamento anterior atribuiria a elas movimentos que já haviam ocorrido. Condições novas só entram na análise depois de validar sua origem em velas fechadas. Esta é uma análise descritiva de fechamentos, não o retorno de uma entrada executada após a publicação do alerta.

A linha `TODAS AS VELAS (referência)` é o que o par fez em toda vela do período. **É contra ela que se compara, não contra zero.** Uma condição que não bate a referência não está acrescentando informação, por melhor que pareça o número absoluto. Condições com menos de cinco amostras são omitidas.

Vale rodar em mais de um horizonte. Uma condição útil deveria continuar útil em 5 e em 20 velas; uma que só funciona num horizonte específico é ruído que encontrou um número.

**Não espere resposta nos primeiros meses.** Detectar uma vantagem pequena contra a volatilidade diária exige muitas amostras, e o script prefere dizer que não sabe a inventar conclusão com uma dúzia de casos.

### O que o histórico não alcança

Ele não sabe o que o agente escolheu enviar. Se você quiser medir isso também, o prompt pede que cada alerta termine numa linha compacta de registro; basta colar essas linhas em `alertas-enviados.jsonl` na raiz. Sem isso, dá para saber quais condições têm valor, mas não se o agente está encaminhando as certas.

O rodapé carrega o horizonte, e aceita quatro valores: `TÁTICO`, `ESTRATÉGICO`, `AMBOS` e `MANUTENÇÃO`. O último é obrigatório para revisão de níveis e radar de promoção, e existe por dois motivos. Aviso de configuração marcado como tático ocuparia a vaga tática da execução, podendo suprimir um sinal de mercado real no mesmo ciclo. E contaminaria a medição depois, misturando manutenção com chamada de mercado na mesma coluna.

## Teste de fumaça

Os três monitores da família têm um `teste-fumaca.mjs`, que roda o monitor inteiro contra séries sintéticas **sem tocar na rede**. O deste é o mais extenso porque aqui a fonte de dados é a mais nova e tem cascata em dois níveis, e um erro de parse só apareceria em produção.

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
- que a ancoragem de fuso não joga uma vela para o dia seguinte;
- que RSI, ADX e EMA89 usam o período de cada timeframe, e que o relatório declara qual usou;
- que os **seis** valores de estrutura têm nomes distintos, e que os eventos de pivô não prometem o que não aconteceu;
- que `afastado` mede distância e não etapa do ciclo, e que um rompimento vira notícia **uma vez só**;
- que o relatório avisa quando a faixa manual sai de onde o mercado reage, e que o radar só aponta região madura, viva e descoberta;
- que a ficha de uma zona coberta dorme em vez de ser rasgada, e que zona em observação envelhece;
- que as leituras `longo` e `curto` saem sem jargão, e que todo rótulo tem explicação no `(?)`;
- que o histórico grava uma linha por vela fechada e não repete na mesma vela.

Rode com:

```bash
node teste-fumaca.mjs
```

Ele encadeia mais **sete** arquivos no final: `teste-regressoes.mjs`, `teste-ema89-semanal.mjs`, `teste-paridade.mjs`, `teste-niveis.mjs`, `teste-limiares.mjs`, `teste-estrutura-visual.mjs` e `teste-retrato.mjs`. Rodar o de fumaça roda os oito.

### Paridade entre os três monitores

`paridade.mjs` confere que os três continuam com o mesmo motor. Compara arquivo inteiro para os que devem ser idênticos em todos, e **símbolo a símbolo** no `monitor.mjs` — sobre a **união** dos símbolos dos dois lados, conferindo presença e conteúdo separadamente (a seção seguinte explica). Pega o código dos outros dois do diretório irmão, quando os três estão clonados lado a lado, e do GitHub quando não estão.

O recorte em símbolos já teve **três** furos:

1. a expressão que reconhece uma declaração não aceitava `export async function` — e a única função assim é `build()`, a que monta o relatório inteiro;
2. a contagem de chaves contava também o que está dentro de string e de template, então `const PAGINA_CSS = ` fechava na primeira linha e as 142 linhas de CSS ficavam de fora;
3. a barra de uma expressão regular não era reconhecida. Em `.replace(/'/g, "&#39;")` a aspa **dentro** da regex era lida como início de string, o resto da linha virava texto junto com o parêntese de fechamento, e a profundidade nunca voltava a zero. Medido: `pgEsc` ocupava 596 linhas e engolia **23 símbolos** — `toHTML`, `leituraLonga`, `leituraCurta`, `EXPLICACOES` e o bloco de execução direta entre eles.

Os dois primeiros foram achados por mutação; o terceiro apareceu quando um cenário de teste desta mesma conferência acusou uma divergência em `pgEsc` que não fazia sentido. Hoje **todas** as linhas do `monitor.mjs` entram, e cada declaração de topo vira o seu próprio símbolo: 155 contra os 132 de antes. Os imports e o bloco de execução direta vão para um pseudo-símbolo `<topo>`.

O reconhecimento da barra distingue divisão de expressão regular pelo que vem **antes** dela: depois de nome, `)` ou `]` ela divide; depois de pontuação ou de palavra-chave (`return`, `typeof`, `case`…) ela abre uma expressão. Não há nenhum `return /…/` no código de hoje — o caso está coberto por teste justamente porque, quando aparecer, tem de continuar funcionando.

### Presença e conteúdo são duas perguntas diferentes

Os três furos acima eram do recorte. Havia um quarto, na comparação em si, e pior que todos: ela rodava sobre a **interseção** dos símbolos dos dois arquivos. Uma função que sumisse de um repositório simplesmente saía da conta, e a paridade continuava aprovando. Apagando `atualizarEstadoNivel` de uma cópia do BTC, o verificador terminava com código `0`.

A conferência agora roda sobre a **união** e faz duas perguntas separadas para cada símbolo:

- **Onde ele deve existir?** O padrão é **nos três**. As exceções estão nomeadas uma a uma em `PRESENCA_ESPERADA`, com a lista de monitores onde cada uma deve existir — `urlKraken` e `parseKraken` em BTC e XMR, `NIVEIS_BTC` só no XMR, as fontes do câmbio e o trilho de execução só no USD. Não existe regra automática do tipo "função exclusiva deve ser configuração": era exatamente essa suposição que deixava uma remoção passar por configuração nova.
- **O corpo pode diferir?** Isso é `CONTEUDO_ACEITO`, com a chave sendo o par de repositórios. Estar nessa lista **não** autoriza a função a faltar: `PAIRS` tem conteúdo diferente nos três e continua obrigatório nos três. `build` pode divergir contra o USD, que lê de outras fontes, e tem de ser idêntica entre BTC e XMR.

Falta onde é previsto, ou existe onde não é: reprova, com mensagem dizendo o símbolo, onde ele está e onde deveria estar. Remoção, adição e renomeação de função compartilhada caem todas aí.

A união inclui **o que o registro menciona**, mesmo que o símbolo não exista em nenhum dos dois arquivos. Sem isso sobrava um buraco da mesma família: a função prevista para **um** repositório só, apagada justamente dele, sumia da união e não faltava em lugar nenhum — apagando `calcularTrilho` do USD, registrada como só-USD, os três lados aprovavam com código `0`. Eram 24 símbolos nessa situação. Pelo mesmo caminho, um nome inventado em qualquer das duas listas passa a reprovar em vez de ser ignorado: lista de exceções que aceita nome que não existe não vale como registro.

O próprio registro também é conferido antes da comparação — nome de monitor com erro de digitação vira código `2`, nunca aprovação.

`teste-paridade.mjs` prende as duas metades. A primeira confere o recorte; a segunda **monta três repositórios num diretório temporário e executa o `paridade.mjs` de verdade** como processo separado, estragando um de cada vez: apagar uma função de um projeto, acrescentar uma não prevista, renomear uma compartilhada, apagar uma de conteúdo liberado, mexer dentro de `build`, deixar a comparação incompleta. Cada cenário roda a partir de mais de um repositório, porque uma remoção tem de reprovar tanto de quem perdeu a função quanto de quem ainda a tem. Quando os três estão clonados lado a lado, os projetos reais entram como mais um cenário; quando não estão, o teste diz em voz alta que pulou — pular não é passar.

Ao automatizar isso, apareceu que "só a configuração muda" nunca foi literalmente verdade. As duas listas de exceção moram em `paridade-esperada.mjs`, cada entrada com o motivo, e a conferência reprova o que estiver **fora** delas — que é o caso de alguém corrigir um bug num repositório só.

Uma delas merece atenção e está registrada lá: o código da **resistência macro existe apenas no XMR**. Nos outros dois, preencher `resistenciaMacro` na configuração não faz nada, porque o código que leria esse campo não está presente.

Roda como workflow próprio, uma vez por dia, e **não** junto da publicação: durante uma publicação em série existe uma janela de minutos em que os três legitimamente diferem, e uma divergência passageira não pode impedir o relatório de sair. Três códigos de saída: `0` em paridade, `1` divergência, `2` não deu para verificar — que não é aprovação. O workflow devolve o código do verificador como está: **só o `0` deixa o job verde**.

O código dos outros dois vem do diretório irmão quando os três estão clonados lado a lado, e do GitHub quando não estão. `PARIDADE_SEM_REDE=1` desliga a busca no GitHub — é o que o teste usa, para medir as cópias que ele acabou de montar em vez do que está publicado.

```bash
node paridade.mjs
```

### Teste de retrato

`teste-retrato.mjs` cobre o que o de fumaça não cobre. O de fumaça verifica propriedades que alguém lembrou de verificar; o retrato gera o **relatório inteiro** sobre uma entrada fixa e compara linha a linha com `teste-retrato.txt`. Campo que muda de valor, de nome, de ordem ou que some sem ninguém ter pedido quebra o teste.

A entrada não vem do gerador aleatório do harness, e sim de um **cassete**: as respostas das fontes foram gravadas uma vez em `teste-retrato-cassete.json`. Assim o retrato não se mexe quando alguém ajusta a semente ou o formato das séries sintéticas — só quando o relatório muda de verdade. O relógio também é fixo, senão `timestamp` e a fração do período fariam o retrato quebrar sozinho a cada execução.

São **duas execuções**: a primeira parte de estado vazio, a segunda recebe o estado da primeira. É a segunda que exercita o casamento das zonas, o ciclo de vida e a máquina de níveis — onde bug já apareceu mais de uma vez neste projeto.

A página HTML fica de fora de propósito. Ela é quase toda CSS, e qualquer ajuste de cor quebraria o retrato sem que o relatório tivesse mudado.

Quando a mudança for intencional:

```bash
node teste-retrato.mjs --atualizar
```

e o diff do retrato entra no mesmo commit. Esse diff é a revisão mais honesta que existe aqui, porque mostra tudo que mudou.

**O que ele não alcança:** só cobre os caminhos que a entrada fixa exercita. Numa prova de mutação, ele pegou mudanças nos pesos do score, no período do RSI e nos limites de uma faixa manual, mas **não** pegou uma alteração na tolerância de reteste — porque naquele cassete nenhum nível está em reteste. Retrato não substitui teste de caso; essa lacuna é coberta por `teste-niveis.mjs` e `teste-limiares.mjs`, abaixo.

### A máquina de níveis e os números que decidem

Uma prova de mutação sobre as constantes numéricas do `monitor.mjs` — mudar cada uma em 50% e ver se algum teste reclama — encontrou **26 das 40 passando sem ninguém notar**. Entre elas a tolerância do reteste, a distância de reset, a escala dos pivôs, o piso das divergências e os limiares de score das zonas: exatamente os números que decidem o que o relatório afirma.

Constante que pode mudar sozinha sem quebrar teste nenhum não é calibragem, é acidente esperando acontecer. Três arquivos fecham isso:

- **`teste-niveis.mjs`** dirige a máquina de rompimento e reteste vela a vela: candidato, rompido, em reteste, reteste confirmado, rompimento falhou, recuperado, arquivado e o reencontro depois do abandono. Também prende as regras que não são números — uma transição por vela fechada, vela atrasada não anda com o ciclo, o histórico não cresce para sempre.
- **`teste-limiares.mjs`** escolhe entradas dos **dois lados de cada borda**: 0,20 ATR está dentro da tolerância do reteste e 0,30 está fora; 40% de sobreposição casa duas zonas e 25% não; um corpo de 60% do range é vela compradora forte e um de 50% não é. Uma afirmação de cada lado, para o teste morrer se o número se mexer. O reteste é testado pelo caminho de verdade, passando por `readPair` — é lá que as constantes em ATR viram preço, e era por isso que testar só a máquina não as alcançava.
- O bloco **calibragem deste par**, dentro do próprio `teste-fumaca.mjs`, prende os cinco números que legitimamente **mudam** de um monitor para o outro. Eles não cabem nos dois arquivos acima, que são idênticos nos três repositórios.

Depois disso, das 44 constantes numéricas deste repositório sobrevive **uma**: `ZONA_SCORE_MIN_PUBLICAR`, o score mínimo para uma zona automática aparecer na lista de contexto. Nos outros dois o cassete do retrato tem uma zona nessa faixa de score e o teste a pega; no cassete daqui não há nenhuma. É a constante de menor consequência do conjunto — decide se uma zona fraca aparece ou não numa lista de contexto — e fica registrada aqui em vez de ser coberta por um teste forçado.

O workflow roda esse teste **antes** de gerar o relatório: se um refactor quebrou o parse de alguma das fontes, o job para ali em vez de publicar um relatório pela metade.

## GitHub Actions

O workflow oficial está em `.github/workflows/monitor.yml`.

### Frequência

O cron atual é:

```yaml
- cron: "40 * * * *"
```

Ou seja, o GitHub Actions solicita uma execução **uma vez por hora, no minuto 40 UTC**. Os três monitores da família são espaçados em 20 minutos — **XMR no 00, BTC no 20, USD no 40** — para as chamadas às fontes ficarem distribuídas e dar para saber qual execução é qual só pelo horário no log. Como todo cron do GitHub Actions, o início efetivo pode sofrer atraso de fila da própria plataforma.

O workflow também possui `workflow_dispatch`, permitindo execução manual pela aba **Actions**.

### Node.js usado oficialmente

O workflow atual usa:

```yaml
- uses: actions/setup-node@v7
  with:
    node-version: "22"
```

Portanto, **Node.js 22 é a versão usada pelo workflow oficial**.

Isso não significa, por si só, que Node.js 22 seja uma exigência absoluta para execução local. O próprio `monitor.mjs` não possui dependências externas e declara usar o `fetch` nativo disponível em Node 20+. Assim, a configuração oficialmente exercitada em CI é Node 22, enquanto o código atual foi escrito para não depender de pacotes npm e usa recursos compatíveis com Node moderno.

### Persistência e publicação

A cada execução, o workflow:

1. faz `git fetch origin main`;
2. faz `git reset --hard origin/main` antes de rodar o monitor;
3. roda `node teste-fumaca.mjs` sobre a revisão sincronizada, em cada tentativa;
4. executa `node monitor.mjs`;
5. adiciona a pasta `docs` ao commit;
6. cria um commit se houver mudança;
7. tenta enviar o commit para `main`;
8. em caso de conflito por outro push concorrente, repete o ciclo até cinco vezes.

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
    [5.3315, 5.341, "faixa_5_3315_5_341"],
    [5.2525, 5.2675, "faixa_5_2525_5_2675"],
    [5.168, 5.181, "faixa_5_168_5_181"],
    [5.129, 5.1395, "faixa_5_129_5_1395"],
    [5.068, 5.0805, "regiao_suporte_5_068_5_0805"],
    [5.049, 5.0545, "regiao_suporte_5_049_5_0545"],
    [4.9945, 5.0005, "regiao_suporte_4_9945_5_0005"],
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

## Consistência entre execuções e regressões

O monitor pode rodar várias vezes sobre a mesma vela fechada. As regras abaixo evitam que a frequência de execução altere a leitura:

- A máquina de níveis processa cada fechamento uma vez. Repetir a consulta não transforma a sombra do rompimento em um reteste posterior; respostas de velas anteriores também não regridem o estado.
- `niveis_mudancas_nesta_vela` permanece disponível durante a mesma vela, inclusive após reiniciar o processo. O estado salva esses eventos em `mudancasNaVela`; consumidores deduplicam por par, timeframe, data da vela, nível e tipo de evento. Estados antigos continuam legíveis e não geram anúncios retroativos.
- Retestes e recuperações são registrados em `transicoesNaVela` antes do reset por afastamento. Assim, o evento continua no relatório e no monitor visual mesmo que o estado operacional volte a `rompido` na mesma vela. Esse reset não produz outro anúncio de rompimento.
- Contato exige que o intervalo entre mínima e máxima intercepte a faixa de tolerância do nível. Uma vela inteiramente fora dessa faixa, no lado contrário, pode caracterizar falha do rompimento, mas não renova `ultimoContato` nem acorda um registro arquivado.
- Respostas anteriores à última vela já processada geram `FALHA` naquele par/timeframe; não alimentam indicadores, gatilhos ou histórico. Níveis, zonas, contadores e EMA89 permanecem salvos para a próxima consulta válida.
- As sínteses consideram a direção do nível. Um reteste de uma perda de suporte não confirma entrada compradora; recuperar um suporte perdido não representa falha de um rompimento de alta.
- O centro das zonas é suavizado uma vez por nova vela fechada. Uma ficha de remoção é mantida até a próxima vela para impedir que um retry recrie a zona com outro ID. Distância e posição em relação ao preço atual continuam podendo variar.
- O volume da última vela fechada confirma apenas rompimentos ou perdas daquela mesma vela. Toques e rompimentos intradiários não recebem confirmação pelo volume do dia anterior.
- `analisar-historico.mjs` conta uma observação por par, timeframe, vela e condição de fechamento, incluindo a referência. Snapshots repetidos não aumentam a amostra; condições intradiárias, mistas ou desconhecidas não usam retroativamente o fechamento anterior como preço de entrada.

Execute `node teste-fumaca.mjs` para rodar a suíte existente e as regressões de `teste-regressoes.mjs`, sem rede. Para executar somente as reproduções dos defeitos, use `node teste-regressoes.mjs`. O workflow existente já roda o teste de fumaça antes de gerar o relatório.

As correções preservam períodos dos indicadores, tolerâncias e níveis manuais. O estado histórico não é reescrito: transições falsas já registradas precisam ser distinguidas das novas leituras, corrigidas pelo código.

## Travessia pendente da EMA89 semanal

A margem macro continua em **0,25 ATR**, avaliada apenas no fechamento semanal. Uma travessia com margem insuficiente fica pendente em `docs/estado.json`, no mapa `ema89Semanal`, por chave de par. Um fechamento posterior no mesmo lado com margem suficiente confirma; voltar ao lado anterior por fechamento cancela a pendência sem confirmar a direção oposta. Um novo cruzamento posterior inicia outro ciclo. Oscilações da semana em formação não alteram esse estado.

`ema89_cruzamento_fechado` mantém sua semântica de cruzamento entre duas semanas consecutivas. O novo evento `ema89_semanal_confirmacao` permite confirmar mais tarde mesmo quando o cruzamento bruto é `nenhum`. O campo `ema89_semanal_evento_id` permanece estável durante a vela de confirmação e deve ser usado pelo agente para deduplicar mensagens. O código calcula o evento; não registra que uma mensagem foi efetivamente enviada. Os demais campos `ema89_semanal_*` mostram estado, direção e datas de origem, confirmação e cancelamento. A comparação usa a margem sem arredondamento.

A memória sobrevive a reinícios, falhas de fonte e retries; respostas antigas não fazem o estado regredir. Se várias semanas novas estiverem disponíveis, elas são processadas em ordem para não perder cancelamentos intermediários. Sem continuidade histórica, a referência é reiniciada conservadoramente. Na primeira execução sem esse estado, somente a última semana fechada é avaliada, sem reconstruir alertas antigos. Uma confirmação de uma semana passada permanece como contexto, mas não vira evento novo na semana atual.

O histórico registra `ema89_confirmacao` e `ema89_evento_id`; a análise histórica conta `ema89_confirmou=acima/abaixo` na semana de confirmação, uma vez por vela. Registros antigos continuam legíveis.

`node teste-ema89-semanal.mjs` verifica as sequências e a persistência em disco. Essa suíte também roda por `node teste-fumaca.mjs`. Os prompts públicos usam os novos campos e mantêm os filtros, os pares de referência e as regras de prioridade já existentes.

### Regressões de largura das zonas

`node teste-zonas.mjs` verifica compactação, divisão com evidência, ausência de divisão artificial, limites diário/semanal, fusão, tolerância operacional, score/toques/rejeições, role reversal, migração de fichas antigas e as faixas manuais desta calibração. É executado por `teste-fumaca.mjs`.
