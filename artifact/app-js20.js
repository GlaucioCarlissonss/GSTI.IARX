// ===========================================================================
// Cadastro > Metas e SLAs — a configuração que os indicadores leem
// ===========================================================================
//
// Até aqui o único alvo do sistema era o 80 do SLA, escrito no código, e o
// prazo de um chamado vinha pronto da origem. As duas telas abaixo tiram esses
// números do código e os põem onde o cliente alcança.
//
// Metas são do CLIENTE (um alvo de SLA não muda de matriz para matriz); SLAs
// são da UNIDADE, como todo cadastro de operação — a hora de atendimento de um
// hospital não é a do outro.

/** A vigência em uma frase. Duas pontas anuláveis dão quatro leituras. */
function vigenciaEmTexto(m) {
  if (!m.vigenciaInicio && !m.vigenciaFim) return 'sempre';
  if (m.vigenciaInicio && !m.vigenciaFim) return 'de ' + mesExib(m.vigenciaInicio) + ' em diante';
  if (!m.vigenciaInicio && m.vigenciaFim) return 'até ' + mesExib(m.vigenciaFim);
  return mesExib(m.vigenciaInicio) + ' a ' + mesExib(m.vigenciaFim);
}

/** O que o alvo significa em cada módulo — piso ou teto. */
const SENTIDO_MODULO = {
  financeiro: 'teto para a variação de custo contra o mês anterior',
  sla: 'mínimo de chamados atendidos no prazo',
  projetos: 'mínimo de tarefas entregues no prazo',
  equilibrio: 'teto para o gasto de uma unidade consumido por outras',
};

function metasDoCliente() {
  return (E.metas || []).filter((m) => !m.cliente || m.cliente === E.clienteSel);
}

