require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, MessageFlags, ChannelType
} = require('discord.js');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'paquistao.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE COLLATE NOCASE, stock INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS lots (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, qty_in INTEGER NOT NULL, qty_remaining INTEGER NOT NULL, entry_date TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS stock_events (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT NOT NULL, type TEXT NOT NULL, quantity INTEGER NOT NULL, user_id TEXT NOT NULL, target_user_id TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL, seller_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS deposits (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, amount REAL NOT NULL, proof_url TEXT NOT NULL, proof_name TEXT, status TEXT NOT NULL DEFAULT 'pending', submitted_by TEXT NOT NULL, reviewed_by TEXT, review_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const OWNER_IDS = (process.env.OWNER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const defaults = {
  manager_role_id: process.env.MANAGER_ROLE_ID || '',
  employee_role_id: process.env.EMPLOYEE_ROLE_ID || '',
  log_channel_id: process.env.LOG_CHANNEL_ID || '',
  deposit_channel_id: process.env.DEPOSIT_CHANNEL_ID || '',
  report_channel_id: process.env.REPORT_CHANNEL_ID || ''
};
for (const [k,v] of Object.entries(defaults)) if (v && !db.prepare('SELECT value FROM config WHERE key=?').get(k)) db.prepare('INSERT INTO config(key,value) VALUES(?,?)').run(k,v);

