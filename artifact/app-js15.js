// ===========================================================================
// Integrações — conexões com os sistemas de suporte e o log de eventos
// ===========================================================================
/**
 * A versão hospedada não tem servidor próprio: nenhum endereço dela recebe um
 * POST do N8N. O que ela faz, e que é o trabalho do gestor, é *definir* e
 * *conferir* a integração — qual sistema está ligado, para onde o N8N deve
 * postar, qual é o contrato do payload — e reprocessar o que chegou torto.
 *
 * Para não ser só cadastro, a tela recebe um payload colado e o passa pelo
 * MESMO tratamento que o servidor local aplica ao webhook de verdade:
 * normaliza os nomes de campo de cada origem, valida e grava o chamado pela
 * identidade `(empresa, sistema, id externo)`. Assim o contrato é testado
 * antes de o N8N entrar no ar, e o erro aparece aqui, não em produção.
 */

const TIPOS_EVENTO = ['ticket.created', 'ticket.updated', 'ticket.closed', 'ticket.test'];
const TETO_EVENTOS = 300;

/** Endereço que o N8N deve chamar no servidor local de cada origem. */
const CAMINHO_WEBHOOK = { OSTICK: '/api/webhooks/ostick', BITRIX24: '/api/webhooks/bitrix24' };

const conexaoVazia = (sistema) => ({
  sistema, ativa: false, urlBase: '', urlWebhook: '', fluxo: '', observacao: '',
});

/** Conexão gravada da origem, ou o esqueleto em branco dela. */
function conexaoDe(conexoes, sistema) {
  return conexoes.find((c) => c.sistema === sistema) || conexaoVazia(sistema);
}

// ------------------------------------------------------- contrato do payload
/**
 * De onde cada campo do sistema sai, em cada origem. É o que o gestor manda
 * para quem monta o fluxo no N8N — e é a mesma lista que `normalizarPayload`
 * consulta, para a documentação não poder discordar do código.
 */
const CAMPOS_PAYLOAD = [
  { campo:'external_id', rotulo:'Identificador do chamado', obrigatorio:true,
    ostick:['external_id','ticket_id','ticketId','number','id'], bitrix:['external_id','ID','id','TASK_ID','DEAL_ID'] },
  { campo:'title', rotulo:'Assunto', obrigatorio:true,
    ostick:['title','subject','assunto'], bitrix:['title','TITLE','NAME','assunto'] },
  { campo:'description', rotulo:'Descrição', obrigatorio:false,
    ostick:['description','body','message','descricao'], bitrix:['description','DESCRIPTION','COMMENTS','descricao'] },
  { campo:'status', rotulo:'Situação', obrigatorio:false,
    ostick:['status','status_name'], bitrix:['status','STATUS','STAGE_ID','REAL_STATUS'] },
  { campo:'priority', rotulo:'Prioridade', obrigatorio:false,
    ostick:['priority','priority_desc','prioridade'], bitrix:['priority','PRIORITY','prioridade'] },
  { campo:'sector', rotulo:'Setor', obrigatorio:false,
    ostick:['sector','setor','department','departamento','organizacao'], bitrix:['sector','setor','DEPARTMENT','UF_DEPARTMENT','GROUP_NAME'] },
  { campo:'attendant_name', rotulo:'Responsável', obrigatorio:false,
    ostick:['attendant_name','staff','assigned','atendente'], bitrix:['attendant_name','RESPONSIBLE_NAME','ASSIGNED_BY_NAME','atendente'] },
  { campo:'requester_name', rotulo:'Solicitante', obrigatorio:false,
    ostick:['requester_name','user','name','solicitante'], bitrix:['requester_name','CONTACT_NAME','CLIENT_NAME','solicitante'] },
  { campo:'requester_email', rotulo:'E-mail do solicitante', obrigatorio:false,
    ostick:['requester_email','email','user_email'], bitrix:['requester_email','CONTACT_EMAIL','EMAIL'] },
  { campo:'queue', rotulo:'Fila', obrigatorio:false, ostick:['queue','fila'], bitrix:['queue','fila','CATEGORY'] },
  { campo:'topic', rotulo:'Tópico de ajuda', obrigatorio:false,
    ostick:['topic','help_topic','topico','topic_name'], bitrix:['topic','topico','UF_TOPIC'] },
  { campo:'branch', rotulo:'Filial', obrigatorio:false,
    ostick:['branch','filial','unidade'], bitrix:['branch','filial','UF_BRANCH','unidade'] },
  { campo:'opened_at', rotulo:'Aberto em', obrigatorio:false,
    ostick:['opened_at','created','created_at','aberto_em'], bitrix:['opened_at','CREATED_TIME','DATE_CREATE','aberto_em'] },
  { campo:'closed_at', rotulo:'Fechado em', obrigatorio:false,
    ostick:['closed_at','closed','fechado_em'], bitrix:['closed_at','CLOSED_TIME','DATE_CLOSED','fechado_em'] },
  { campo:'due_at', rotulo:'Prazo', obrigatorio:false,
    ostick:['due_at','duedate','est_duedate','prazo'], bitrix:['due_at','DEADLINE','UF_DEADLINE','prazo'] },
  { campo:'hours', rotulo:'Horas gastas', obrigatorio:false,
    ostick:['hours','horas'], bitrix:['hours','TIME_SPENT','horas'] },
];

