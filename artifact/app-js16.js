// ===========================================================================
// Usuários e acessos — quem entra, com qual perfil, e o que cada perfil faz
// ===========================================================================
/**
 * O perfil mora no vínculo do usuário com a EMPRESA, não no usuário: o sistema
 * é multi-tenant por regra, e a mesma pessoa pode ser gestora numa empresa e
 * leitora em outra.
 *
 * Autenticação de verdade — senha, sessão, bloqueio — é do servidor local, que
 * é quem recusa a requisição. Esta tela é o cadastro que governa aquele
 * servidor, mais a pré-visualização do que cada perfil enxerga. A tela diz isso
 * em voz alta: prometer barreira onde não há seria pior que não ter a tela.
 */

const MODULOS_ACESSO = [
  { id:'financeiro',        rotulo:'Financeiro',        abas:['painel','lancamentos','conferencia'] },
  { id:'relatorios',        rotulo:'Relatórios',        abas:['relatorio', 'indicadores_gerais'] },
  { id:'projetos',          rotulo:'Projetos',          abas:['projetos'] },
  { id:'suporte_ostick',    rotulo:'Suporte (OStick)',  abas:['sla','chamados','OSTICK'] },
  { id:'suporte_bitrix24',  rotulo:'Suporte (Bitrix24)',abas:['BITRIX24'] },
  { id:'integracoes',       rotulo:'Integrações',       abas:['integracoes'] },
  { id:'usuarios',          rotulo:'Usuários e Acessos',abas:['acessos'] },
  { id:'configuracoes',     rotulo:'Configurações',     abas:['dados','cadastros','auditoria'] },
];

const ACOES_ACESSO = [
  { id:'view',   rotulo:'Ver' },
  { id:'create', rotulo:'Criar' },
  { id:'edit',   rotulo:'Editar' },
  { id:'delete', rotulo:'Excluir' },
  { id:'export', rotulo:'Exportar' },
  { id:'import', rotulo:'Importar' },
];

const PERFIL_LEITURA = 'Somente Visualização';
const PERFIL_EDICAO = 'Edição';
// Administrar acesso e integração é do gestor: quem só lê não precisa saber
// nem que a tela existe, e quem edita não se dá permissão a si mesmo.
const MODULOS_ADMINISTRATIVOS = new Set(['usuarios', 'integracoes']);

/** Matriz de permissões de um perfil padrão, pela regra do servidor. */
function permissoesPadrao(tipo) {
  const m = {};
  for (const mod of MODULOS_ACESSO) {
    m[mod.id] = {};
    for (const a of ACOES_ACESSO) {
      m[mod.id][a.id] = tipo === 'VIEW_ONLY'
        ? (a.id === 'view' && !MODULOS_ADMINISTRATIVOS.has(mod.id))
        : mod.id !== 'usuarios';
    }
  }
  return m;
}

/** Os dois perfis que toda empresa tem ao abrir a tela pela primeira vez. */
async function garantirPerfisPadrao(empresa) {
  const atuais = await Loja.perfisDa(empresa);
  const falta = [
    { nome: PERFIL_LEITURA, tipo: 'VIEW_ONLY' },
    { nome: PERFIL_EDICAO,  tipo: 'EDIT' },
  ].filter((p) => !atuais.some((x) => x.nome === p.nome));
  // Sem escrita, devolve o que existe: a tela é alcançável por quem edita, e
  // insistir na gravação só trocaria a lista por um erro.
  if (!falta.length || E.somenteLeitura) return atuais;
  const novos = falta.map((p) => ({ id: novoId(), nome: p.nome, tipo: p.tipo, padrao: true,
    permissoes: permissoesPadrao(p.tipo), criadoEm: new Date().toISOString() }));
  const lista = [...atuais, ...novos];
  await Loja.gravarPerfis(empresa, lista);
  return lista;
}

const perfilDe = (perfis, id) => perfis.find((p) => p.id === id) || null;

/** Um perfil pode a ação no módulo? Perfil ausente não pode nada. */
function perfilPode(perfil, modulo, acao) {
  if (!perfil) return false;
  const m = perfil.permissoes && perfil.permissoes[modulo];
  return !!(m && m[acao]);
}