const getCfg = k => db.prepare('SELECT value FROM config WHERE key=?').get(k)?.value || '';
const setCfg = (k,v) => db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,String(v));
const nowIso = () => new Date().toISOString();
const money = n => Number(n || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const safeName = s => s.trim().replace(/\s+/g,' ').slice(0,80);
const embed = (title, description, color=0x087f46) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setFooter({ text:'🇵🇰 PAQUISTÃO • Controle interno' }).setTimestamp();
function audit(actor, action, details) {
  db.prepare('INSERT INTO audit(actor_id,action,details) VALUES(?,?,?)').run(actor,action,details);
  const id = getCfg('log_channel_id');
  if (id) client.channels.fetch(id).then(ch => ch?.send({ embeds:[embed('📋 Log do sistema', `**Ação:** ${action}\n**Responsável:** <@${actor}>\n**Detalhes:** ${details}`,0x334155)] })).catch(()=>{});
}
function isOwner(i) { return OWNER_IDS.includes(i.user.id) || i.guild?.ownerId === i.user.id; }
function isManager(i) {
  if (isOwner(i)) return true;
  const role = getCfg('manager_role_id');
  return !!role && i.member?.roles?.cache?.has(role);
}
function canUseStock(i) {
  if (isManager(i)) return true;
  const role = getCfg('employee_role_id');
  return !!role && i.member?.roles?.cache?.has(role);
}
function denied(i) { return i.reply({ content:'⛔ Você não tem permissão para usar esta função. Peça ao dono/gerente para configurar seu cargo com `/config`.', flags:MessageFlags.Ephemeral }); }
function getProduct(name) { return db.prepare('SELECT * FROM products WHERE name=? COLLATE NOCASE').get(name); }
function ensureProduct(name) {
  let p = getProduct(name);
  if (!p) {
    const info = db.prepare('INSERT INTO products(name,stock) VALUES(?,0)').run(safeName(name));
    p = db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid);
  }
  return p;
}
function parseDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1]));
  if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[2]-1 || d.getUTCDate() !== +m[1]) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function dateBR(s) { return s ? new Date(s.includes('T') ? s : s.replace(' ','T')+'Z').toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo' }) : '-'; }
function weekStart() { const d = new Date(); const day = (d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d.toISOString().slice(0,19).replace('T',' '); }
function monthStart() { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.toISOString().slice(0,19).replace('T',' '); }
function panelEmbed() {
  const rows = db.prepare('SELECT name,stock FROM products ORDER BY name COLLATE NOCASE LIMIT 25').all();
  const list = rows.length ? rows.map(p => `📦 **${p.name}**: ${p.stock}`).join('\n') : '_Nenhum produto cadastrado ainda. Use `/entrada` para registrar o primeiro lote._';
  return embed('🇵🇰 PAQUISTÃO | ESTOQUE', `**Estoque atual**\n${list}\n\nUse os botões abaixo ou os comandos \`/entrada\` e \`/retirar\`.`, 0x087f46);
}
function panelRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('stock_refresh').setLabel('Atualizar estoque').setEmoji('🔄').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('stock_help').setLabel('Comandos').setEmoji('📖').setStyle(ButtonStyle.Secondary)
  )];
}
async function reportText(period='semanal', userId=null) {
  const start = period === 'mensal' ? monthStart() : weekStart();
  const sales = db.prepare(`SELECT seller_id, SUM(quantity) qty, SUM(CASE WHEN unit_price IS NULL THEN 0 ELSE quantity*unit_price END) revenue FROM sales WHERE created_at >= ? ${userId?'AND seller_id=?':''} GROUP BY seller_id ORDER BY qty DESC`).all(...(userId?[start,userId]:[start]));
  const deps = db.prepare(`SELECT user_id, SUM(amount) amount FROM deposits WHERE status='approved' AND created_at >= ? ${userId?'AND user_id=?':''} GROUP BY user_id ORDER BY amount DESC`).all(...(userId?[start,userId]:[start]));
  const stock = db.prepare('SELECT name,stock FROM products ORDER BY name COLLATE NOCASE').all();
const entries = db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM stock_events WHERE type='entrada' AND created_at >= ?`).get(start).n;
  const withdrawals = db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM stock_events WHERE type='retirada' AND created_at >= ?`).get(start).n;
  const salesTxt = sales.length ? sales.slice(0,10).map((x,i)=>`${['🥇','🥈','🥉'][i]||`${i+1}.`} <@${x.seller_id}> • **${x.qty} un.** • ${money(x.revenue)}`).join('\n') : '_Sem vendas registradas no período._';
  const depTxt = deps.length ? deps.slice(0,10).map((x,i)=>`${['🥇','🥈','🥉'][i]||`${i+1}.`} <@${x.user_id}> • **${money(x.amount)}**`).join('\n') : '_Sem depósitos aprovados no período._';
  const stockTxt = stock.length ? stock.slice(0,20).map(p=>`• ${p.name}: **${p.stock}**`).join('\n') : '_Sem produtos._';
  return embed(`📊 Relatório ${period==='mensal'?'mensal':'semanal'}`, `**Período desde:** ${dateBR(start)}${userId?`\n**Pessoa:** <@${userId}>`:''}\n\n**🏆 Vendas por quantidade**\n${salesTxt}\n\n**💰 Depósitos aprovados**\n${depTxt}\n\n**📦 Estoque atual**\n${stockTxt}\n\n**Movimentações no período**\n📥 Entradas: **${entries} unidades**\n📤 Retiradas: **${withdrawals} unidades**`,0x087f46);
}
async function showDeposits(i, status='pending') {
  const rows = db.prepare('SELECT * FROM deposits WHERE status=? ORDER BY id DESC LIMIT 10').all(status);
  if (!rows.length) return i.reply({ content:`Nenhum depósito com status **${status}**.`, flags:MessageFlags.Ephemeral });
  const embeds = rows.map(d => embed(`Depósito #${d.id} • ${d.status}`, `**Usuário:** <@${d.user_id}>\n**Valor:** ${money(d.amount)}\n**Enviado por:** <@${d.submitted_by}>\n**Data:** ${dateBR(d.created_at)}\n**Comprovante:** [Abrir arquivo](${d.proof_url})`, d.status==='approved'?0x16a34a:0xf59e0b));
  const components = rows.filter(d=>d.status==='pending').slice(0,5).map(d=>new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`deposit_approve_${d.id}`).setLabel(`Aprovar #${d.id}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`deposit_reject_${d.id}`).setLabel(`Recusar #${d.id}`).setStyle(ButtonStyle.Danger)
  ));
  return i.reply({ embeds, components, flags:MessageFlags.Ephemeral });
}

