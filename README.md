# 🇵🇰 Paquistão Bot

Bot Discord em português para controle de estoque, lotes com data de entrada, retiradas, vendas, depósitos com comprovante e aprovação, permissões, logs e relatórios semanais.

## Requisitos
- Node.js 20 ou superior
- Um servidor Discord onde você possa adicionar bots

## Instalação no Windows
1. Instale Node.js LTS: https://nodejs.org/
2. Extraia o ZIP para uma pasta.
3. Abra essa pasta no terminal/Prompt de Comando.
4. Execute `npm install`.
5. Renomeie `.env.example` para `.env` e preencha os dados.
6. No Discord Developer Portal, crie uma aplicação, adicione um Bot e copie o token para `DISCORD_TOKEN`.
7. Em OAuth2 > URL Generator, marque `bot` e `applications.commands`. Permissões recomendadas: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Use Application Commands.
8. Convide o bot ao servidor.
9. Execute `npm run deploy` para registrar os comandos no servidor definido por `GUILD_ID`.
10. Execute `npm start`.

O terminal deve mostrar `Conectado como ...`. Mantenha a janela aberta para o bot continuar online.

## Configuração inicial
- `/config` mostra as configurações atuais e orienta como definir cargos e canais.
- `/config dono` permite que o dono do servidor/bot configure IDs de cargos e canais.
- Também é possível preencher os IDs diretamente no `.env` e reiniciar o bot.
- `OWNER_IDS` aceita vários IDs separados por vírgula.

## Comandos
- `/help` lista os comandos.
- `/estoque` abre o painel de estoque.
- `/entrada produto data quantidade` registra um lote e a data informada no formato `DD/MM/AAAA`, por exemplo `08/10/2026`.
- `/retirar produto quantidade [responsavel]` registra a retirada de estoque para um vendedor.
- `/venda produto quantidade [vendedor] [valor_unitario]` registra vendas efetivas e alimenta o ranking semanal.
- `/depositar usuario valor comprovante` envia comprovante para o canal configurado e aguarda aprovação.
- `/meusdepositos` mostra seus depósitos recentes.
- `/depositos` lista depósitos pendentes/aprovados (gerentes).
- `/relatorio [periodo] [usuario]` mostra o resumo semanal ou mensal.
- `/ranking` mostra o ranking semanal de vendas e depósitos.
- `/logs` mostra eventos recentes (gerentes).
- `/config` mostra as configurações e como ajustar cargos/canais.

## Observações importantes
- Estoque, transações, vendas, depósitos e configurações ficam em SQLite na pasta `data/`, e sobrevivem a reinícios.
- A data do lote é salva separada da data/hora em que o registro foi feito.
- `/entrada` cria lotes individuais para preservar o histórico de cada recebimento.
- `/retirar` diminui o estoque disponível e cria um registro de retirada. `/venda` registra a venda efetiva e atualiza o ranking. Retirada não é automaticamente considerada venda.
- Depósitos só entram no total aprovado após um gerente usar os botões Aprovar/Recusar.
- O bot registra IDs do usuário e data/hora em ações relevantes. Não compartilhe o token do bot.
- O banco SQLite é local. Para operação 24/7, hospede em um VPS/serviço compatível e mantenha backups regulares da pasta `data/`.
