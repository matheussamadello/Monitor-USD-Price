# Reajuste seletivo das faixas manuais — USD

Dados congelados capturados em **2026-09-25T01:23:22.587Z**. Comparação na mesma janela histórica da auditoria anterior. Revisão de geometria, sem otimizar score ou criar faixas adicionais.

## Critério

O teto anterior de 0,25 ATR diário e 1% podia excluir pivôs e reações próximos. A largura agora segue a evidência de cada região, com teto de segurança de **0,5 ATR diário na calibração**. Esse teto não é uma largura alvo nem um mecanismo de ajuste automático. Todas as faixas continuam menores que as regiões amplas originais. As que já representavam bem o núcleo foram mantidas.

Contato exige interseção OHLC com a faixa exata, sem margem ATR. Episódios, reações de pelo menos 1 ATR, volume, role reversal, pesos e penalidades seguem a auditoria anterior. O score abaixo é diagnóstico, não um novo campo canônico do monitor. Alargar uma borda pode reagrupar episódios e mudar o momento da saída e a classificação de rejeição, portanto mais toques não significam necessariamente mais evidência independente. Não é backtest prospectivo.

## Faixas alteradas — diário

| Par | Antes | Agora | Largura em ATR diário | Score antes → agora | Toques antes → agora | Rejeições antes → agora | Score atual sem bônus semanal |
|---|---|---|---:|---:|---:|---:|---:|
| USDT/BRL | 5,274–5,2815 | 5,274–5,2858 | 0.307 | 62 → 73 | 10 → 10 | 7 → 9 | 73 |
| USD/BRL | 5,2525–5,2595 | 5,2525–5,2675 | 0.269 | 71 → 71 | 6 → 7 | 4 → 5 | 59 |

- **USDT/BRL 5,274–5,2858**: Recupera a reacao com minima em 5,2855 que ficou imediatamente fora da faixa estreita, preservando os dois pivos internos.
- **USD/BRL 5,2525–5,2675**: Inclui o fundo confirmado de 5,26617479 junto aos pivos de 5,25400019 e 5,25812817. Os pivos em 5,28134584 e 5,28579998 permanecem fora, pois pertencem a uma concentracao mais distante.

## Retestes após confirmação do núcleo anterior

Mantém o mesmo início da medição anterior (cinco velas após o pivô selecionado naquela revisão). Não reinicia a janela num pivô mais antigo acrescentado agora. Isso impede que a comparação melhore apenas por incluir mais história. Não representa validação prospectiva dos limites escolhidos hoje.

| Par | Faixa nova | Score antes → agora | Toques antes → agora | Rejeições antes → agora | Episódios abertos agora |
|---|---|---:|---:|---:|---:|
| USDT/BRL | 5,274–5,2858 | 62 → 73 | 9 → 9 | 6 → 8 | 0 |
| USD/BRL | 5,2525–5,2675 | 68 → 68 | 3 → 3 | 2 → 2 | 0 |

Foi avaliado e descartado alargar USD/BRL 5,129–5,1395 até 5,154: o pivô adicional está mais distante (lacuna superior a 0,25 ATR), e a junção piorava a leitura dos retestes. As demais faixas foram mantidas; score histórico não remove as ressalvas de falta de contatos recentes nas faixas superiores.

## Compatibilidade e alertas

Só foram alterados limites/labels de faixas selecionadas e sua documentação. Pontos de suporte/resistência, macro, EMA89, RSI, DMI/ADX, pivôs, estrutura, divergências, motor automático, pesos e regras de alertas permanecem iguais. Os campos canônicos e o histórico não foram renomeados ou reescritos.

As faixas ampliadas podem reconhecer presença em preços antes excluídos, aumentando o tempo dentro da região. A troca de label pode mudar a assinatura uma vez. Não se promete a mesma frequência futura de alertas, nem se interpreta essa mudança de configuração como novo movimento de mercado.

Na comparação antes/depois com as mesmas respostas reais congeladas, os gatilhos ativos permaneceram idênticos. Também foram verificadas a igualdade dos indicadores, estrutura, ciclos de níveis pontuais e geometria/score/toques/rejeições das zonas automáticas. A lista de campos alterados está no registro de evidência.

## Reprodução

```sh
node teste-fumaca.mjs
node teste-auditoria-faixas.mjs
node teste-reajuste-faixas.mjs
```

Os [dados congelados](auditoria-faixas-dados-2026-09-25.json) são os mesmos da auditoria anterior. O [registro completo](reajuste-faixas-manuais-2026-09-25.json) contém os pivôs e os resultados diário/semanal das faixas alteradas e mantidas. O teste recalcula as medidas e verifica os limites, janelas e evidências, sem rede.