client.once(Events.ClientReady, c => console.log(`Conectado como ${c.user.tag}`));
client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isButton()) {
      if (i.customId === 'stock_refresh') return i.update({ embeds:[panelEmbed()], components:panelRows() });
      if (i.customId === 'stock_help') return i.reply({ content:'Use `/help` para ver todos os comandos.', flags:MessageFlags.Ephemeral });
      const match = /^deposit_(approve|reject)_(\d+)$/.exec(i.customId);
      if (match) {
        if (!isManager(i)) return denied(i);
        const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(Number(match[2]));
        if (!dep || dep.status !== 'pending') return i.reply({ content:'Este depósito já foi processado ou não existe.', flags:MessageFlags.Ephemeral });
        const status = match[1] === 'approve' ? 'approved' : 'rejected';
        db.prepare('UPDATE deposits SET status=?,reviewed_by=?,reviewed_at=? WHERE id=?').run(status,i.user.id,nowIso(),dep.id);
        audit(i.user.id, `deposito_${status}`, `Depósito #${dep.id}, ${money(dep.amount)}, usuário ${dep.user_id}`);
        await i.update({ embeds:[embed(`${status==='approved'?'✅ Depósito aprovado':'❌ Depósito recusado'} #${dep.id}`, `**Usuário:** <@${dep.user_id}>\n**Valor:** ${money(dep.amount)}\n**Revisado por:** <@${i.user.id}>`,status==='approved'?0x16a34a:0xdc2626)], components:[] });
        return;
      }
    }
    if (!i.isChatInputCommand()) return;
    const cmd = i.commandName;
    if (cmd === 'help') {
      return i.reply({ embeds:[embed('📖 PAQUISTÃO BOT | Comandos',
        '**📦 Estoque**\n`/estoque` abre o painel.\n`/entrada produto data quantidade` registra um lote com data DD/MM/AAAA.\n`/retirar produto quantidade [responsavel]` diminui o estoque e registra quem recebeu.\n\n**💸 Vendas e depósitos**\n`/venda produto quantidade [vendedor] [valor_unitario]` registra venda efetiva para o ranking.\n`/depositar usuario valor comprovante` envia comprovante para aprovação.\n`/meusdepositos` mostra seus depósitos recentes.\n`/depositos` lista depósitos pendentes ou aprovados (gerentes).\n\n**📊 Relatórios**\n`/relatorio [periodo] [usuario]` gera relatório semanal/mensal.\n`/ranking` mostra ranking semanal.\n`/logs` mostra os eventos recentes (gerentes).\n\n**⚙️ Administração**\n`/config` mostra as opções de configuração. Dono/gerente pode configurar cargos e canais.')], flags:MessageFlags.Ephemeral });
    }
    if (cmd === 'estoque') return i.reply({ embeds:[panelEmbed()], components:panelRows() });
    if (cmd === 'entrada') {
      if (!canUseStock(i)) return denied(i);
      const name = safeName(i.options.getString('produto'));
      const date = parseDate(i.options.getString('data'));
      const qty = i.options.getInteger('quantidade');
      if (!date) return i.reply({ content:'Data inválida. Use o formato `DD/MM/AAAA`, por exemplo `08/10/2026`.', flags:MessageFlags.Ephemeral });
      const p = ensureProduct(name);
      const tx = db.transaction(() => {
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(qty,p.id);
        db.prepare('INSERT INTO lots(product_id,qty_in,qty_remaining,entry_date,created_by) VALUES(?,?,?,?,?)').run(p.id,qty,qty,date,i.user.id);
        db.prepare('INSERT INTO stock_events(product_id,product_name,type,quantity,user_id,note) VALUES(?,?,?,?,?,?)').run(p.id,p.name,'entrada',qty,i.user.id,`Data de entrada: ${date}`);
      });
      tx(); audit(i.user.id,'entrada',`${qty}x ${p.name}, data do lote ${date}`);
      const updated = getProduct(name);
      return i.reply({ embeds:[embed('📥 Entrada registrada',`**Produto:** ${p.name}\n**Data real de entrada:** ${date.split('-').reverse().join('/')}\n**Quantidade recebida:** ${qty}\n**Estoque atualizado:** ${updated.stock}\n**Lote:** #${db.prepare('SELECT last_insert_rowid() id').get().id}`)], flags:MessageFlags.Ephemeral });
    }
    if (cmd === 'retirar') {
      if (!canUseStock(i)) return denied(i);
      const name = safeName(i.options.getString('produto'));
      const qty = i.options.getInteger('quantidade');
      const target = i.options.getUser('responsavel') || i.user;
      const p = getProduct(name);
      if (!p) return i.reply({ content:'Produto não encontrado. Registre primeiro com `/entrada`.', flags:MessageFlags.Ephemeral });
      if (p.stock < qty) return i.reply({ content:`Estoque insuficiente. Disponível: ${p.stock}.`, flags:MessageFlags.Ephemeral });
      db.transaction(() => {
        db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(qty,p.id);
        db.prepare('INSERT INTO stock_events(product_id,product_name,type,quantity,user_id,target_user_id) VALUES(?,?,?,?,?,?)').run(p.id,p.name,'retirada',qty,i.user.id,target.id);
      })();
      audit(i.user.id,'retirada',`${qty}x ${p.name}, entregue a ${target.id}`);
      return i.reply({ embeds:[embed('📤 Retirada registrada',`**Produto:** ${p.name}\n**Quantidade:** ${qty}\n**Responsável pela retirada:** <@${i.user.id}>\n**Entregue para vender:** <@${target.id}>\n**Estoque restante:** ${p.stock-qty}`)], flags:MessageFlags.Ephemeral });
    }
    if (cmd === 'venda') {
      if (!canUseStock(i)) return denied(i);
      const name = safeName(i.options.getString('produto'));
      const qty = i.options.getInteger('quantidade');
      const seller = i.options.getUser('vendedor') || i.user;
      const price = i.options.getNumber('valor_unitario');
      const p = getProduct(name);
      if (!p) return i.reply({ content:'Produto não encontrado.', flags:MessageFlags.Ephemeral });
      db.prepare('INSERT INTO sales(product_id,product_name,quantity,unit_price,seller_id,created_by) VALUES(?,?,?,?,?,?)').run(p.id,p.name,qty,price,seller.id,i.user.id);
      audit(i.user.id,'venda',`${qty}x ${p.name}, vendedor ${seller.id}, valor unitário ${price ?? 'não informado'}`);
      return i.reply({ embeds:[embed('✅ Venda registrada',`**Produto:** ${p.name}\n**Quantidade vendida:** ${qty}\n**Vendedor:** <@${seller.id}>\n**Total:** ${price===null?'Não informado':money(price*qty)}\n\nA venda foi adicionada ao ranking.`)], flags:MessageFlags.Ephemeral });
    }
    if (cmd === 'depositar') {
      const target = i.options.getUser('usuario');
      const amount = i.options.getNumber('valor');
      const proof = i.options.getAttachment('comprovante');
      if (!canUseStock(i) && target.id !== i.user.id) return denied(i);
      if (!proof.contentType?.startsWith('image/') && proof.contentType !== 'application/pdf') return i.reply({ content:'Envie um comprovante em imagem ou PDF.', flags:MessageFlags.Ephemeral });
      const channelId = getCfg('deposit_channel_id');
      if (!channelId) return i.reply({ content:'Canal de comprovantes não configurado. Um dono/gerente deve usar `/config canal_comprovantes canal:#canal`.', flags:MessageFlags.Ephemeral });
      const rec = db.prepare('INSERT INTO deposits(user_id,amount,proof_url,proof_name,submitted_by) VALUES(?,?,?,?,?)').run(target.id,amount,proof.url,proof.name,i.user.id);
      const id = Number(rec.lastInsertRowid);
      const ch = await client.channels.fetch(channelId).catch(()=>null);
      if (!ch || !ch.isTextBased()) return i.reply({ content:'Não consegui acessar o canal configurado. Confira as permissões do bot.', flags:MessageFlags.Ephemeral });
      const e = embed(`💰 Novo depósito #${id}`,`**Pessoa:** <@${target.id}>\n**Valor:** ${money(amount)}\n**Enviado por:** <@${i.user.id}>\n**Status:** ⏳ Aguardando aprovação\n**Comprovante:** [${proof.name}](${proof.url})`,0xf59e0b);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`deposit_approve_${id}`).setLabel('Aprovar').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`deposit_reject_${id}`).setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger)
      );
      await ch.send({ embeds:[e], files:[proof.url], components:[row] });
      audit(i.user.id,'deposito_enviado',`Depósito #${id}, ${money(amount)}, usuário ${target.id}`);
      return i.reply({ content:`Depósito #${id} enviado para <#${channelId}> e aguardando aprovação de um gerente.`, flags:MessageFlags.Ephemeral });
    }
    if (cmd === 'meusdepositos') {
      const rows = db.prepare('SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 10').all(i.user.id);
      const desc = rows.length ? rows.map(d=>`**#${d.id}** • ${money(d.amount)} • ${d.status} • ${dateBR(d.created_at)}`).join('\n') : 'Você ainda não tem depósitos registrados.';
      return i.reply({ embeds:[embed('💰 Meus depósitos',desc)], flags:MessageFlags.Ephemeral });
    }
    if (cmd === 'depositos') {
      if (!isManager(i)) return denied(i);
      const status = 'pending';
      return showDeposits(i,status);
    }
    if (cmd === 'relatorio') {
      if (!isManager(i)) return denied(i);
      return i.reply({ embeds:[await reportText(i.options.getString('periodo')||'semanal',i.options.getUser('usuario')?.id)] });
    }
    if (cmd === 'ranking') {
      const e = await reportText('semanal');
      return i.reply({ embeds:[e] });
    }
    if (cmd === 'logs') {
      if (!isManager(i)) return denied(i);
      const rows = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 15').all();
      const desc = rows.length ? rows.map(r=>`• <t:${Math.floor(new Date(r.created_at.replace(' ','T')+'Z').getTime()/1000)}:f> <@${r.actor_id}> **${r.action}**: ${r.details}`).join('\n') : 'Nenhum log registrado.';
      return i.reply({ embeds:[embed('📋 Logs recentes',desc,0x334155)], flags:MessageFlags.Ephemeral });
    }
    if (cmd === 'config') {
      const sub = i.options.getSubcommand();
      if (sub === 'mostrar') {
        const roleManager = getCfg('manager_role_id') ? `<@&${getCfg('manager_role_id')}>` : 'Não configurado';
        const roleEmployee = getCfg('employee_role_id') ? `<@&${getCfg('employee_role_id')}>` : 'Não configurado';
        const logChannel = getCfg('log_channel_id') ? `<#${getCfg('log_channel_id')}>` : 'Não configurado';
        const depositChannel = getCfg('deposit_channel_id') ? `<#${getCfg('deposit_channel_id')}>` : 'Não configurado';
        const reportChannel = getCfg('report_channel_id') ? `<#${getCfg('report_channel_id')}>` : 'Não configurado';
        const description = `**Cargo gerente:** ${roleManager}\n**Cargo funcionário:** ${roleEmployee}\n**Canal logs:** ${logChannel}\n**Canal comprovantes:** ${depositChannel}\n**Canal relatórios:** ${reportChannel}\n\nUse os comandos /config gerente, /config funcionario, /config canal_logs, /config canal_comprovantes ou /config canal_relatorios para ajustar.`;
        return i.reply({ embeds:[embed('⚙️ Configuração', description)], flags:MessageFlags.Ephemeral });
      }
      if (!isOwner(i)) return i.reply({ content:'Somente o dono do servidor ou alguém listado em OWNER_IDS pode alterar as configurações.', flags:MessageFlags.Ephemeral });
      const map = { gerente:'manager_role_id', funcionario:'employee_role_id', canal_logs:'log_channel_id', canal_comprovantes:'deposit_channel_id', canal_relatorios:'report_channel_id' };
      const key = map[sub];
      const value = sub.startsWith('canal_') ? i.options.getChannel('canal').id : i.options.getRole('cargo').id;
      setCfg(key,value); audit(i.user.id,'configuracao',`${key} = ${value}`);
      return i.reply({ content:`Configuração atualizada: **${key}** = ${sub.startsWith('canal_')?`<#${value}>`:`<@&${value}>`}`, flags:MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error(err);
    const msg = { content:'Ocorreu um erro ao processar. Confira os dados e as permissões do bot.', flags:MessageFlags.Ephemeral };
    if (i.deferred || i.replied) await i.followUp(msg).catch(()=>{});
    else await i.reply(msg).catch(()=>{});
  }
});

client.login(process.env.DISCORD_TOKEN);
