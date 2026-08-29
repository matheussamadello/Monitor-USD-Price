# Monitor USD Price

Monitor técnico automatizado de **USD/BRL** que coleta candles de câmbio, calcula indicadores, acompanha estrutura de mercado e publica um relatório estático em HTML, texto e JSON para consulta humana ou consumo por bots, agentes e LLMs.

É o terceiro monitor da mesma família — depois de [Monitor-BTC-Price](https://github.com/matheussamadello/Monitor-BTC-Price) e [Monitor-XMR-Price](https://github.com/matheussamadello/Monitor-XMR-Price) — e reaproveita a mesma engenharia: mesmos indicadores, mesma máquina de estados de rompimento/reteste, mesmas zonas automáticas, mesmo formato de `relatorio.json`.

O projeto foi desenhado para acompanhamento de **swing trades e operações de prazo mais longo**, com o gráfico diário como referência principal de timing e o semanal como filtro de contexto estrutural.

## Links públicos

- Repositório: https://github.com/matheussamadello/Monitor-USD-Price
- Página do monitor: https://matheussamadello.github.io/Monitor-USD-Price/
- Relatório JSON: https://matheussamadello.github.io/Monitor-USD-Price/relatorio.json
- JSON bruto no repositório: https://raw.githubusercontent.com/matheussamadello/Monitor-USD-Price/main/docs/relatorio.json

## Referência técnica: USD/BRL

Toda a análise do monitor é feita em **USD/BRL**, ou seja, **quantos reais custa um dólar**.

O ativo monitorado é o dólar; o real é a moeda de cotação. O preço sobe quando o dólar se valoriza frente ao real, e cai quando o real se fortalece. Um `rompimento_confirmado` é, portanto, dólar rompendo para cima — não o contrário.

Os preços são publicados com **4 casas decimais**. Não é preciosismo: o USD/BRL se move em milésimos, e duas casas apagariam a diferença entre um dia parado e um dia de meio por cento.

## Fonte de dados e timeframes

Câmbio não tem uma "bolsa oficial" com endpoint público equivalente ao da Kraken. Por isso o monitor usa **duas fontes de OHLC em cascata**, e vale a primeira que responder:

1. **Yahoo Finance** (`USDBRL=X`) — fonte primária. É a única das duas que devolve a **vela em formação** do dia corrente.
2. **Stooq** (`usdbrl`, CSV) — fallback. É fim de dia: quando ele assume, a "vela atual" do relatório já é o último pregão fechado.

Nenhuma das duas publica SLA. Uma execução sem dado apagaria a leitura do dia, então a cascata existe para que a indisponibilidade de uma não vire buraco no histórico. O cabeçalho do relatório sempre diz qual respondeu:

```text
fonte: OHLC de cambio (diario=yahoo, semanal=yahoo)
```

Quando as duas caem, o bloco do par sai marcado com `FALHA:` citando o erro de cada uma, e o estado persistido do dia anterior é preservado em vez de apagado.

As duas fontes são normalizadas para a **mesma grade**: toda vela é ancorada na meia-noite UTC do próprio dia. Sem isso o Yahoo (que carimba a vela no fuso da bolsa) e o Stooq (que só manda a data) cairiam em grades diferentes, e o estado persistido passaria a comparar velas que não são a mesma vela.

Os timeframes são dois:

- **Diário:** `interval=1d` no Yahoo, `i=d` no Stooq.
- **Semanal:** `interval=1wk` no Yahoo, `i=w` no Stooq.

### Fim de semana e feriado

O câmbio à vista não negocia sábado e domingo, e os dois monitores anteriores nunca precisaram lidar com isso — cripto negocia todo dia. Aqui há duas consequências práticas:

- Fora do pregão, a "vela atual" já é uma vela fechada. A linha `vela_atual_em_formacao: nao` é o que separa os dois casos para quem lê só o JSON.
- `retestMaxCandles` conta **dias corridos**, não pregões. Os 30 do diário valem cerca de 21 velas diárias reais.

### A vela-fantasma

Fora do pregão o Yahoo não simplesmente para de mandar velas: ele **acrescenta uma vela carimbada agora**, com o último preço repetido nas quatro pontas e amplitude zero. Não é uma sessão.

Isso apareceu na primeira execução real, num sábado. Se a vela entra na série, ela vira a "vela em formação" do sábado, o relatório publica como `preco_atual` um número que não fechou em lugar nenhum, e `vela_atual_em_formacao` diz `sim` com o mercado fechado.

O monitor descarta qualquer vela de **amplitude zero** (`high === low`). O critério é esse, e não o calendário, porque assim pega feriado, meio-pregão e a borda do Stooq do mesmo jeito, sem precisar saber o calendário de nenhum dos dois. Um dia inteiro de USD/BRL sem um pip de variação não existe, então nenhuma vela legítima é descartada.

O **diário** é o timeframe principal para timing de pullbacks, rompimentos, retestes, perda/recuperação de níveis, candles e mudanças de momentum.

O **semanal** funciona principalmente como contexto e filtro estrutural: ajuda a identificar se um sinal diário está alinhado, neutro ou em conflito com a estrutura maior. O relatório também calcula os mesmos indicadores principais no semanal e distingue os valores da vela semanal fechada dos valores provisórios da semana em formação.

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

### Volume — desligado, e de propósito

Esta é a diferença de fundo em relação aos monitores de BTC e XMR.

O câmbio à vista é mercado de balcão: **não existe volume consolidado público**. As duas fontes ou mandam zero, ou não mandam o campo. Tratar esse zero como dado seria pior do que não ter dado nenhum — o monitor leria "volume fraco" em todo candle e penalizaria toda zona por uma informação que nunca existiu.

Então o volume está **desligado**, não zerado. Na prática:

- O relatório publica uma linha só, `volume_disponivel: nao`, e omite `volume_atual`, `volume_vs_media_pct`, `volume_classificacao`, `volume_tendencia_3_fechadas`, `trades_vela_atual` e a comparação semanal equivalente.
- Publicar esses campos como `--` seria pior: um consumidor concluiria que o dado existe e falhou hoje. `nao` diz que ele não existe neste par, nunca.
- Os alertas que dependiam de volume (`rompimento_com_volume_acima_da_media`, `queda_com_expansao_de_volume`, `pullback_com_volume_decrescente`) simplesmente não são emitidos.
- No score das zonas, o fator de volume sai da **normalização** em vez de entrar valendo zero. Valendo zero, ele viraria um desconto fixo em toda zona e as faixas de score (`ativa` / `enfraquece` / `remove`) deixariam de calibrar.

Continua publicada a `fracao_periodo_decorrida`, que agora serve para o que sempre serviu de fato: dizer o quanto do período já passou.

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

| Faixa | Label | De onde veio |
| --- | --- | --- |
| R$ 5,25–5,36 | `faixa_5_25_5_36` | zona automática de resistência acima do preço |
| R$ 5,13–5,21 | `faixa_5_13_5_21` | campo de batalha atual (zona de maior score) |
| R$ 5,05–5,12 | `regiao_suporte_5_05_5_12` | zona de suporte imediatamente abaixo |

Além das faixas, o código mantém uma resistência pontual em **R$ 5,30** e um suporte pontual em **R$ 5,13** para a máquina de estados de rompimento/reteste. Nenhum dos dois é número redondo por acaso:

- **5,30** é o centro da zona automática mais forte acima do preço (5,2255–5,3604, centro 5,2930) e coincide com a **EMA89 semanal** em 5,2926. Duas leituras independentes apontando o mesmo lugar.
- **5,13** é tríplice confluência: **EMA89 diária** em 5,1321, borda inferior da zona de maior score (5,1306) e o último fundo mais alto da estrutura, o pivô de 2026-08-24 em 5,1308.

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
- que o fallback assume quando o Yahoo responde erro;
- que as duas fontes caindo produzem `FALHA:` citando o erro de cada uma;
- que o volume sai declarado como indisponível e os campos de volume ficam fora;
- que o `relatorio.json` continua parseável e tipado;
- que uma segunda execução lê o estado da anterior sem quebrar;
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

Os arquivos em `docs/` serão atualizados localmente. O monitor consulta o Yahoo Finance — e, se necessário, o Stooq — pela internet durante a execução.

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
