# Revisão de USD e zonas automáticas — 2026-10-07

Coleta real: 2026-10-07T09:48:03.648Z. Referência de main: 2026-10-07 09:12 UTC. A evidência detalhada, com hashes das respostas, está em revisao-zonas-2026-10-07.json.

## Resultado das zonas

- **USDT/BRL:** 5.2178–5.2222, score 79, 6 episódios e 4 rejeições: em observação (pivô único com score abaixo de 80)
- **USD/BRL:** 4.9284–4.9521, score 83, 5 episódios e 3 rejeições: promovida a faixa manual

## Correções necessárias

- Bloco semanal com falha preserva memoria, mas nao confirma nem pontua zonas diarias.
- Sem pivos na serie valida, as fichas antigas passam pela reconciliacao e pela carencia de orfas.

As correções da auditoria de 01/10 ainda estavam fora de main e foram mantidas nesta revisão. As faixas existentes e os níveis pontuais foram preservados. O código dos branches anteriores de Codex e Claude foi considerado; não houve alteração nova do motor em main desde 28/09.

A nova faixa fixa é **R$ 4,9284–4,9521**, com limites estruturais arredondados para fora. A zona tem score 83; a auditoria independente da faixa exata deu score 76, cinco episódios (quatro concluídos e um aberto) e três rejeições, sem confirmação semanal. Nas últimas 90 velas, há um toque e nenhuma rejeição confirmada. A região é uma referência histórica revisitada, e sua promoção não confirma que o suporte segurou no toque atual. A série que reproduz essas medidas está em `fixture-promocao-usd-2026-10-07.json`.

## Verificação

- `node teste-fumaca.mjs`: suíte completa aprovada nos três projetos.
- `PARIDADE_SEM_REDE=1 node paridade.mjs`: motor compartilhado em paridade.
- Reproduções das duas falhas novas reprovaram antes da correção e passaram depois.
- Replay das respostas reais: níveis, EMA89, IDs, geometria, score e contadores preservados; reexecução da mesma vela estável.
- No USD, o snapshot mudou apenas quatro linhas de contagem das faixas (7 para 8). Nos demais, snapshots idênticos.

A validação de lacunas de horas e a tolerância de idade do câmbio permanecem conservadoras e não substituem calendário oficial de sessões/feriados. Esta revisão valida comportamento e qualidade da referência; não mede rentabilidade.
