require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Mostra os comandos do Paquistão Bot'),
  new SlashCommandBuilder().setName('estoque').setDescription('Abre o painel de estoque'),
  new SlashCommandBuilder().setName('entrada').setDescription('Registra entrada de um lote no estoque')
    .addStringOption(o => o.setName('produto').setDescription('Nome do produto').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('data').setDescription('Data de entrada DD/MM/AAAA').setRequired(true))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade recebida').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('retirar').setDescription('Retira produtos do estoque para um vendedor')
    .addStringOption(o => o.setName('produto').setDescription('Nome do produto').setRequired(true).setMaxLength(80))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade retirada').setRequired(true).setMinValue(1))
    .addUserOption(o => o.setName('responsavel').setDescription('Vendedor responsável (padrão: você)')),
  new SlashCommandBuilder().setName('venda').setDescription('Registra uma venda efetiva')
    .addStringOption(o => o.setName('produto').setDescription('Nome do produto').setRequired(true).setMaxLength(80))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade vendida').setRequired(true).setMinValue(1))
    .addUserOption(o => o.setName('vendedor').setDescription('Vendedor (padrão: você)'))
    .addNumberOption(o => o.setName('valor_unitario').setDescription('Valor unitário em R$ (opcional)').setMinValue(0)),
  new SlashCommandBuilder().setName('depositar').setDescription('Registra depósito com comprovante para aprovação')
    .addUserOption(o => o.setName('usuario').setDescription('Pessoa a quem pertence o depósito').setRequired(true))
    .addNumberOption(o => o.setName('valor').setDescription('Valor em reais').setRequired(true).setMinValue(0.01))
    .addAttachmentOption(o => o.setName('comprovante').setDescription('Imagem ou PDF do comprovante').setRequired(true)),
  new SlashCommandBuilder().setName('meusdepositos').setDescription('Mostra seus depósitos recentes'),
  new SlashCommandBuilder().setName('depositos').setDescription('Lista depósitos pendentes ou aprovados'),
  new SlashCommandBuilder().setName('relatorio').setDescription('Gera relatório de vendas, depósitos e estoque')
    .addStringOption(o => o.setName('periodo').setDescription('Período do relatório').addChoices(
      { name: 'Semanal', value: 'semanal' }, { name: 'Mensal', value: 'mensal' }
    ))
    .addUserOption(o => o.setName('usuario').setDescription('Filtrar por pessoa (opcional)')),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking semanal de vendas e depósitos'),
  new SlashCommandBuilder().setName('logs').setDescription('Mostra os eventos recentes do sistema'),
  new SlashCommandBuilder().setName('config').setDescription('Mostra/ajusta a configuração do bot')
    .addSubcommand(s => s.setName('mostrar').setDescription('Mostra configurações atuais'))
    .addSubcommand(s => s.setName('gerente').setDescription('Define o cargo de gerente').addRoleOption(o => o.setName('cargo').setDescription('Cargo de gerente').setRequired(true)))
    .addSubcommand(s => s.setName('funcionario').setDescription('Define o cargo de funcionário').addRoleOption(o => o.setName('cargo').setDescription('Cargo de funcionário').setRequired(true)))
    .addSubcommand(s => s.setName('canal_logs').setDescription('Define canal de logs').addChannelOption(o => o.setName('canal').setDescription('Canal de logs').setRequired(true)))
    .addSubcommand(s => s.setName('canal_comprovantes').setDescription('Define canal de comprovantes').addChannelOption(o => o.setName('canal').setDescription('Canal de comprovantes').setRequired(true)))
    .addSubcommand(s => s.setName('canal_relatorios').setDescription('Define canal de relatórios').addChannelOption(o => o.setName('canal').setDescription('Canal de relatórios').setRequired(true))),
].map(c => c.toJSON());

(async () => {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('Preencha DISCORD_TOKEN, CLIENT_ID e GUILD_ID no .env');
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`Registrados ${commands.length} comandos no servidor ${GUILD_ID}.`);
})().catch(err => { console.error(err); process.exit(1); });