/** Quantas das 48 combinações o perfil concede — o resumo que cabe na lista. */
function contarPermissoes(perfil) {
  let n = 0;
  for (const m of MODULOS_ACESSO) for (const a of ACOES_ACESSO) if (perfilPode(perfil, m.id, a.id)) n++;
  return n;
}

// ------------------------------------------------------- pré-visualização
/**
 * `E.previa` guarda o perfil que está sendo pré-visualizado. Com ele ligado, a
 * navegação esconde o que o perfil não vê e os botões de escrita ficam
 * desabilitados — o mesmo efeito que o servidor produz de verdade. É explícito
 * e reversível num clique: a faixa fica no topo da tela enquanto durar.
 */
function modulosDaAba(aba) {
  return MODULOS_ACESSO.filter((m) => m.abas.includes(aba)).map((m) => m.id);
}

/** A aba é visível no recorte atual? Sem pré-visualização, tudo é visível. */
function abaVisivel(aba) {
  if (!E.previa) return true;
  const mods = modulosDaAba(aba);
  if (!mods.length) return true;
  return mods.some((m) => perfilPode(E.previa, m, 'view'));
}

/** A ação é permitida na tela atual? Sem pré-visualização, tudo é permitido. */
function podeNaAba(acao, aba = E.aba) {
  if (!E.previa) return true;
  const mods = modulosDaAba(aba);
  if (!mods.length) return true;
  return mods.some((m) => perfilPode(E.previa, m, acao));
}

