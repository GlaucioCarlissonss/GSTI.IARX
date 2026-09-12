// Integrações e Acessos na versão hospedada: a conexão com o N8N, o contrato
// do payload, o log de eventos, e o cadastro de usuários, perfis e permissões.
//
// O gestor abriu o sistema e não achou nenhuma das duas telas. Cada conferência
// aqui é uma das coisas que ele espera encontrar ao abrir de novo.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1000 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await pag.evaluate(() => { try { localStorage.removeItem('iarx-previa'); } catch (e) {} });

  // ------------------------------------------------------------ integrações
  console.log('\n--- integrações: a tela existe e diz o que é ---');
  await irPara(pag, 'Integrações', 900);
  const tela = await pag.evaluate(() => ({
    aba: E.aba,
    cartoes: document.querySelectorAll('[data-sit]').length,
    kpis: document.querySelectorAll('.kpi').length,
    honesta: /não recebe o POST do N8N/i.test(document.querySelector('#pagina').textContent),
    semSegredo: /nada de segredo é guardado aqui/i.test(document.querySelector('#pagina').textContent),
    temSimulador: !!document.querySelector('#ev-payload'),
  }));
  ok('a aba Integrações abre', tela.aba === 'integracoes', tela.aba);
  ok('com um cartão por sistema de origem', tela.cartoes === 2, `${tela.cartoes}`);
  ok('e quatro indicadores do fluxo', tela.kpis === 4, `${tela.kpis}`);
  ok('a tela diz que não recebe webhook aqui', tela.honesta);
  ok('e que segredo nenhum fica guardado nela', tela.semSegredo);
  ok('o simulador de recebimento está na tela', tela.temSimulador);

  console.log('\n--- a conexão se cadastra e a situação acompanha ---');
  await pag.click('[data-editar="OSTICK"]');
  await pag.waitForTimeout(400);
  await pag.fill('#cx-base', 'https://helpdesk.exemplo/scp/tickets.php?id=');
  await pag.fill('#cx-hook', 'https://servidor.exemplo/api/webhooks/ostick');
  await pag.fill('#cx-fluxo', 'N8N — Chamados OStick');
  await pag.check('#cx-ativa');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(700);
  const gravada = await pag.evaluate(async () => {
    const c = (await Loja.integracoesDa(empresaAtiva())).find((x) => x.sistema === 'OSTICK');
    return { ativa: c && c.ativa, hook: c && c.urlWebhook, urlConfig: E.config.urlOsTicket };
  });
  ok('a conexão fica gravada e ativa', gravada.ativa === true);
  ok('com o endereço do webhook', /webhooks\/ostick$/.test(gravada.hook || ''), gravada.hook);
  ok('e o endereço do chamado alimenta o link das telas de suporte',
    /helpdesk\.exemplo/.test(gravada.urlConfig || ''), gravada.urlConfig);

  console.log('\n--- conexão ativa sem webhook é recusada ---');
  await pag.click('[data-editar="BITRIX24"]');
  await pag.waitForTimeout(400);
  await pag.check('#cx-ativa');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const recusa = await pag.evaluate(() => {
    const e = document.querySelector('.modal .msg.erro');
    return e && !e.hidden ? e.textContent.trim() : null;
  });
  ok('a tela explica o que falta', /endereço do webhook/i.test(recusa || ''), recusa || '(sem recusa)');
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(300);

  console.log('\n--- o payload de teste entra pelo caminho de verdade ---');
  const antesChamados = await pag.evaluate(async () => (await Loja.slaDa(empresaAtiva())).length);
  await pag.click('[data-teste="OSTICK"]');
  await pag.waitForTimeout(400);
  await pag.click('.modal [data-sim]');
  await pag.waitForTimeout(900);
  const apos = await pag.evaluate(async () => {
    const eventos = await Loja.eventosDa(empresaAtiva());
    const sla = await Loja.slaDa(empresaAtiva());
    const e = eventos[0];
    return { total: eventos.length, status: e && e.status, tipo: e && e.tipo, teste: e && e.teste,
      chamados: sla.length, antes: e && e.externalId,
      gravado: sla.some((s) => s.ticketId === (e && e.externalId)) };
  });
  ok('o evento fica no log', apos.total === 1 && apos.tipo === 'ticket.test', `${apos.total} · ${apos.tipo}`);
  ok('marcado como teste', apos.teste === true);
  ok('e processado', apos.status === 'processado', apos.status);
  ok('o chamado entrou na base', apos.chamados === antesChamados + 1 && apos.gravado,
    `${antesChamados} → ${apos.chamados}`);

  console.log('\n--- reenviar o mesmo id externo atualiza, não duplica ---');
  const idem = await pag.evaluate(async () => {
    const emp = empresaAtiva();
    const externo = (await Loja.eventosDa(emp))[0].externalId;
    const antes = (await Loja.slaDa(emp)).length;
    await processarEventoIntegracao(emp, { sistema:'OSTICK', tipo:'ticket.closed',
      payload: { ticket_id: externo, subject: 'Assunto revisado', status: 'closed',
                 closed: new Date().toISOString(), department: 'Infraestrutura' } });
    const sla = await Loja.slaDa(emp);
    const reg = sla.find((s) => s.ticketId === externo);
    return { antes, depois: sla.length, assunto: reg && reg.assunto, setor: reg && reg.setor,
      status: reg && reg.status };
  });
  ok('o número de chamados não muda', idem.depois === idem.antes, `${idem.antes} → ${idem.depois}`);
  ok('e o registro é atualizado', idem.assunto === 'Assunto revisado' && idem.setor === 'Infraestrutura',
    `${idem.assunto} · ${idem.setor}`);
  ok('com a situação traduzida para o vocabulário único', idem.status === 'closed', idem.status);

  console.log('\n--- payload incompleto é recusado com o motivo, e reprocessável ---');
  await pag.evaluate(async () => {
    await processarEventoIntegracao(empresaAtiva(), { sistema:'OSTICK', tipo:'ticket.created',
      payload: { ticket_id: 'SEM-ASSUNTO-1', status: 'open' } });
    await render();
  });
  await pag.waitForTimeout(700);
  const errado = await pag.evaluate(async () => {
    const e = (await Loja.eventosDa(empresaAtiva())).find((x) => x.externalId === 'SEM-ASSUNTO-1');
    const linha = document.querySelector(`tr[data-ev="${e.id}"]`);
    return { status: e.status, motivo: e.mensagem, temRefazer: !!(linha && linha.querySelector('[data-refazer]')) };
  });
  ok('o evento fica com erro', errado.status === 'erro', errado.status);
  ok('e o motivo nomeia o campo que faltou', /title/.test(errado.motivo || ''), errado.motivo);
  ok('a linha oferece reprocessar', errado.temRefazer);

  const refeito = await pag.evaluate(async () => {
    const emp = empresaAtiva();
    const e = (await Loja.eventosDa(emp)).find((x) => x.externalId === 'SEM-ASSUNTO-1');
    // Reprocessar refaz o MESMO evento: o log não pode virar fila de tentativas.
    await processarEventoIntegracao(emp, { sistema:e.sistema, tipo:e.tipo, id:e.id,
      payload: { ...e.payload, subject: 'Agora com assunto' } });
    const eventos = await Loja.eventosDa(emp);
    return { quantos: eventos.filter((x) => x.externalId === 'SEM-ASSUNTO-1').length,
      status: eventos.find((x) => x.externalId === 'SEM-ASSUNTO-1').status };
  });
  ok('o reprocessamento não cria um segundo evento', refeito.quantos === 1, `${refeito.quantos}`);
  ok('e o evento passa a processado', refeito.status === 'processado', refeito.status);

  console.log('\n--- o contrato do payload fica publicado na tela ---');
  await pag.click('[data-contrato="BITRIX24"]');
  await pag.waitForTimeout(400);
  const contrato = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    const txt = m ? m.textContent : '';
    return { linhas: m ? m.querySelectorAll('tbody tr').length : 0,
      bitrix: /UF_DEPARTMENT/.test(txt), obrigatorios: (txt.match(/obrigatório/g) || []).length,
      identidade: /external_id\)/.test(txt) };
  });
  ok('o contrato lista todos os campos', contrato.linhas === 16, `${contrato.linhas}`);
  ok('com os nomes que o Bitrix24 usa', contrato.bitrix);
  ok('marca os dois campos sem os quais não dá para gravar', contrato.obrigatorios === 2, `${contrato.obrigatorios}`);
  ok('e declara a identidade que torna a reentrega segura', contrato.identidade);
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(300);

  // ---------------------------------------------------------------- acessos
  console.log('\n--- acessos: perfis padrão nascem com a tela ---');
  await irPara(pag, 'Usuários e acessos', 900);
  const inicio = await pag.evaluate(async () => {
    const perfis = await Loja.perfisDa(empresaAtiva());
    const leitura = perfis.find((p) => p.tipo === 'VIEW_ONLY');
    const edicao = perfis.find((p) => p.tipo === 'EDIT');
    return { quantos: perfis.length, padrao: perfis.every((p) => p.padrao),
      leituraVeFinanceiro: perfilPode(leitura, 'financeiro', 'view'),
      leituraEscreve: perfilPode(leitura, 'financeiro', 'create'),
      leituraVeUsuarios: perfilPode(leitura, 'usuarios', 'view'),
      leituraVeIntegracoes: perfilPode(leitura, 'integracoes', 'view'),
      edicaoCria: perfilPode(edicao, 'financeiro', 'create'),
      edicaoAdministra: perfilPode(edicao, 'usuarios', 'edit') };
  });
  ok('a empresa ganha os dois perfis padrão', inicio.quantos === 2 && inicio.padrao, `${inicio.quantos}`);
  ok('quem só lê vê o financeiro', inicio.leituraVeFinanceiro);
  ok('mas não escreve nele', inicio.leituraEscreve === false);
  ok('e nem enxerga as telas administrativas',
    inicio.leituraVeUsuarios === false && inicio.leituraVeIntegracoes === false);
  ok('quem edita cria lançamento', inicio.edicaoCria);
  ok('e mesmo assim não administra acesso', inicio.edicaoAdministra === false);

  console.log('\n--- o usuário se cadastra com login separado do e-mail ---');
  await pag.click('#u-novo');
  await pag.waitForTimeout(400);
  await pag.fill('#u-nome', 'Maria Aparecida Souza');
  await pag.fill('#u-email', 'maria.souza@exemplo.com.br');
  const derivado = await pag.inputValue('#u-user');
  ok('o login se deriva do e-mail enquanto ninguém o digita', derivado === 'maria.souza', derivado);
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(700);
  const criado = await pag.evaluate(async () => {
    const u = (await Loja.usuariosDa(empresaAtiva()))[0];
    return { quantos: (await Loja.usuariosDa(empresaAtiva())).length, username: u && u.username,
      email: u && u.email, ativo: u && u.ativo };
  });
  ok('o usuário fica gravado', criado.quantos === 1 && criado.ativo === true);
  ok('com login e e-mail separados', criado.username === 'maria.souza' && criado.email === 'maria.souza@exemplo.com.br',
    `${criado.username} · ${criado.email}`);

  console.log('\n--- login repetido é recusado ---');
  await pag.click('#u-novo');
  await pag.waitForTimeout(400);
  await pag.fill('#u-nome', 'Maria Souza (segunda conta)');
  await pag.fill('#u-email', 'maria.souza@exemplo.com.br');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(500);
  const dupla = await pag.evaluate(() => {
    const e = document.querySelector('.modal .msg.erro');
    return e && !e.hidden ? e.textContent.trim() : null;
  });
  ok('a tela nomeia o conflito', /já existe|já está/i.test(dupla || ''), dupla || '(sem recusa)');
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(300);

  console.log('\n--- inativar não apaga, e exige justificativa ---');
  await pag.click('tr[data-u] [data-alternar]');
  await pag.waitForTimeout(400);
  await pag.click('.modal [data-sim]');
  await pag.waitForTimeout(400);
  const semJust = await pag.evaluate(() => {
    const e = document.querySelector('.modal .msg.erro');
    return e && !e.hidden ? e.textContent.trim() : null;
  });
  ok('sem justificativa não passa', /justificativa/i.test(semJust || ''), semJust || '(passou)');
  await pag.fill('.modal #just', 'Desligamento em 12/09.');
  await pag.click('.modal [data-sim]');
  await pag.waitForTimeout(800);
  const inativado = await pag.evaluate(async () => {
    const lista = await Loja.usuariosDa(empresaAtiva());
    const trilha = await E.db.doc('auditoria/' + empresaAtiva()).get();
    const reg = (trilha.exists ? trilha.data().itens : []).find((a) => a.entidade === 'usuario' && a.acao === 'inativar');
    return { quantos: lista.length, ativo: lista[0].ativo, justificativa: reg && reg.justificativa };
  });
  ok('o cadastro continua na base', inativado.quantos === 1);
  ok('apenas inativo', inativado.ativo === false);
  ok('e a trilha guarda o porquê', /Desligamento/.test(inativado.justificativa || ''), inativado.justificativa);

  console.log('\n--- a matriz de permissões se ajusta caixa a caixa ---');
  await pag.click('tr[data-p]:last-child [data-perm]');
  await pag.waitForTimeout(500);
  const matriz = await pag.evaluate(() => ({
    linhas: document.querySelectorAll('.modal tbody tr').length,
    caixas: document.querySelectorAll('.modal input[type=checkbox][data-m]').length,
  }));
  ok('uma linha por módulo', matriz.linhas === 8, `${matriz.linhas}`);
  ok('e uma caixa por ação', matriz.caixas === 48, `${matriz.caixas}`);
  // Desmarcar "Ver" leva a linha inteira junto: criar no que não se enxerga
  // não quer dizer nada.
  const cascata = await pag.evaluate(async () => {
    const ver = document.querySelector('.modal input[data-m="projetos"][data-a="view"]');
    ver.checked = false; ver.onchange();
    return [...document.querySelectorAll('.modal input[data-m="projetos"]')].filter((c) => c.checked).length;
  });
  ok('tirar "Ver" desliga a linha toda', cascata === 0, `${cascata}`);
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(800);
  const salva = await pag.evaluate(async () => {
    const p = (await Loja.perfisDa(empresaAtiva())).find((x) => x.tipo === 'EDIT');
    return { ve: perfilPode(p, 'projetos', 'view'), cria: perfilPode(p, 'projetos', 'create'),
      financeiro: perfilPode(p, 'financeiro', 'create') };
  });
  ok('a matriz fica gravada', salva.ve === false && salva.cria === false);
  ok('e o resto do perfil não é tocado', salva.financeiro === true);

  console.log('\n--- pré-visualizar um perfil muda a navegação de verdade ---');
  await pag.evaluate(async () => {
    // Volta o perfil de edição ao padrão, para a pré-visualização medir o que
    // o perfil de leitura esconde, e não o ajuste do teste anterior.
    const lista = (await Loja.perfisDa(empresaAtiva())).map((p) =>
      p.tipo === 'EDIT' ? { ...p, permissoes: permissoesPadrao('EDIT') } : p);
    await Loja.gravarPerfis(empresaAtiva(), lista);
    await render();
  });
  await pag.waitForTimeout(500);
  await pag.click('tr[data-p]:first-child [data-previa]');
  await pag.waitForTimeout(900);
  const previa = await pag.evaluate(() => ({
    faixa: !!document.querySelector('#faixa-previa'),
    aba: E.aba,
    modulos: [...document.querySelectorAll('#modulos button')].map((b) => b.textContent.trim()),
    abas: [...document.querySelectorAll('#abas button')].map((b) => b.textContent.trim()),
  }));
  ok('a faixa avisa que é pré-visualização', previa.faixa);
  ok('a tela de acessos sai do alcance', previa.aba !== 'acessos', previa.aba);
  ok('e a aba some da navegação', !previa.abas.includes('Usuários e acessos'), previa.abas.join(' · '));
  ok('assim como Integrações', !previa.abas.includes('Integrações'));
  ok('o que o perfil vê continua lá', previa.modulos.includes('Controle Financeiro'), previa.modulos.join(' · '));

  const travado = await pag.evaluate(async () => {
    E.aba = 'lancamentos'; await render();
    const bts = [...document.querySelectorAll('#pagina button')]
      .filter((b) => /novo lançamento|adicionar|importar|exportar/i.test(b.textContent));
    return { quantos: bts.length, travados: bts.filter((b) => b.disabled).length,
      dica: bts.length ? bts[0].title : '' };
  });
  ok('os botões de escrita ficam travados', travado.quantos > 0 && travado.travados === travado.quantos,
    `${travado.travados}/${travado.quantos}`);
  ok('e dizem por quê', /não tem esta permissão/.test(travado.dica || ''), travado.dica);

  await pag.click('#previa-sair');
  await pag.waitForTimeout(900);
  const saiu = await pag.evaluate(() => ({
    faixa: !!document.querySelector('#faixa-previa'),
    previa: E.previa,
    abasSistema: (() => { E.aba = 'acessos'; return MODULOS_NAV.find((m) => m.id === 'sistema').abas; })(),
  }));
  ok('sair da pré-visualização tira a faixa', saiu.faixa === false && saiu.previa === null);
  ok('e devolve as telas administrativas', saiu.abasSistema.includes('acessos'));

  console.log('\n--- sem erro de console no caminho todo ---');
  ok('nenhum erro de página', erros.length === 0, erros.slice(0, 3).join(' | '));

  console.log(`\n${falhas.length ? '✗ ' + falhas.length + ' falha(s):\n  - ' + falhas.join('\n  - ') : '✓ tudo certo'}`);
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