const chavesDe = (linha, sistema) => (sistema === 'BITRIX24' ? linha.bitrix : linha.ostick);

/** Primeiro valor presente entre as chaves aceitas. */
function primeiroCampo(p, chaves) {
  for (const c of chaves) {
    const v = p[c];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/** Vocabulário único de situação — o mesmo do servidor. */
function situacaoUnica(bruto) {
  const t = String(bruto || '').toLowerCase();
  if (!t) return 'open';
  if (['open','in_progress','resolved','closed'].includes(t)) return t;
  if (/fechad|closed|encerrad|cancelad|finalizad/.test(t)) return 'closed';
  if (/resolvid|resolved|conclu|atendid|success/.test(t)) return 'resolved';
  if (/andamento|progress|process|aguardando|em curso/.test(t)) return 'in_progress';
  return 'open';
}

/** Vocabulário único de prioridade — idem. */
function prioridadeUnica(bruto) {
  const t = String(bruto || '').toLowerCase();
  if (!t) return 'medium';
  if (['low','medium','high','urgent'].includes(t)) return t;
  if (/urgen|critic|imediat/.test(t)) return 'urgent';
  if (/alta|high/.test(t)) return 'high';
  if (/baixa|low/.test(t)) return 'low';
  return 'medium';
}

/** Data legível como ISO curto; o que não for data vira nulo em vez de lixo. */
function dataDoPayload(bruto) {
  const t = String(bruto ?? '').trim();
  if (!t) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}T${br[4] || '00'}:${br[5] || '00'}` : t;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16) + 'Z';
}

/** Payload bruto da origem para o modelo único do sistema. */
function normalizarPayload(sistema, p) {
  const saida = { source_system: sistema };
  for (const linha of CAMPOS_PAYLOAD) saida[linha.campo] = primeiroCampo(p, chavesDe(linha, sistema));
  saida.status = situacaoUnica(saida.status);
  saida.priority = prioridadeUnica(saida.priority);
  saida.sector = saida.sector || 'Não classificado';
  for (const c of ['opened_at','closed_at','due_at']) saida[c] = dataDoPayload(saida[c]);
  saida.hours = saida.hours === null ? null : (Number(String(saida.hours).replace(',', '.')) || null);
  return saida;
}

/** O que falta para o payload ser aceito. Vazio quer dizer pronto. */
function faltasDoPayload(c) {
  const faltando = [];
  if (!c.external_id) faltando.push('external_id (identificador do chamado no sistema de origem)');
  if (!c.title) faltando.push('title (assunto do chamado)');
  return faltando;
}

/**
 * Grava o chamado pela identidade dele na origem — `(empresa, sistema, id
 * externo)`. É o que faz a reentrega do mesmo evento, que toda fila de
 * integração pode fazer, atualizar o registro em vez de criar um segundo.
 */
async function gravarChamadoDoEvento(empresa, c) {
  // "Dentro do SLA" sai do prazo quando ele existe; sem prazo, o fechado conta
  // como dentro e o ainda aberto fica de fora — que é o que a operação sente.
  const referencia = c.closed_at || new Date().toISOString().slice(0, 16) + 'Z';
  const dentro = c.due_at ? (referencia <= c.due_at ? 1 : 0) : (c.closed_at ? 1 : 0);
  const competencia = (c.opened_at || new Date().toISOString()).slice(0, 7);

  const registro = {
    id: c.source_system + '-' + c.external_id,
    sistema: c.source_system, ticketId: c.external_id, numero: c.external_id,
    assunto: c.title, descricao: c.description, status: c.status, nivel: c.priority,
    setor: c.sector, solicitante: c.requester_name, email: c.requester_email,
    atendente: c.attendant_name, fila: c.queue || 'Integração', topico: c.topic,
    filial: c.branch, criadoEm: c.opened_at, fechadoEm: c.closed_at, prazoEm: c.due_at,
    horas: c.hours, origem: 'integracao', total: 1, dentro,
  };

  const todos = await Loja.slaDa(empresa);
  const anterior = todos.find((s) => s.id === registro.id);
  const criado = !anterior;

  // Mudou de competência? O registro sai do mês antigo antes de entrar no novo,
  // senão o mesmo chamado seria contado duas vezes no período.
  if (anterior && anterior.competencia !== competencia) {
    const sobra = todos.filter((s) => s.competencia === anterior.competencia && s.id !== registro.id)
      .map(({ competencia: _c, ...r }) => r);
    await Loja.gravarSlaMes(empresa, anterior.competencia, sobra);
  }
  const atuais = (await Loja.slaDa(empresa)).filter((s) => s.competencia === competencia && s.id !== registro.id)
    .map(({ competencia: _c, ...r }) => r);
  await Loja.gravarSlaMes(empresa, competencia, [...atuais, registro]);
  return { criado, competencia, registro };
}

/** Registra o evento e processa; erro não some, fica no log com o motivo. */
async function processarEventoIntegracao(empresa, { sistema, tipo, payload, teste, id }) {
  const eventos = await Loja.eventosDa(empresa);
  const normalizado = normalizarPayload(sistema, payload);
  const evento = {
    id: id || novoId(), quando: new Date().toISOString(), sistema, tipo: tipo || 'ticket.updated',
    externalId: normalizado.external_id || '', teste: !!teste, payload,
    status: 'recebido', mensagem: null, competencia: null, criado: null,
  };
  const faltando = faltasDoPayload(normalizado);
  if (faltando.length) {
    evento.status = 'erro';
    evento.mensagem = 'Payload incompleto. Faltando: ' + faltando.join('; ') + '.';
  } else {
    try {
      const r = await gravarChamadoDoEvento(empresa, normalizado);
      evento.status = 'processado';
      evento.competencia = r.competencia;
      evento.criado = r.criado;
      evento.mensagem = (r.criado ? 'Chamado criado' : 'Chamado atualizado') +
        ' em ' + mesExib(r.competencia) + ' — setor ' + (normalizado.sector) + '.';
    } catch (e) {
      evento.status = 'erro';
      evento.mensagem = e && e.message ? e.message : String(e);
    }
  }
  const restantes = eventos.filter((x) => x.id !== evento.id);
  await Loja.gravarEventos(empresa, [evento, ...restantes].slice(0, TETO_EVENTOS));
  await Loja.auditar({ acao: evento.status === 'erro' ? 'recusar' : 'receber', entidade:'evento_integracao',
    id: evento.id, depois:{ sistema, tipo: evento.tipo, externalId: evento.externalId, status: evento.status } }, empresa);
  return evento;
}

/** Payload de exemplo com os nomes de campo que o sistema de verdade usa. */
function payloadDeExemplo(sistema) {
  const agora = new Date().toISOString();
  const marca = Date.now().toString().slice(-6);
  return sistema === 'BITRIX24'
    ? { ID:`TESTE-${marca}`, TITLE:'Chamado de teste da integração',
        COMMENTS:'Disparado pela tela de Integrações para validar o fluxo ponta a ponta.',
        STAGE_ID:'NEW', PRIORITY:'1', UF_DEPARTMENT:'Tecnologia da Informação',
        ASSIGNED_BY_NAME:'Integração', CONTACT_NAME:'Teste', CONTACT_EMAIL:'teste@exemplo.local',
        CREATED_TIME: agora }
    : { ticket_id:`TESTE-${marca}`, number:`TESTE-${marca}`, subject:'Chamado de teste da integração',
        body:'Disparado pela tela de Integrações para validar o fluxo ponta a ponta.',
        status:'open', priority:'Normal', department:'Tecnologia da Informação',
        staff:'Integração', name:'Teste', email:'teste@exemplo.local', created: agora };
}

// ----------------------------------------------------------------- a tela
async function viewIntegracoes() {
  await Loja.configuracao();
  // A CONFIGURAÇÃO é do cliente: endereço, webhook e interruptor são os mesmos
  // para todas as unidades dele. O DESTINO do chamado continua sendo uma
  // unidade — cada uma tem a própria instância do helpdesk, e o mesmo número de
  // chamado em duas delas não é o mesmo chamado —, e ela se escolhe aqui,
  // não num filtro no topo do sistema.
  const cliente = E.clienteSel;
  if (!cliente) {
    el('#pagina').innerHTML = `<div class="msg alerta"><strong>Escolha um cliente.</strong>
      A integração é do contratante: é ele quem contrata o helpdesk.</div>`;
    return;
  }
  const unidades = empresasDoCliente(cliente);
  const emp = empresaAtiva();
  if (!emp) {
    el('#pagina').innerHTML = `<div class="msg alerta"><strong>Este cliente ainda não tem unidade cadastrada.</strong>
      O chamado precisa de uma unidade de destino. Cadastre a matriz em <strong>Clientes e unidades</strong>.</div>`;
    return;
  }
  const conexoes = await Loja.integracoesDa(cliente);
  const eventos = await Loja.eventosDoCliente(cliente);
  const sistemas = Object.keys(SISTEMAS_SUPORTE);
  const agora = Date.now();
  const dia = 24 * 60 * 60 * 1000;

  const situacao = sistemas.map((s) => {
    const c = conexaoDe(conexoes, s);
    const meus = eventos.filter((e) => e.sistema === s);
    const ultimo = meus[0] || null;
    const pendencias = [];
    if (!c.ativa) pendencias.push('conexão não está marcada como ativa');
    if (!c.urlBase) pendencias.push('endereço do chamado em branco — o número não vira link');
    if (!c.urlWebhook) pendencias.push('endereço do webhook em branco — o N8N não sabe para onde postar');
    if (!meus.length) pendencias.push('nenhum evento recebido até agora');
    const erros = meus.filter((e) => e.status === 'erro').length;
    if (erros) pendencias.push(inteiro(erros) + ' evento(s) com erro à espera de reprocessamento');
    const recente = ultimo && (agora - new Date(ultimo.quando).getTime()) < dia;
    return { sistema: s, conexao: c, ultimo, total: meus.length, erros, pendencias, recente };
  });

  const kpi = (r, n, a, classe) => `<div class="kpi"><span class="r">${esc(r)}</span>
    <span class="n"${classe?` style="color:var(--${classe})"`:''}>${n}</span><span class="a">${esc(a)}</span></div>`;

  const cartaoSituacao = (s) => {
    const cor = s.pendencias.length === 0 ? 'bom' : (s.erros ? 'crit' : 'alerta');
    const rotulo = s.pendencias.length === 0 ? 'Pronta' : (s.erros ? 'Com erro' : 'Incompleta');
    return `<section class="bloco" data-sit="${s.sistema}">
      <header><h2>${esc(SISTEMAS_SUPORTE[s.sistema])}</h2>
        <span class="tag ${cor}"><i style="background:var(--${cor==='bom'?'bom':cor==='crit'?'crit':'alerta'})"></i>${rotulo}</span>
        <span class="nota">${inteiro(s.total)} evento(s)</span></header>
      <dl class="par">
        <dt>Endereço do chamado</dt><dd>${s.conexao.urlBase ? `<code>${esc(s.conexao.urlBase)}</code>` : '<span class="vazio2">não definido</span>'}</dd>
        <dt>Webhook que o N8N chama</dt><dd>${s.conexao.urlWebhook ? `<code>${esc(s.conexao.urlWebhook)}</code>` : '<span class="vazio2">não definido</span>'}</dd>
        <dt>Fluxo no N8N</dt><dd>${s.conexao.fluxo ? esc(s.conexao.fluxo) : '<span class="vazio2">não informado</span>'}</dd>
        <dt>Último evento</dt><dd>${s.ultimo
          ? `${new Date(s.ultimo.quando).toLocaleString('pt-BR')} · ${esc(s.ultimo.status)}${s.recente ? ' · nas últimas 24h' : ''}`
          : '<span class="vazio2">nenhum</span>'}</dd>
      </dl>
      ${s.pendencias.length
        ? `<div class="msg ${s.erros ? 'erro' : 'alerta'}" style="margin-top:10px"><strong>Falta resolver:</strong>
             ${s.pendencias.map((p)=>esc(p)).join(' · ')}</div>`
        : '<div class="msg bom" style="margin-top:10px">Conexão definida e recebendo. Nada pendente.</div>'}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="bt" data-editar="${s.sistema}">Editar conexão</button>
        <button class="bt" data-contrato="${s.sistema}">Contrato do payload</button>
        <button class="bt pri" data-teste="${s.sistema}">Enviar payload de teste</button>
      </div></section>`;
  };

  const processados = eventos.filter((e) => e.status === 'processado').length;
  const comErro = eventos.filter((e) => e.status === 'erro').length;
  const ultimas24 = eventos.filter((e) => (agora - new Date(e.quando).getTime()) < dia).length;

  el('#pagina').innerHTML = `
    <div class="msg"><strong>Esta versão hospedada não recebe o POST do N8N.</strong>
      Ela define a conexão, publica o contrato do payload e passa o que você colar aqui pelo mesmo tratamento que o
      servidor local aplica ao webhook de verdade — normalização, validação e gravação por
      <code>(empresa, sistema, id externo)</code>. O recebimento contínuo e automático roda no servidor local, em
      <code>${esc(CAMINHO_WEBHOOK.OSTICK)}</code> e <code>${esc(CAMINHO_WEBHOOK.BITRIX24)}</code>.
      O segredo de cada conexão vive só na variável de ambiente do servidor: nada de segredo é guardado aqui.</div>

    <div class="kpis">
      ${kpi('Eventos registrados', inteiro(eventos.length), 'de todas as origens')}
      ${kpi('Processados', inteiro(processados), 'chamado criado ou atualizado')}
      ${kpi('Com erro', inteiro(comErro), comErro ? 'aguardam reprocessamento' : 'nenhum pendente', comErro ? 'crit' : '')}
      ${kpi('Nas últimas 24h', inteiro(ultimas24), 'sinal de que o fluxo está vivo')}
    </div>

    <div class="grade g2" style="margin-top:16px">${situacao.map(cartaoSituacao).join('')}</div>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Simular o recebimento de um evento</h2>
        <span class="nota">mesmo tratamento do webhook do servidor</span></header>
      <div class="msg">Cole o JSON que o fluxo do N8N vai postar. O que entrar aqui é gravado como chamado de
        verdade nesta base — use o payload de teste enquanto estiver validando o contrato.</div>
      <div class="filtros" style="margin-top:12px;box-shadow:none;border:0;padding:0">
        <div class="campo" style="width:220px"><label for="ev-destino">Unidade de destino</label>
          <select id="ev-destino">${unidades.map((u)=>`<option value="${esc(u.id)}"${u.id===emp?' selected':''}>${esc(u.nome)}</option>`).join('')}</select>
          <small class="dica-filtro">Em qual unidade o chamado será criado. Não muda a configuração — só o destino deste envio.</small></div>
        <div class="campo" style="width:200px"><label for="ev-sistema">Sistema de origem</label>
          <select id="ev-sistema">${sistemas.map((s)=>`<option value="${s}">${esc(SISTEMAS_SUPORTE[s])}</option>`).join('')}</select></div>
        <div class="campo" style="width:200px"><label for="ev-tipo">Tipo de evento</label>
          <select id="ev-tipo">${TIPOS_EVENTO.map((t)=>`<option value="${t}"${t==='ticket.created'?' selected':''}>${esc(t)}</option>`).join('')}</select></div>
        <button class="bt" id="ev-exemplo">Preencher com o exemplo</button>
        <button class="bt" id="ev-baixar">Baixar o exemplo (.json)</button>
        <button class="bt pri" id="ev-enviar">Processar</button>
      </div>
      <div class="campo" style="margin-top:10px"><label for="ev-payload">Payload (JSON)</label>
        <textarea id="ev-payload" rows="9" spellcheck="false"
          style="font-family:var(--mono);font-size:12.5px">${esc(JSON.stringify(payloadDeExemplo('OSTICK'), null, 2))}</textarea></div>
      <div class="msg" id="ev-saida" hidden style="margin-top:10px"></div>
    </section>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Eventos recebidos</h2><span class="nota">${inteiro(eventos.length)} registro(s), mais recentes primeiro</span></header>
      ${eventos.length === 0 ? '<p class="vazio">Nenhum evento registrado neste cliente.</p>' : `
      <div class="rol"><table><thead><tr>
        <th>Quando</th><th>Unidade</th><th>Sistema</th><th>Tipo</th><th>Id externo</th><th>Situação</th><th>Resultado</th><th></th>
      </tr></thead><tbody>
        ${eventos.slice(0, 100).map((e)=>`<tr data-ev="${esc(e.id)}">
          <td style="white-space:nowrap">${new Date(e.quando).toLocaleString('pt-BR')}</td>
          <td style="white-space:nowrap">${esc(nomeEmpresa(e.empresa))}</td>
          <td style="white-space:nowrap">${esc(SISTEMAS_SUPORTE[e.sistema] || e.sistema)}</td>
          <td><code>${esc(e.tipo)}</code>${e.teste ? ' <span class="tag alerta">teste</span>' : ''}</td>
          <td><code>${esc(e.externalId || '—')}</code></td>
          <td><span class="tag ${e.status==='processado'?'bom':e.status==='erro'?'crit':''}">${esc(e.status)}</span></td>
          <td>${esc(e.mensagem || '—')}</td>
          <td style="white-space:nowrap"><button class="bt fant peq" data-ver>Ver payload</button>
            ${e.status==='erro' ? '<button class="bt fant peq" data-refazer>Reprocessar</button>' : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>`}
    </section>`;

  // ------------------------------------------------------------- ligações
  el('#pagina').querySelectorAll('[data-editar]').forEach((b) =>
    b.onclick = () => formConexao(cliente, conexaoDe(conexoes, b.dataset.editar)));
  el('#pagina').querySelectorAll('[data-contrato]').forEach((b) =>
    b.onclick = () => verContrato(b.dataset.contrato));
  el('#pagina').querySelectorAll('[data-teste]').forEach((b) =>
    b.onclick = () => confirmar({
      titulo: 'Enviar payload de teste',
      mensagem: `Um chamado de teste será criado na unidade ${esc(nomeEmpresa(destinoDoTeste()))}, em ` +
        `${esc(SISTEMAS_SUPORTE[b.dataset.teste])}. ` +
        'Ele fica marcado como teste no log de eventos e com o assunto "Chamado de teste da integração", ' +
        'para dar para achá-lo e apagá-lo depois.',
      rotulo: 'Enviar',
      async aoConfirmar() {
        await processarEventoIntegracao(destinoDoTeste(), {
          sistema: b.dataset.teste, tipo: 'ticket.test', payload: payloadDeExemplo(b.dataset.teste), teste: true });
        render();
      } }));

  // A unidade de destino do envio: o campo da tela, ou a em foco.
  const destinoDoTeste = () => (el('#ev-destino') && el('#ev-destino').value) || emp;

  const saida = el('#ev-saida');
  const dizer = (classe, html) => { saida.hidden = false; saida.className = 'msg ' + classe; saida.innerHTML = html; };
  el('#ev-sistema').onchange = () => {
    el('#ev-payload').value = JSON.stringify(payloadDeExemplo(el('#ev-sistema').value), null, 2);
  };
  el('#ev-exemplo').onclick = () => {
    el('#ev-payload').value = JSON.stringify(payloadDeExemplo(el('#ev-sistema').value), null, 2);
    dizer('', 'Exemplo carregado. O identificador muda a cada geração, para não colidir com o teste anterior.');
  };
  el('#ev-baixar').onclick = async () => {
    try {
      const sistema = el('#ev-sistema').value;
      const downloads = await window.claude?.use?.('downloads');
      if (!downloads) throw new Error('Esta visualização não pode salvar arquivos. Abra o sistema pelo link do artifact.');
      await downloads.save({ filename: `payload-${sistema.toLowerCase()}.json`,
        data: JSON.stringify(payloadDeExemplo(sistema), null, 2) });
      dizer('bom', 'Arquivo salvo. Entregue-o a quem monta o fluxo no N8N.');
    } catch (e) {
      if (e && e.code === 'declined') return dizer('', 'Download cancelado.');
      dizer('erro', esc(e.message || e));
    }
  };
  el('#ev-enviar').onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      let payload;
      try { payload = JSON.parse(el('#ev-payload').value); }
      catch { throw new Error('O texto não é um JSON válido. Confira aspas, vírgulas e chaves.'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('O payload precisa ser um objeto JSON — um chamado por evento.');
      }
      const evento = await processarEventoIntegracao(destinoDoTeste(), {
        sistema: el('#ev-sistema').value, tipo: el('#ev-tipo').value, payload });
      if (evento.status === 'erro') dizer('erro', `<strong>Recusado.</strong> ${esc(evento.mensagem)}`);
      else dizer('bom', `<strong>Processado.</strong> ${esc(evento.mensagem)}`);
      render();
    } catch (e) {
      dizer('erro', esc(e.message || e));
      ev.target.disabled = false;
    }
  };

  el('#pagina').querySelectorAll('tr[data-ev]').forEach((tr) => {
    const evento = eventos.find((x) => x.id === tr.dataset.ev);
    tr.querySelector('[data-ver]').onclick = () => abrirModal({
      titulo: 'Payload do evento', tipo: 'payload-integracao',
      corpo: `<div class="msg">Recebido em ${new Date(evento.quando).toLocaleString('pt-BR')} ·
          ${esc(SISTEMAS_SUPORTE[evento.sistema] || evento.sistema)} · <code>${esc(evento.tipo)}</code></div>
        <pre style="margin-top:10px;white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:12.5px">${esc(JSON.stringify(evento.payload, null, 2))}</pre>`,
      acoes: '<button type="button" class="bt" data-c>Fechar</button>',
      aoMontar({ raiz, fechar }) { raiz.querySelector('[data-c]').onclick = fechar; },
    });
    const refazer = tr.querySelector('[data-refazer]');
    if (refazer) refazer.onclick = async () => {
      refazer.disabled = true;
      // Reprocessar refaz o MESMO evento a partir do payload guardado: o id não
      // muda, para o log não virar uma fila de tentativas do mesmo chamado.
      // Reprocessa na unidade DO EVENTO: o chamado é da unidade que o recebeu.
      await processarEventoIntegracao(evento.empresa || emp, { sistema: evento.sistema, tipo: evento.tipo,
        payload: evento.payload, teste: evento.teste, id: evento.id });
      render();
    };
  });
}

/** Cadastro da conexão de uma origem. */
/**
 * A conexão de uma origem — do CLIENTE, não da unidade.
 *
 * Endereço, webhook e interruptor valem para todas as unidades do contratante:
 * é ele quem contrata o helpdesk, e repetir a configuração por matriz era o
 * que prendia esta tela a um seletor de empresa.
 */
function formConexao(cliente, conexao) {
  const sugestao = 'https://servidor-da-empresa' + CAMINHO_WEBHOOK[conexao.sistema];
  abrirModal({
    titulo: 'Conexão — ' + SISTEMAS_SUPORTE[conexao.sistema],
    tipo: 'conexao-integracao',
    corpo: `
      <div class="msg">Esta conexão é do <strong>cliente</strong> e vale para todas as unidades dele.
        O endereço do chamado é o que transforma o número em link nas telas de suporte.
        O endereço do webhook é o que você entrega a quem monta o fluxo no N8N.</div>
      <div class="campo"><label for="cx-base">Endereço do chamado (o id entra no fim)</label>
        <input id="cx-base" name="base" value="${esc(conexao.urlBase)}" placeholder="https://.../tickets.php?id="></div>
      <div class="campo"><label for="cx-hook">Endereço do webhook no servidor</label>
        <input id="cx-hook" name="hook" value="${esc(conexao.urlWebhook)}" placeholder="${esc(sugestao)}"></div>
      <div class="campo"><label for="cx-fluxo">Fluxo no N8N (nome ou id)</label>
        <input id="cx-fluxo" name="fluxo" value="${esc(conexao.fluxo)}"></div>
      <div class="campo"><label for="cx-obs">Observação</label>
        <textarea id="cx-obs" name="obs" rows="2">${esc(conexao.observacao || '')}</textarea></div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px">
        <input type="checkbox" id="cx-ativa" name="ativa"${conexao.ativa ? ' checked' : ''}> Conexão ativa</label>`,
    acoes: '<button type="button" class="bt" data-c>Cancelar</button><button type="button" class="bt pri" data-s>Salvar</button>',
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const base = campo('base').value.trim();
          const hook = campo('hook').value.trim();
          const endereco = (v, nome) => {
            if (v && !/^https?:\/\//i.test(v)) throw new Error(`O ${nome} precisa começar com http:// ou https://.`);
          };
          endereco(base, 'endereço do chamado');
          endereco(hook, 'endereço do webhook');
          const ativa = campo('ativa').checked;
          if (ativa && !hook) throw new Error('Uma conexão ativa precisa do endereço do webhook — sem ele o N8N não tem para onde postar.');
          const nova = { sistema: conexao.sistema, ativa, urlBase: base, urlWebhook: hook,
            fluxo: campo('fluxo').value.trim(), observacao: campo('obs').value.trim() };
          const atuais = (await Loja.integracoesDa(cliente)).filter((c) => c.sistema !== conexao.sistema);
          await Loja.gravarIntegracoes(cliente, [...atuais, nova]);
          // O link do chamado já lia a configuração antiga: manter as duas em
          // dia evita a tela de suporte discordar da tela de integração.
          if (base) {
            await Loja.gravarConfiguracao(conexao.sistema === 'BITRIX24' ? { urlBitrix24: base } : { urlOsTicket: base });
          }
          await Loja.auditar({ acao:'atualizar', entidade:'conexao_integracao', id: conexao.sistema,
            antes: conexao, depois: nova }, empresaAtiva());
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

/** O contrato do payload da origem, em tela, para entregar a quem monta o fluxo. */
function verContrato(sistema) {
  abrirModal({
    titulo: 'Contrato do payload — ' + SISTEMAS_SUPORTE[sistema],
    tipo: 'contrato-integracao',
    corpo: `
      <div class="msg">Cada campo do sistema aceita mais de um nome na origem: o fluxo pode mandar o nome do
        helpdesk ou o nome já traduzido. O primeiro preenchido vence, na ordem em que aparecem.</div>
      <div class="rol" style="margin-top:10px"><table><thead><tr>
        <th>Campo do sistema</th><th>Significado</th><th>Nomes aceitos no payload</th></tr></thead><tbody>
        ${CAMPOS_PAYLOAD.map((l)=>`<tr>
          <td><code>${esc(l.campo)}</code>${l.obrigatorio?' <span class="tag crit">obrigatório</span>':''}</td>
          <td>${esc(l.rotulo)}</td>
          <td><code>${esc(chavesDe(l, sistema).join(', '))}</code></td></tr>`).join('')}
      </tbody></table></div>
      <div class="msg" style="margin-top:10px"><strong>Identidade do chamado:</strong>
        <code>(empresa, ${esc(sistema)}, external_id)</code>. Reenviar o mesmo evento atualiza o registro em vez de
        criar um segundo — é o que permite ao N8N reentregar sem medo.</div>`,
    acoes: '<button type="button" class="bt" data-c>Fechar</button>',
    aoMontar({ raiz, fechar }) { raiz.querySelector('[data-c]').onclick = fechar; },
  });
}