function pintarPrevia() {
  const anterior = el('#faixa-previa');
  if (anterior) anterior.remove();
  if (!E.previa) return;
  const faixa = document.createElement('div');
  faixa.id = 'faixa-previa';
  faixa.className = 'faixa-previa';
  // Duas faixas parecidas, com naturezas opostas: a pré-visualização é uma
  // escolha de quem administra, e sai num clique; o modo leitura é imposto de
  // fora e não tem como sair — oferecer um botão de sair seria mentira.
  if (E.somenteLeitura) {
    faixa.innerHTML = `<span><strong>Acesso de leitura.</strong>
      Este link foi compartilhado com você para consulta: os dados aparecem inteiros, e nada aqui altera a base.
      Para lançar ou editar, peça a quem compartilhou o acesso de edição.</span>`;
    el('#pagina').before(faixa);
    return;
  }
  faixa.innerHTML = `<span><strong>Pré-visualizando como “${esc(E.previa.nome)}”.</strong>
    A navegação e os botões seguem este perfil. Nada foi alterado no seu acesso.</span>
    <button type="button" class="bt peq" id="previa-sair">Sair da pré-visualização</button>`;
  el('#pagina').before(faixa);
  el('#previa-sair').onclick = () => {
    E.previa = null;
    try { localStorage.removeItem('iarx-previa'); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
    if (!ABAS.some((a) => a.id === E.aba)) E.aba = ABAS[0].id;
    render();
  };
}

/**
 * O perfil sintético de quem abriu um link compartilhado só para ver. Não é
 * cadastro: não fica na base, não aparece na lista de perfis, e ninguém o
 * escolhe. É a tradução, para a linguagem de perfil que a tela já entende, do
 * que o armazenamento decidiu lá atrás.
 */
const PERFIL_LEITURA_COMPARTILHADA = () => ({
  id: '(leitura-compartilhada)', nome: 'Somente leitura (acesso compartilhado)',
  tipo: 'VIEW_ONLY', padrao: false, permissoes: permissoesPadrao('VIEW_ONLY'),
});

/**
 * Descobre se esta visualização pode escrever. Sem a capacidade de identidade
 * do visualizador, não há a quem perguntar: a página descobre tentando, com
 * uma gravação de sonda que o dono e os editores concluem e quem só vê tem
 * recusada. É uma escrita por abertura, num documento que não é de negócio.
 */
async function apurarEscrita() {
  try {
    await E.db.doc('sonda/escrita').set({ quando: new Date().toISOString() });
    E.somenteLeitura = false;
  } catch (e) {
    // Qualquer recusa vale como "não escreve": distinguir o motivo não mudaria
    // o que a tela faz, e insistir só produziria o mesmo erro de novo.
    E.somenteLeitura = true;
    E.previa = PERFIL_LEITURA_COMPARTILHADA();
  }
}

/**
 * Desabilita, na tela já montada, o que o perfil não faz.
 *
 * Duas passagens, e a ordem importa. `data-escreve` é declaração de quem
 * montou o controle e nomeia a AÇÃO — é o que vale onde a trava deixou de ser
 * cosmética, como a exportação da base num link compartilhado só para ver. O
 * rótulo é a rede embaixo, para o controle que ninguém marcou: adivinha, e
 * adivinhar é melhor que deixar passar.
 */
function aplicarPreviaNaTela() {
  if (!E.previa) return;
  const bloqueadas = new Set(['create', 'edit', 'delete', 'export', 'import'].filter((a) => !podeNaAba(a)));
  if (!bloqueadas.size) return;
  const motivo = `O perfil “${E.previa.nome}” não tem esta permissão.`;
  const travar = (c) => { c.disabled = true; c.title = motivo; };

  el('#pagina').querySelectorAll('[data-escreve]').forEach((c) => {
    if (bloqueadas.has(c.dataset.escreve)) travar(c);
  });
  el('#pagina').querySelectorAll('button:not([data-escreve])').forEach((b) => {
    const texto = (b.textContent || '').toLowerCase();
    if (/adicionar|novo|nova|salvar|lançar|registrar|importar|exportar|baixar|gerar arquivo|gravar|excluir|reabrir|fechar compet|processar|enviar|editar|duplicar|inativar|reativar/.test(texto)) travar(b);
  });
}

// ----------------------------------------------------------------- a tela
async function viewAcessos() {
  const emp = empresaAtiva();
  if (!emp) {
    el('#pagina').innerHTML = `<div class="msg alerta"><strong>O acesso é de uma empresa por vez.</strong>
      Há ${inteiro(E.empresasSel.size)} empresas selecionadas — o perfil mora no vínculo da pessoa com a empresa, e a
      mesma pessoa pode ser gestora numa e leitora em outra. Deixe uma só marcada no seletor
      <strong>Empresa</strong>.</div>`;
    return;
  }
  const perfis = await garantirPerfisPadrao(emp);
  const usuarios = (await Loja.usuariosDa(emp)).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const ativos = usuarios.filter((u) => u.ativo !== false);
  const semPerfil = usuarios.filter((u) => !perfilDe(perfis, u.perfil)).length;

  const kpi = (r, n, a, cor) => `<div class="kpi"><span class="r">${esc(r)}</span>
    <span class="n"${cor?` style="color:var(--${cor})"`:''}>${n}</span><span class="a">${esc(a)}</span></div>`;

  el('#pagina').innerHTML = `
    <div class="msg"><strong>Quem recusa o acesso é o servidor.</strong>
      Esta tela é o cadastro que governa essa recusa — usuários, perfis e a matriz de permissões — e a
      pré-visualização do que cada perfil enxerga. A senha nunca passa por aqui: ela é definida no primeiro acesso,
      pelo próprio usuário, e guardada apenas como hash no servidor.</div>

    <div class="kpis">
      ${kpi('Usuários', inteiro(usuarios.length), 'vinculados a esta empresa')}
      ${kpi('Ativos', inteiro(ativos.length), 'podem entrar hoje')}
      ${kpi('Perfis', inteiro(perfis.length), inteiro(perfis.filter((p)=>p.padrao).length) + ' padrão')}
      ${kpi('Sem perfil válido', inteiro(semPerfil), semPerfil ? 'não entram até receber um' : 'nenhum pendente', semPerfil ? 'crit' : '')}
    </div>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Usuários</h2><span class="nota">${inteiro(usuarios.length)} cadastrado(s)</span>
        <button class="bt pri" id="u-novo">Novo usuário</button></header>
      ${usuarios.length === 0 ? '<p class="vazio">Nenhum usuário cadastrado nesta empresa.</p>' : `
      <div class="rol"><table><thead><tr>
        <th>Nome</th><th>Usuário (login)</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th></th>
      </tr></thead><tbody>
        ${usuarios.map((u)=>{
          const p = perfilDe(perfis, u.perfil);
          return `<tr data-u="${esc(u.id)}">
            <td>${esc(u.nome)}</td>
            <td><code>${esc(u.username)}</code></td>
            <td>${esc(u.email)}</td>
            <td>${p ? `<span class="tag${p.tipo==='EDIT'?'':' alerta'}">${esc(p.nome)}</span>`
                    : '<span class="tag crit">sem perfil</span>'}</td>
            <td>${u.ativo === false ? '<span class="tag crit">inativo</span>' : '<span class="tag bom">ativo</span>'}</td>
            <td style="white-space:nowrap">
              <button class="bt fant peq" data-editar-u>Editar</button>
              <button class="bt fant peq" data-alternar>${u.ativo === false ? 'Reativar' : 'Inativar'}</button>
            </td></tr>`;
        }).join('')}
      </tbody></table></div>`}
    </section>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Perfis de acesso</h2><span class="nota">${inteiro(MODULOS_ACESSO.length * ACOES_ACESSO.length)} combinações por perfil</span>
        <button class="bt pri" id="p-novo">Novo perfil</button></header>
      <div class="rol"><table><thead><tr>
        <th>Perfil</th><th>Tipo</th><th>Permissões</th><th>Usuários</th><th></th>
      </tr></thead><tbody>
        ${perfis.map((p)=>`<tr data-p="${esc(p.id)}">
          <td>${esc(p.nome)}${p.padrao?' <span class="tag">padrão</span>':''}</td>
          <td>${p.tipo === 'VIEW_ONLY' ? 'Somente visualização' : 'Edição'}</td>
          <td>${inteiro(contarPermissoes(p))} de ${inteiro(MODULOS_ACESSO.length * ACOES_ACESSO.length)}</td>
          <td>${inteiro(usuarios.filter((u)=>u.perfil===p.id).length)}</td>
          <td style="white-space:nowrap">
            <button class="bt fant peq" data-perm>Permissões</button>
            <button class="bt fant peq" data-previa>Pré-visualizar</button>
            <button class="bt fant peq" data-dup>Duplicar</button>
            ${p.padrao ? '' : '<button class="bt fant peq" data-excluir-p>Excluir</button>'}
          </td></tr>`).join('')}
      </tbody></table></div>
    </section>`;

  el('#u-novo').onclick = () => formUsuario(emp, perfis, null);
  el('#p-novo').onclick = () => formPerfil(emp, null);

  el('#pagina').querySelectorAll('tr[data-u]').forEach((tr) => {
    const u = usuarios.find((x) => x.id === tr.dataset.u);
    tr.querySelector('[data-editar-u]').onclick = () => formUsuario(emp, perfis, u);
    tr.querySelector('[data-alternar]').onclick = () => {
      const inativando = u.ativo !== false;
      confirmar({
        titulo: inativando ? 'Inativar usuário' : 'Reativar usuário',
        mensagem: inativando
          ? `${esc(u.nome)} deixa de entrar no sistema. O cadastro não é apagado: fica inativo, com a trilha de quem fez e por quê.`
          : `${esc(u.nome)} volta a entrar com o perfil que estiver no cadastro.`,
        rotulo: inativando ? 'Inativar' : 'Reativar',
        exigeJustificativa: inativando,
        async aoConfirmar(just) {
          const lista = (await Loja.usuariosDa(emp)).map((x) =>
            x.id === u.id ? { ...x, ativo: !inativando } : x);
          await Loja.gravarUsuarios(emp, lista);
          await Loja.auditar({ acao: inativando ? 'inativar' : 'reativar', entidade:'usuario', id:u.id,
            justificativa: just, antes:{ ativo: u.ativo !== false }, depois:{ ativo: !inativando } }, emp);
          render();
        } });
    };
  });

  el('#pagina').querySelectorAll('tr[data-p]').forEach((tr) => {
    const p = perfilDe(perfis, tr.dataset.p);
    tr.querySelector('[data-perm]').onclick = () => formPermissoes(emp, p);
    tr.querySelector('[data-previa]').onclick = () => {
      E.previa = p;
      try { localStorage.setItem('iarx-previa', p.id); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
      // Se o perfil não vê a própria tela de acessos, ficar nela seria mentir
      // sobre o que ele enxerga: a pré-visualização abre a primeira que ele vê.
      if (!abaVisivel(E.aba)) E.aba = (ABAS.find((a) => abaVisivel(a.id)) || ABAS[0]).id;
      render();
    };
    tr.querySelector('[data-dup]').onclick = () => formPerfil(emp, p, true);
    const excluir = tr.querySelector('[data-excluir-p]');
    if (excluir) excluir.onclick = () => {
      const emUso = usuarios.filter((u) => u.perfil === p.id);
      if (emUso.length) {
        return abrirModal({ titulo:'Perfil em uso', tipo:'aviso-perfil',
          corpo: `<div class="msg erro">O perfil <strong>${esc(p.nome)}</strong> está em
            ${inteiro(emUso.length)} usuário(s): ${esc(emUso.map((u)=>u.nome).join(', '))}.
            Mude o perfil dessas pessoas antes de excluí-lo — senão elas ficariam sem acesso nenhum, sem aviso.</div>`,
          acoes: '<button type="button" class="bt" data-c>Entendi</button>',
          aoMontar({ raiz, fechar }) { raiz.querySelector('[data-c]').onclick = fechar; } });
      }
      confirmar({ titulo:'Excluir perfil', rotulo:'Excluir', exigeJustificativa: true,
        mensagem: `O perfil ${esc(p.nome)} sai do cadastro. Nenhum usuário o usa hoje.`,
        async aoConfirmar(just) {
          await Loja.gravarPerfis(emp, (await Loja.perfisDa(emp)).filter((x) => x.id !== p.id));
          if (E.previa && E.previa.id === p.id) E.previa = null;
          await Loja.auditar({ acao:'excluir', entidade:'perfil', id:p.id, justificativa:just, antes:{ nome:p.nome } }, emp);
          render();
        } });
    };
  });
}

/** Identificador de login derivado do e-mail — a mesma regra do servidor. */
function derivarUsername(email) {
  const limpar = (s) => String(s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '');
  const [prefixo = '', dominio = ''] = String(email || '').split('@');
  let nome = limpar(prefixo);
  if (nome.length < 3) nome += limpar((dominio.split('.')[0] || ''));
  while (nome.length < 3) nome += '0';
  return nome.slice(0, 40);
}

function formUsuario(empresa, perfis, existente) {
  const u = existente || { nome:'', username:'', email:'', perfil: (perfis[0]||{}).id, ativo:true };
  abrirModal({
    titulo: existente ? 'Editar usuário' : 'Novo usuário',
    tipo: 'usuario',
    corpo: `
      <div class="msg">O <strong>usuário</strong> é o que se digita no login; o <strong>e-mail</strong> serve para
        recuperar a senha e receber avisos. São campos separados de propósito: trocar de e-mail não muda o login.</div>
      <div class="campo"><label for="u-nome">Nome completo</label>
        <input id="u-nome" name="nome" value="${esc(u.nome)}"></div>
      <div class="campo"><label for="u-email">E-mail</label>
        <input id="u-email" name="email" type="email" value="${esc(u.email)}"></div>
      <div class="campo"><label for="u-user">Usuário (login)</label>
        <input id="u-user" name="username" value="${esc(u.username)}" placeholder="derivado do e-mail se ficar em branco"></div>
      <div class="campo"><label for="u-perfil">Perfil nesta empresa</label>
        <select id="u-perfil" name="perfil">${perfis.map((p)=>
          `<option value="${esc(p.id)}"${p.id===u.perfil?' selected':''}>${esc(p.nome)}</option>`).join('')}</select></div>`,
    acoes: '<button type="button" class="bt" data-c>Cancelar</button><button type="button" class="bt pri" data-s>Salvar</button>',
    aoMontar({ raiz, fechar, erro, campo }) {
      const email = campo('email'), user = campo('username');
      // Enquanto ninguém escreveu o login à mão, ele acompanha o e-mail.
      email.oninput = () => { if (!user.dataset.tocado) user.value = derivarUsername(email.value); };
      user.oninput = () => { user.dataset.tocado = '1'; };
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const nome = campo('nome').value.trim();
          if (!nome) throw new Error('Informe o nome completo.');
          const mail = email.value.trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new Error('E-mail inválido.');
          const login = (user.value.trim() || derivarUsername(mail)).toLowerCase();
          if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
            throw new Error('O usuário deve ter de 3 a 40 caracteres, apenas letras, números, ponto, hífen ou sublinhado.');
          }
          const lista = await Loja.usuariosDa(empresa);
          const conflito = lista.find((x) => x.id !== u.id && (x.username === login || x.email === mail));
          if (conflito) {
            throw new Error(conflito.username === login
              ? `O usuário "${login}" já existe nesta empresa.`
              : `O e-mail "${mail}" já está em outro cadastro desta empresa.`);
          }
          const perfil = campo('perfil').value;
          const registro = { id: u.id || novoId(), nome, email: mail, username: login, perfil,
            ativo: u.ativo !== false, criadoEm: u.criadoEm || new Date().toISOString() };
          await Loja.gravarUsuarios(empresa,
            existente ? lista.map((x) => (x.id === u.id ? registro : x)) : [...lista, registro]);
          await Loja.auditar({ acao: existente ? 'atualizar' : 'criar', entidade:'usuario', id: registro.id,
            antes: existente ? { nome:u.nome, username:u.username, email:u.email, perfil:u.perfil } : undefined,
            depois:{ nome, username: login, email: mail, perfil } }, empresa);
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

function formPerfil(empresa, base, duplicando) {
  const p = base || { nome:'', tipo:'VIEW_ONLY' };
  abrirModal({
    titulo: duplicando ? 'Duplicar perfil' : (base ? 'Editar perfil' : 'Novo perfil'),
    tipo: 'perfil',
    corpo: `
      <div class="msg">O <strong>tipo</strong> define o ponto de partida da matriz. Depois disso, cada permissão é
        ajustada uma a uma em <em>Permissões</em> — o tipo não engessa o perfil.</div>
      <div class="campo"><label for="p-nome">Nome do perfil</label>
        <input id="p-nome" name="nome" value="${esc(duplicando ? p.nome + ' (cópia)' : p.nome)}"></div>
      <div class="campo"><label for="p-tipo">Tipo</label>
        <select id="p-tipo" name="tipo">
          <option value="VIEW_ONLY"${p.tipo==='VIEW_ONLY'?' selected':''}>Somente visualização</option>
          <option value="EDIT"${p.tipo==='EDIT'?' selected':''}>Edição</option></select></div>`,
    acoes: '<button type="button" class="bt" data-c>Cancelar</button><button type="button" class="bt pri" data-s>Salvar</button>',
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const nome = campo('nome').value.trim();
          if (!nome) throw new Error('Informe o nome do perfil.');
          const tipo = campo('tipo').value;
          const lista = await Loja.perfisDa(empresa);
          const editando = base && !duplicando;
          if (lista.some((x) => x.nome.toLowerCase() === nome.toLowerCase() && (!editando || x.id !== p.id))) {
            throw new Error(`Já existe um perfil chamado "${nome}" nesta empresa.`);
          }
          // Duplicar copia a matriz de quem foi duplicado; criar parte do padrão
          // do tipo; editar preserva o que já foi ajustado à mão.
          const permissoes = duplicando ? JSON.parse(JSON.stringify(base.permissoes))
            : (editando ? p.permissoes : permissoesPadrao(tipo));
          const registro = { id: editando ? p.id : novoId(), nome, tipo,
            padrao: editando ? !!p.padrao : false, permissoes,
            criadoEm: editando ? p.criadoEm : new Date().toISOString() };
          await Loja.gravarPerfis(empresa,
            editando ? lista.map((x) => (x.id === p.id ? registro : x)) : [...lista, registro]);
          await Loja.auditar({ acao: editando ? 'atualizar' : 'criar', entidade:'perfil', id: registro.id,
            depois:{ nome, tipo } }, empresa);
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

/** A matriz módulo × ação do perfil, marcada a caixa por caixa. */
function formPermissoes(empresa, perfil) {
  const marcada = (m, a) => (perfilPode(perfil, m, a) ? ' checked' : '');
  abrirModal({
    titulo: 'Permissões — ' + perfil.nome,
    tipo: 'permissoes',
    corpo: `
      <div class="msg">Cada linha é um módulo; cada coluna, uma ação. Sem <strong>Ver</strong>, o módulo some da
        navegação de quem tem este perfil — as outras ações da linha ficam sem efeito.</div>
      <div class="rol" style="margin-top:10px"><table><thead><tr><th>Módulo</th>
        ${ACOES_ACESSO.map((a)=>`<th style="text-align:center">${esc(a.rotulo)}</th>`).join('')}
        <th style="text-align:center">Linha</th></tr></thead><tbody>
        ${MODULOS_ACESSO.map((m)=>`<tr data-mod="${m.id}"><td>${esc(m.rotulo)}</td>
          ${ACOES_ACESSO.map((a)=>`<td style="text-align:center">
            <input type="checkbox" data-m="${m.id}" data-a="${a.id}"${marcada(m.id,a.id)}
              aria-label="${esc(m.rotulo)} — ${esc(a.rotulo)}"></td>`).join('')}
          <td style="text-align:center"><button type="button" class="bt fant peq" data-linha="${m.id}">Tudo</button></td>
        </tr>`).join('')}
      </tbody></table></div>`,
    acoes: `<button type="button" class="bt" data-c>Cancelar</button>
      <button type="button" class="bt" data-padrao>Voltar ao padrão do tipo</button>
      <button type="button" class="bt pri" data-s>Salvar</button>`,
    aoMontar({ raiz, fechar, erro }) {
      const caixas = [...raiz.querySelectorAll('input[type=checkbox][data-m]')];
      const daLinha = (mod) => caixas.filter((c) => c.dataset.m === mod);
      // "Ver" governa a linha: desmarcá-lo desmarca o resto, porque criar num
      // módulo que não se enxerga não quer dizer nada.
      const ajustarLinha = (mod) => {
        const ver = daLinha(mod).find((c) => c.dataset.a === 'view');
        if (!ver.checked) daLinha(mod).forEach((c) => { if (c !== ver) c.checked = false; });
      };
      caixas.forEach((c) => c.onchange = () => {
        if (c.dataset.a === 'view') ajustarLinha(c.dataset.m);
        else if (c.checked) daLinha(c.dataset.m).find((x) => x.dataset.a === 'view').checked = true;
      });
      raiz.querySelectorAll('[data-linha]').forEach((b) => b.onclick = () => {
        const todas = daLinha(b.dataset.linha);
        const ligar = !todas.every((c) => c.checked);
        todas.forEach((c) => { c.checked = ligar; });
      });
      raiz.querySelector('[data-padrao]').onclick = () => {
        const padrao = permissoesPadrao(perfil.tipo);
        caixas.forEach((c) => { c.checked = !!(padrao[c.dataset.m] && padrao[c.dataset.m][c.dataset.a]); });
      };
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const permissoes = {};
          for (const m of MODULOS_ACESSO) {
            permissoes[m.id] = {};
            for (const a of ACOES_ACESSO) {
              permissoes[m.id][a.id] = daLinha(m.id).find((c) => c.dataset.a === a.id).checked;
            }
          }
          const lista = (await Loja.perfisDa(empresa)).map((x) =>
            x.id === perfil.id ? { ...x, permissoes } : x);
          await Loja.gravarPerfis(empresa, lista);
          if (E.previa && E.previa.id === perfil.id) E.previa = { ...perfil, permissoes };
          await Loja.auditar({ acao:'atualizar', entidade:'perfil_permissoes', id: perfil.id,
            antes:{ concedidas: contarPermissoes(perfil) },
            depois:{ concedidas: contarPermissoes({ permissoes }) } }, empresa);
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

/**
 * A pré-visualização atravessa o recarregamento da página: quem estava
 * conferindo um perfil não perde o recorte ao dar F5. O perfil que sumiu do
 * cadastro simplesmente não volta — e a marca é apagada, para não insistir.
 */
async function restaurarPrevia() {
  // O modo leitura vence a escolha guardada: quem só vê não escolhe perfil,
  // e sobrepor aqui daria a ele um botão de sair que não sairia de nada.
  if (E.somenteLeitura) return;
  let id = null;
  try { id = localStorage.getItem('iarx-previa'); } catch (e) { return; }
  if (!id) return;
  const emp = empresaAtiva();
  if (!emp) return;
  const perfil = perfilDe(await Loja.perfisDa(emp), id);
  if (perfil) E.previa = perfil;
  else { try { localStorage.removeItem('iarx-previa'); } catch (e) { /* nada a limpar */ } }
}