function viewMetas() {
  const metas = metasDoCliente();
  el('#pagina').innerHTML = `
    <div class="msg"><strong>As metas são do cliente inteiro.</strong>
      Cada uma aparece ao lado do resultado do indicador correspondente, em Indicadores Gerais e no
      Painel. Sem nenhuma cadastrada, valem os alvos de base: 80% para SLA e para entrega no prazo.</div>

    <section class="bloco">
      <header><h2>Metas</h2><span class="nota">${inteiro(metas.length)}</span></header>
      ${metas.length === 0 ? '<p class="vazio">Nenhuma meta cadastrada.</p>' : `
      <div class="rol"><table>
        <thead><tr><th>Meta</th><th>Módulo</th><th class="n">Alvo</th><th>Vigência</th><th>Situação</th><th></th></tr></thead>
        <tbody>${metas.map((m, i) => `<tr>
          <td>${esc(m.nome)}</td>
          <td title="${esc(SENTIDO_MODULO[m.modulo] || '')}">${esc(ROTULO_MODULO_META[m.modulo] || m.modulo)}</td>
          <td class="n">${Number(m.alvoPct).toLocaleString('pt-BR')}%</td>
          <td>${esc(vigenciaEmTexto(m))}</td>
          <td><span class="tag ${m.ativo === false ? '' : 'bom'}">${m.ativo === false ? 'Inativa' : 'Ativa'}</span></td>
          <td><button class="bt fant peq" data-alternar="${i}">${m.ativo === false ? 'Reativar' : 'Desativar'}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      <div style="margin-top:12px"><button class="bt" data-nova-meta>Cadastrar meta</button></div>
      <p class="nota" style="margin-top:10px">A vigência decide qual meta rege qual mês: trocar o alvo em
        janeiro não reescreve a leitura dos meses já fechados. Entre duas vigentes ganha a de início mais
        recente, e a meta sem início é o alvo genérico — vale onde nenhum específico alcança.</p>
    </section>`;

  el('#pagina').querySelector('[data-nova-meta]')?.addEventListener('click', formMeta);
  for (const bt of el('#pagina').querySelectorAll('[data-alternar]')) {
    bt.addEventListener('click', async () => {
      const alvo = metas[Number(bt.dataset.alternar)];
      const todas = (E.metas || []).map((m) => (m === alvo ? { ...m, ativo: m.ativo === false } : m));
      await Loja.gravarCatalogo('metas', todas);
      await Loja.auditar({ acao: 'atualizar', entidade: 'meta', depois: { nome: alvo.nome, ativo: alvo.ativo === false } });
      render();
    });
  }
}

function formMeta() {
  abrirModal({
    titulo: 'Nova meta',
    corpo: `
      <div class="grade g2">
        <div class="campo"><label for="m-nome">Nome</label><input id="m-nome" name="nome"></div>
        <div class="campo"><label for="m-mod">Módulo</label><select id="m-mod" name="modulo">
          ${MODULOS_META.map((k) => `<option value="${esc(k)}">${esc(ROTULO_MODULO_META[k])}</option>`).join('')}
        </select></div>
      </div>
      <div class="grade g3">
        <div class="campo"><label for="m-alvo">Alvo (%)</label>
          <input id="m-alvo" name="alvo" type="number" min="0" max="100" step="0.1"></div>
        <div class="campo"><label for="m-de">Vigência de (MM/AAAA)</label>
          <input id="m-de" name="de" inputmode="numeric" placeholder="em branco: desde sempre"></div>
        <div class="campo"><label for="m-ate">até (MM/AAAA)</label>
          <input id="m-ate" name="ate" inputmode="numeric" placeholder="em branco: sem fim"></div>
      </div>`,
    acoes: `<button type="button" class="bt" data-c>Cancelar</button>
            <button type="button" class="bt pri" data-s>Cadastrar</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const nome = campo('nome').value.trim();
          if (!nome) throw new Error('Informe o nome da meta.');
          if (metasDoCliente().some((m) => m.nome.toLowerCase() === nome.toLowerCase())) {
            throw new Error('Já existe uma meta com este nome neste cliente.');
          }
          const alvo = Number(String(campo('alvo').value).replace(',', '.'));
          if (!Number.isFinite(alvo) || alvo < 0 || alvo > 100) {
            throw new Error('O valor-alvo é um percentual entre 0 e 100.');
          }
          const ponta = (texto, rotulo) => {
            const bruto = texto.trim();
            if (!bruto) return null;
            const m = mesInterno(bruto);
            if (!m) throw new Error(rotulo + ' inválida: use MM/AAAA.');
            return m;
          };
          const de = ponta(campo('de').value, 'Vigência inicial');
          const ate = ponta(campo('ate').value, 'Vigência final');
          if (de && ate && de > ate) throw new Error('A vigência final é anterior à inicial.');

          const nova = {
            cliente: E.clienteSel, nome, modulo: campo('modulo').value,
            alvoPct: Math.round(alvo * 10) / 10, vigenciaInicio: de, vigenciaFim: ate, ativo: true,
          };
          await Loja.gravarCatalogo('metas', [...(E.metas || []), nova]);
          await Loja.auditar({ acao: 'criar', entidade: 'meta', depois: { nome, modulo: nova.modulo, alvo: nova.alvoPct } });
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

// ---------------------------------------------------------- Acordos de SLA

const PRIORIDADES_SLA = ['low', 'medium', 'high', 'urgent'];
const ROTULO_PRIORIDADE_SLA = { low:'Baixa', medium:'Média', high:'Alta', urgent:'Urgente' };

/** Os acordos da unidade em foco. `topico` nulo é a regra geral da prioridade. */
function slasDa(empresa) {
  return (E.slasCad || []).filter((s) => s.empresa === empresa);
}

/**
 * As horas que valem para um chamado — ou `null` se não há acordo.
 *
 * O acordo do tópico ganha do geral: "Rede: 4h para alta" junto de "geral: 24h
 * para alta" quer dizer que rede é mais exigente, e não que as duas competem.
 */
function horasDoAcordo(empresa, prioridade, topico) {
  const ativos = slasDa(empresa).filter((s) => s.ativo !== false && s.prioridade === prioridade);
  const doTopico = ativos.find((s) => s.topico && s.topico === topico);
  const geral = ativos.find((s) => !s.topico);
  return (doTopico || geral || {}).horas ?? null;
}

function viewSlas() {
  const emp = empresaAtiva();
  if (!emp) {
    el('#pagina').innerHTML = `<div class="msg alerta"><strong>Este cliente ainda não tem unidade cadastrada.</strong>
      Os acordos pertencem a uma unidade. Cadastre a matriz em <strong>Clientes e unidades</strong>.</div>`;
    return;
  }
  const acordos = slasDa(emp);
  el('#pagina').innerHTML = `
    <div class="msg"><strong>Os acordos são da unidade ${esc(nomeEmpresa(emp))}.</strong>
      Definem quantas horas um chamado tem, por tópico de ajuda e prioridade.</div>

    <section class="bloco">
      <header><h2>Acordos de SLA</h2><span class="nota">${inteiro(acordos.length)}</span></header>
      ${acordos.length === 0 ? `<p class="vazio">Nenhum acordo cadastrado. O prazo continua vindo do helpdesk
        de origem; onde ele não informa prazo, o chamado fechado conta como dentro e o aberto, como fora.</p>` : `
      <div class="rol"><table>
        <thead><tr><th>Tópico de ajuda</th><th>Prioridade</th><th class="n">Horas</th><th>Situação</th><th></th></tr></thead>
        <tbody>${acordos.map((a, i) => `<tr>
          <td>${a.topico ? esc(a.topico) : '<em style="color:var(--tinta3)">regra geral desta prioridade</em>'}</td>
          <td>${esc(ROTULO_PRIORIDADE_SLA[a.prioridade] || a.prioridade)}</td>
          <td class="n">${Number(a.horas).toLocaleString('pt-BR')} h</td>
          <td><span class="tag ${a.ativo === false ? '' : 'bom'}">${a.ativo === false ? 'Inativo' : 'Ativo'}</span></td>
          <td><button class="bt fant peq" data-alternar-sla="${i}">${a.ativo === false ? 'Reativar' : 'Desativar'}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      <div style="margin-top:12px"><button class="bt" data-novo-sla>Cadastrar acordo</button></div>
      <p class="nota" style="margin-top:10px">O acordo do tópico ganha do geral. O prazo que o helpdesk de
        origem informa continua tendo a palavra final — o cadastro entra onde não havia prazo nenhum. São
        horas corridas: o sistema não tem calendário de expediente, e inventar um criaria um prazo que
        nenhum contrato assinou. Chamados já gravados mantêm o prazo que tinham.</p>
    </section>`;

  el('#pagina').querySelector('[data-novo-sla]')?.addEventListener('click', () => formAcordoSla(emp));
  for (const bt of el('#pagina').querySelectorAll('[data-alternar-sla]')) {
    bt.addEventListener('click', async () => {
      const alvo = acordos[Number(bt.dataset.alternarSla)];
      const todos = (E.slasCad || []).map((s) => (s === alvo ? { ...s, ativo: s.ativo === false } : s));
      await Loja.gravarCatalogo('slasCad', todos);
      await Loja.auditar({ acao:'atualizar', entidade:'sla', depois:{ prioridade: alvo.prioridade, ativo: alvo.ativo === false } }, emp);
      render();
    });
  }
}

function formAcordoSla(emp) {
  // Os tópicos que os chamados desta unidade já usaram. A integração os cria
  // sozinha, e é aqui que eles aparecem para poder virar acordo — não há
  // cadastro de tópico para consultar.
  const topicos = [...new Set((E.sla.get(emp) || []).map((t) => t.topico).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  abrirModal({
    titulo: 'Novo acordo de SLA',
    corpo: `
      <div class="grade g3">
        <div class="campo"><label for="s-top">Tópico de ajuda</label>
          <input id="s-top" name="topico" list="s-topicos" placeholder="em branco: regra geral">
          <datalist id="s-topicos">${topicos.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist></div>
        <div class="campo"><label for="s-pri">Prioridade</label><select id="s-pri" name="prioridade">
          ${PRIORIDADES_SLA.map((p) => `<option value="${esc(p)}">${esc(ROTULO_PRIORIDADE_SLA[p])}</option>`).join('')}
        </select></div>
        <div class="campo"><label for="s-horas">Horas</label>
          <input id="s-horas" name="horas" type="number" min="0" step="0.5"></div>
      </div>`,
    acoes: `<button type="button" class="bt" data-c>Cancelar</button>
            <button type="button" class="bt pri" data-s>Cadastrar</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const topico = campo('topico').value.trim() || null;
          const prioridade = campo('prioridade').value;
          const horas = Number(String(campo('horas').value).replace(',', '.'));
          if (!Number.isFinite(horas) || horas <= 0) throw new Error('As horas precisam ser um número maior que zero.');
          if (slasDa(emp).some((s) => s.prioridade === prioridade && (s.topico || null) === topico)) {
            throw new Error(topico
              ? 'Já existe um acordo para este tópico nesta prioridade.'
              : 'Já existe uma regra geral para esta prioridade.');
          }
          const novo = { empresa: emp, topico, prioridade, horas: Math.round(horas * 100) / 100, ativo: true };
          await Loja.gravarCatalogo('slasCad', [...(E.slasCad || []), novo]);
          await Loja.auditar({ acao:'criar', entidade:'sla', depois:{ topico, prioridade, horas: novo.horas } }, emp);
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

// ------------------------------------------ Reclassificação de prioridade

/**
 * O histórico de prioridade de um chamado.
 *
 * A prioridade mudava sem deixar rastro: uma elevação de Baixa para Alta "a
 * pedido de alguém" virava um estado sem história, e quem conferisse o SLA
 * depois não teria como saber por que aquele chamado corria contra um prazo
 * mais curto.
 *
 * O histórico mora DENTRO do registro do chamado, e não num catálogo à parte:
 * o documento é por empresa e competência, e separar faria uma leitura virar
 * duas para responder uma pergunta da mesma linha.
 *
 * A extração não traz prioridade (`nivel` é a classificação do próprio
 * helpdesk — "N1", "Implementacao"), então o chamado começa SEM prioridade e é
 * a reclassificação que passa a defini-la. O histórico registra isso como era:
 * "sem prioridade → Alta".
 */
const historicoDe = (r) => (Array.isArray(r && r.reclassificacoes) ? r.reclassificacoes : []);

/**
 * Os registros de um mês. `E.sla` é indexado por EMPRESA e traz a competência
 * em cada item; o documento gravado é por mês, e nele a competência é do
 * documento — por isso ela sai de volta na hora de gravar.
 */
const registrosDoMes = (empresa, comp) => (E.sla.get(empresa) || []).filter((r) => r.competencia === comp);
const semCompetencia = (r) => { const { competencia, ...resto } = r; return resto; };

const rotuloPrioridade = (p) => (p ? (ROTULO_PRIORIDADE_SLA[p] || p) : null);

/** Data e hora da alteração. `hora` de `viewSla` é local dela, e não serve aqui. */
const quandoEmTexto = (t) =>
  (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function abrirReclassificacao(empresa, competencia, id) {
  const registro = registrosDoMes(empresa, competencia).find((r) => String(r.id) === String(id));
  if (!registro) return;
  const historico = historicoDe(registro);

  abrirModal({
    titulo: 'Prioridade do chamado #' + esc(registro.numero || registro.ticketId || registro.id),
    corpo: `
      <div class="msg">Prioridade atual:
        <strong>${esc(rotuloPrioridade(registro.prioridade) || 'não definida')}</strong>.
        A prioridade vigente é a que vale para o cálculo do SLA.</div>

      <section class="bloco" style="box-shadow:none">
        <header><h2>Histórico</h2><span class="nota">${inteiro(historico.length)}</span></header>
        ${historico.length === 0
          ? '<p class="vazio">A prioridade nunca foi alterada desde que o chamado entrou.</p>'
          : `<dl class="ficha">${historico.slice().reverse().map((h) => `
              <dt>${esc(quandoEmTexto(h.quando))}</dt>
              <dd>${esc(rotuloPrioridade(h.de) || 'sem prioridade')} → ${esc(rotuloPrioridade(h.para))}${
                h.solicitante ? ' · a pedido de ' + esc(h.solicitante) : ''}${
                h.motivo ? ' · ' + esc(h.motivo) : ''}</dd>`).join('')}</dl>`}
      </section>

      <div class="grade g2">
        <div class="campo"><label for="r-pri">Nova prioridade</label><select id="r-pri" name="prioridade">
          ${PRIORIDADES_SLA.map((p) => `<option value="${esc(p)}">${esc(ROTULO_PRIORIDADE_SLA[p])}</option>`).join('')}
        </select></div>
        <div class="campo"><label for="r-quem">Quem pediu (cargo e nome)</label>
          <input id="r-quem" name="solicitante" placeholder="Coordenador de Enfermagem — Maria Souza"></div>
      </div>
      <div class="campo"><label for="r-mot">Motivo</label><input id="r-mot" name="motivo"></div>`,
    acoes: `<button type="button" class="bt" data-c>Fechar</button>
            <button type="button" class="bt pri" data-s>Reclassificar</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const solicitante = campo('solicitante').value.trim();
          // O enunciado pede cargo E nome: sem isso o histórico registra
          // "alguém pediu", que é o mesmo que não registrar.
          if (!solicitante) throw new Error('Informe quem pediu a reclassificação, com cargo e nome.');
          const nova = campo('prioridade').value;
          if (registro.prioridade === nova) {
            throw new Error('O chamado já está na prioridade ' + ROTULO_PRIORIDADE_SLA[nova] + '.');
          }
          const itens = registrosDoMes(empresa, competencia).map((r) => {
            if (String(r.id) !== String(id)) return semCompetencia(r);
            return semCompetencia({
              ...r,
              prioridade: nova,
              reclassificacoes: [...historicoDe(r), {
                de: r.prioridade || null, para: nova, quando: new Date().toISOString(),
                motivo: campo('motivo').value.trim() || null, solicitante,
              }],
            });
          });
          await Loja.gravarSlaMes(empresa, competencia, itens);
          await Loja.auditar({ acao:'reclassificar', entidade:'ticket_sla', id,
            antes:{ prioridade: registro.prioridade || null },
            depois:{ prioridade: nova, solicitante } }, empresa);
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}
