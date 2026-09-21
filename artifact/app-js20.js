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

/** "de 01/03/2026 a 31/03/2026" — a vigência em texto, com as pontas abertas. */
function periodoEmTexto(acordo) {
  const br = (d) => String(d).split('-').reverse().join('/');
  if (!acordo.vigenciaInicio && !acordo.vigenciaFim) return 'sem vigência definida';
  if (!acordo.vigenciaInicio) return 'até ' + br(acordo.vigenciaFim);
  if (!acordo.vigenciaFim) return 'a partir de ' + br(acordo.vigenciaInicio);
  return 'de ' + br(acordo.vigenciaInicio) + ' a ' + br(acordo.vigenciaFim);
}

/** A prioridade como a planilha escreve: 'Alta', 'high', 'URGENTE'. */
function prioridadeDaPlanilha(texto) {
  const t = String(texto || '').trim().toLowerCase();
  if (!t) return null;
  if (PRIORIDADES_SLA.includes(t)) return t;
  const porRotulo = PRIORIDADES_SLA.find((p) => ROTULO_PRIORIDADE_SLA[p].toLowerCase() === t);
  return porRotulo || null;
}

/** A data (AAAA-MM-DD) de um carimbo ISO, ou null. */
const diaDe = (t) => (t ? String(t).slice(0, 10) : null);

/** O acordo estava valendo neste dia? Ponta vazia é ponta aberta. */
function vigenteEm(acordo, dia) {
  if (acordo.vigenciaInicio && (!dia || dia < acordo.vigenciaInicio)) return false;
  if (acordo.vigenciaFim && (!dia || dia > acordo.vigenciaFim)) return false;
  return true;
}

/**
 * As horas que valem para um chamado — ou `null` se não há acordo.
 *
 * O acordo do tópico ganha do geral: "Rede: 4h para alta" junto de "geral: 24h
 * para alta" quer dizer que rede é mais exigente, e não que as duas competem.
 *
 * Quem escolhe entre acordos de vigências diferentes é a ABERTURA do chamado:
 * trocar 24h por 8h hoje não pode rejulgar o chamado da semana passada, que
 * correu contra o compromisso de então. É a mesma regra do servidor
 * (`horasDoAcordo` em `domain/slas.ts`).
 */
function horasDoAcordo(empresa, prioridade, topico, abertoEm) {
  const dia = diaDe(abertoEm);
  const ativos = slasDa(empresa)
    .filter((s) => s.ativo !== false && s.prioridade === prioridade && vigenteEm(s, dia))
    // Entre dois vigentes, o de início mais recente.
    .sort((a, b) => String(b.vigenciaInicio || '').localeCompare(String(a.vigenciaInicio || '')));
  const doTopico = ativos.find((s) => s.topico && s.topico === topico);
  const geral = ativos.find((s) => !s.topico);
  return (doTopico || geral || {}).horas ?? null;
}

/**
 * O prazo que o acordo dá a este chamado: abertura + horas, em ISO.
 *
 * Horas corridas, como no servidor: não há calendário de expediente
 * cadastrado, e inventar um criaria prazo que nenhum contrato assinou.
 */
function prazoDoAcordo(empresa, abertoEm, prioridade, topico) {
  if (!abertoEm) return null;
  const horas = horasDoAcordo(empresa, prioridade, topico, abertoEm);
  if (horas === null) return null;
  const inicio = new Date(abertoEm);
  if (Number.isNaN(inicio.getTime())) return null;
  return new Date(inicio.getTime() + horas * 3600000).toISOString();
}

/**
 * Como este chamado fica quando o acordo vale: prazo, dentro/fora e de onde o
 * prazo veio. Devolve `null` quando o acordo não alcança o chamado.
 *
 * O acordo cadastrado GANHA do prazo que a origem informou — é o compromisso
 * que o grupo negociou. O da origem fica guardado em `prazoOrigem`, para a
 * ficha poder mostrar os dois.
 */
function medirPeloAcordo(empresa, registro) {
  const prazo = prazoDoAcordo(empresa, registro.criadoEm, registro.prioridade, registro.topico);
  if (!prazo) return null;
  const referencia = registro.fechadoEm || new Date().toISOString();
  return {
    prazoEm: prazo,
    prazoDoAcordo: true,
    prazoOrigem: registro.prazoOrigem || (registro.prazoDoAcordo ? null : registro.prazoEm) || null,
    dentro: referencia <= prazo ? 1 : 0,
  };
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
        <thead><tr><th>Tópico de ajuda</th><th>Prioridade</th><th class="n">Horas</th><th>Vigência</th><th>Situação</th><th></th></tr></thead>
        <tbody>${acordos.map((a, i) => `<tr>
          <td>${a.topico ? esc(a.topico) : '<em style="color:var(--tinta3)">regra geral desta prioridade</em>'}</td>
          <td>${esc(ROTULO_PRIORIDADE_SLA[a.prioridade] || a.prioridade)}</td>
          <td class="n">${Number(a.horas).toLocaleString('pt-BR')} h</td>
          <td>${esc(periodoEmTexto(a))}</td>
          <td><span class="tag ${a.ativo === false ? '' : 'bom'}">${a.ativo === false ? 'Inativo' : 'Ativo'}</span></td>
          <td><button class="bt fant peq" data-alternar-sla="${i}">${a.ativo === false ? 'Reativar' : 'Desativar'}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      <div style="margin-top:12px"><button class="bt" data-novo-sla>Cadastrar acordo</button></div>
      <p class="nota" style="margin-top:10px">O acordo do tópico ganha do geral, e o acordo cadastrado
        ganha do prazo que o helpdesk informou — o da origem fica guardado e aparece na ficha do chamado.
        São horas corridas: o sistema não tem calendário de expediente, e inventar um criaria um prazo que
        nenhum contrato assinou. Chamado já gravado só muda pela reaplicação abaixo.</p>
    </section>

    <section class="bloco">
      <header><h2>Aplicar o acordo a uma competência</h2></header>
      <p class="nota">O acordo decide o prazo na ENTRADA do chamado. Para alcançar o que já está
        gravado — a base carregada por planilha, por exemplo — escolha o mês e veja o que mudaria
        antes de aplicar. Mês fechado é recusado; mês passado exige justificativa.</p>
      <div class="grade g3" style="margin-top:10px">
        <div class="campo"><label for="r-comp">Competência</label>
          <select id="r-comp">${competenciasComChamados(emp)
            .map((c) => `<option value="${esc(c)}">${esc(mesExib(c))}</option>`).join('')}</select></div>
        <div class="campo"><label for="r-just">Justificativa</label>
          <input id="r-just" placeholder="obrigatória em mês já encerrado"></div>
      </div>
      <div class="acoes" style="justify-content:flex-start;margin-top:10px">
        <button class="bt" data-previa-sla>Ver o que mudaria</button>
        <button class="bt pri" data-aplicar-sla>Aplicar</button>
      </div>
      <div id="r-resultado" style="margin-top:12px"></div>
    </section>`;

  el('#pagina').querySelector('[data-novo-sla]')?.addEventListener('click', () => formAcordoSla(emp));
  ligarReaplicacao(emp);
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

/** As competências que têm chamado nesta unidade, da mais recente para trás. */
function competenciasComChamados(empresa) {
  return [...new Set((E.sla.get(empresa) || []).map((r) => r.competencia).filter(Boolean))]
    .sort((a, b) => String(b).localeCompare(String(a)));
}

/**
 * O que a reaplicação faria nesta competência — sem gravar.
 *
 * Mesma passada da aplicação, e de propósito: se a prévia contasse por um
 * caminho e o botão fizesse por outro, a tela prometeria um número e a
 * gravação faria outro. É a mesma regra do servidor (`avaliarReaplicacao`).
 */
function avaliarReaplicacao(empresa, competencia) {
  const resumo = { avaliados:0, alterados:0, virouDentro:0, virouFora:0,
    semPrioridade:0, semAcordo:0, agregadosIgnorados:0 };
  const mudancas = [];
  for (const r of registrosDoMes(empresa, competencia)) {
    // O registro AGREGADO do mês não tem abertura nem prioridade: não há
    // chamado individual para medir, e arbitrar uma abertura seria inventar.
    if (Number(r.total) !== 1) { resumo.agregadosIgnorados += 1; continue; }
    resumo.avaliados += 1;
    if (!r.prioridade) { resumo.semPrioridade += 1; continue; }
    const medida = medirPeloAcordo(empresa, r);
    if (!medida) { resumo.semAcordo += 1; continue; }
    if (medida.prazoEm === r.prazoEm && medida.dentro === Number(r.dentro)) continue;
    resumo.alterados += 1;
    if (medida.dentro !== Number(r.dentro)) {
      if (medida.dentro === 1) resumo.virouDentro += 1; else resumo.virouFora += 1;
    }
    mudancas.push({ id: r.id, medida });
  }
  return { resumo, mudancas };
}

/** O resumo em texto — o que a tela mostra antes e depois de aplicar. */
function resumoReaplicacaoHtml(resumo, aplicado) {
  const linhas = [
    ['Chamados avaliados', resumo.avaliados],
    [aplicado ? 'Alterados' : 'Seriam alterados', resumo.alterados],
    ['Passaram a contar dentro', resumo.virouDentro],
    ['Passaram a contar fora', resumo.virouFora],
    ['Sem prioridade (intocados)', resumo.semPrioridade],
    ['Sem acordo vigente (intocados)', resumo.semAcordo],
    ['Registros agregados (fora da conta)', resumo.agregadosIgnorados],
  ];
  return `<div class="msg ${aplicado ? 'ok' : ''}">
    <strong>${aplicado ? 'Acordo aplicado.' : 'Prévia — nada foi gravado.'}</strong>
    <dl class="ficha" style="margin-top:6px">${linhas
      .map(([r, v]) => `<dt>${esc(r)}</dt><dd>${inteiro(v)}</dd>`).join('')}</dl></div>`;
}

function ligarReaplicacao(emp) {
  const pagina = el('#pagina');
  const saida = pagina.querySelector('#r-resultado');
  const comp = () => pagina.querySelector('#r-comp')?.value || null;
  if (!saida) return;

  pagina.querySelector('[data-previa-sla]')?.addEventListener('click', () => {
    const c = comp();
    if (!c) { saida.innerHTML = '<div class="msg alerta">Esta unidade não tem chamado em mês nenhum.</div>'; return; }
    saida.innerHTML = resumoReaplicacaoHtml(avaliarReaplicacao(emp, c).resumo, false);
  });

  pagina.querySelector('[data-aplicar-sla]')?.addEventListener('click', async (ev) => {
    const c = comp();
    if (!c) { saida.innerHTML = '<div class="msg alerta">Esta unidade não tem chamado em mês nenhum.</div>'; return; }
    ev.target.disabled = true;
    try {
      const just = pagina.querySelector('#r-just')?.value || '';
      // O mesmo porteiro de escrita do resto do sistema: mês fechado recusa,
      // mês passado exige justificativa.
      checarCompetencia(c, just, emp);
      const { resumo, mudancas } = avaliarReaplicacao(emp, c);
      if (mudancas.length) {
        const porId = new Map(mudancas.map((m) => [String(m.id), m.medida]));
        const itens = registrosDoMes(emp, c).map((r) => {
          const m = porId.get(String(r.id));
          return semCompetencia(m ? { ...r, ...m } : r);
        });
        await Loja.gravarSlaMes(emp, c, itens);
        await Loja.slaDa(emp);
      }
      await Loja.auditar({ acao:'reaplicar', entidade:'sla', justificativa: just || null,
        depois:{ ...resumo, competencia: mesExib(c) } }, emp);
      saida.innerHTML = resumoReaplicacaoHtml(resumo, true);
    } catch (e) {
      saida.innerHTML = `<div class="msg erro">${esc(e.message)}</div>`;
    }
    ev.target.disabled = false;
  });
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
      </div>
      <div class="grade g3">
        <div class="campo"><label for="s-vi">Vigência de</label>
          <input id="s-vi" name="vigenciaInicio" type="date"></div>
        <div class="campo"><label for="s-vf">até</label>
          <input id="s-vf" name="vigenciaFim" type="date"></div>
      </div>
      <p class="nota">Vigência em branco vale desde sempre, sem fim. Quem escolhe qual acordo vale
        para um chamado é a data de ABERTURA dele — por isso dois acordos para a mesma prioridade
        convivem, desde que os períodos não se sobreponham.</p>`,
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
          const vigenciaInicio = campo('vigenciaInicio').value || null;
          const vigenciaFim = campo('vigenciaFim').value || null;
          if (vigenciaInicio && vigenciaFim && vigenciaInicio > vigenciaFim) {
            throw new Error('A vigência termina antes de começar. Confira as duas datas.');
          }
          // A recusa é por SOBREPOSIÇÃO, e não por existência: é assim que se
          // substitui um acordo sem apagar o anterior. Dois valendo ao mesmo
          // tempo dariam dois prazos ao mesmo chamado.
          const conflito = slasDa(emp).find((s) => s.ativo !== false
            && s.prioridade === prioridade && (s.topico || null) === topico
            && (!vigenciaInicio || !s.vigenciaFim || vigenciaInicio <= s.vigenciaFim)
            && (!vigenciaFim || !s.vigenciaInicio || s.vigenciaInicio <= vigenciaFim));
          if (conflito) {
            throw new Error((topico
              ? 'Já existe um acordo para este tópico nesta prioridade'
              : 'Já existe uma regra geral para esta prioridade')
              + ' valendo no mesmo período (' + periodoEmTexto(conflito) + '). Encerre a vigência'
              + ' do acordo anterior ou escolha outro período.');
          }
          const novo = { empresa: emp, topico, prioridade, horas: Math.round(horas * 100) / 100,
            vigenciaInicio, vigenciaFim, ativo: true };
          await Loja.gravarCatalogo('slasCad', [...(E.slasCad || []), novo]);
          await Loja.auditar({ acao:'criar', entidade:'sla',
            depois:{ topico, prioridade, horas: novo.horas, vigenciaInicio, vigenciaFim } }, emp);
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
        A prioridade vigente é a que vale para o cálculo do SLA: o prazo é refeito pelo acordo
        cadastrado da prioridade nova, e volta ao prazo da origem quando não houver acordo.</div>

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
            const comNova = { ...r, prioridade: nova };
            // A prioridade vigente passa a valer para o SLA: o prazo é refeito
            // pelo acordo da prioridade NOVA. Elevar para Urgente sem encurtar
            // o prazo seria elevação só no rótulo. Sem acordo para ela, o
            // chamado volta ao prazo que a origem informou.
            const medida = medirPeloAcordo(empresa, comNova);
            const semAcordo = {
              prazoEm: r.prazoDoAcordo ? (r.prazoOrigem || null) : (r.prazoEm || null),
              prazoDoAcordo: false,
            };
            const efeito = medida || semAcordo;
            const referencia = r.fechadoEm || new Date().toISOString();
            const dentro = medida ? medida.dentro
              : efeito.prazoEm ? (referencia <= efeito.prazoEm ? 1 : 0)
              : (r.fechadoEm ? 1 : 0);
            return semCompetencia({
              ...comNova,
              ...efeito,
              dentro,
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

// ===========================================================================
// Cadastro > Plano de redução de despesas
// ===========================================================================
//
// `metas` dá um alvo PERCENTUAL por indicador inteiro ("não crescer mais que
// X%"). Isso não responde à pergunta que o gestor leva para a reunião de
// corte: *esta* despesa custa R$ 50.000 e precisa cair para R$ 35.000 — quanto
// isso é do grupo, e quanto pesa em cada filial?
//
// Daí um cadastro próprio, com alvo em REAIS e uma linha por despesa. Um alvo
// único cobrindo cinco categorias não teria como mostrar de quanto para quanto
// cai cada uma, que é exatamente a leitura pedida.
//
// Aqui a despesa e a filial são NOMES, não ids: é assim que o modelo do
// artifact guarda o lançamento, e casar por id exigiria um cadastro que este
// aplicativo não tem.

function planosDoCliente() {
  return (E.reducao || []).filter((p) => !p.cliente || p.cliente === E.clienteSel);
}

function viewReducao() {
  const planos = planosDoCliente();
  el('#pagina').innerHTML = `
    <div class="msg"><strong>O plano de redução é do cliente inteiro.</strong>
      Cada linha é uma despesa escolhida para cair, com o valor para onde ela deve ir. O valor
      ATUAL sai dos lançamentos do recorte; o ALVO sai daqui. Sem nenhuma linha, o indicador do
      topo de Indicadores Gerais fica vazio — sem alvo não há de quanto para quanto.</div>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Plano de redução de despesas</h2>
        <span class="nota">${inteiro(planos.length)} item(ns)</span></header>
      ${planos.length === 0 ? '<p class="vazio">Nenhuma despesa no plano.</p>' : `
      <div class="rol"><table>
        <thead><tr><th>Item</th><th>Despesa</th><th>Filial</th><th class="n">Valor-alvo</th>
          <th>Vigência</th><th>Situação</th><th></th></tr></thead>
        <tbody>${planos.map((p, i) => `<tr>
          <td>${esc(p.nome)}</td>
          <td>${p.tipo ? esc(p.tipo) : '<em style="color:var(--tinta3)">toda despesa do recorte</em>'}</td>
          <td>${p.filial ? esc(p.filial) : '<em style="color:var(--tinta3)">todas</em>'}</td>
          <td class="n">${brl(p.valorAlvo)}</td>
          <td>${esc(vigenciaEmTexto(p))}</td>
          <td><span class="tag ${p.ativo === false ? '' : 'bom'}">${p.ativo === false ? 'Inativo' : 'Ativo'}</span></td>
          <td><button class="bt fant peq" data-alternar-plano="${i}">${p.ativo === false ? 'Reativar' : 'Desativar'}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      <div style="margin-top:12px"><button class="bt" data-novo-plano>Adicionar ao plano</button></div>
      <p class="nota" style="margin-top:10px">A vigência decide qual alvo rege qual mês: trocar o
        alvo em janeiro não reescreve a leitura dos meses já fechados.</p>
    </section>`;

  el('#pagina').querySelector('[data-novo-plano]')?.addEventListener('click', formPlanoReducao);
  for (const bt of el('#pagina').querySelectorAll('[data-alternar-plano]')) {
    bt.addEventListener('click', async () => {
      const alvo = planos[Number(bt.dataset.alternarPlano)];
      const todos = (E.reducao || []).map((p) => (p === alvo ? { ...p, ativo: p.ativo === false } : p));
      await Loja.gravarCatalogo('reducao', todos);
      await Loja.auditar({
        acao: 'atualizar', entidade: 'plano_reducao',
        depois: { nome: alvo.nome, ativo: alvo.ativo === false },
      });
      render();
    });
  }
}

function formPlanoReducao() {
  const tipos = tiposDoEscopo();
  const filiais = filiaisDoEscopo();
  abrirModal({
    titulo: 'Adicionar ao plano de redução',
    corpo: `
      <div class="grade g2">
        <div class="campo"><label for="p-nome">Item</label><input id="p-nome" name="nome"></div>
        <div class="campo"><label for="p-tipo">Despesa</label><select id="p-tipo" name="tipo">
          <option value="">Toda despesa do recorte</option>
          ${tipos.map((t) => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`).join('')}
        </select></div>
      </div>
      <div class="grade g3">
        <div class="campo"><label for="p-filial">Filial</label><select id="p-filial" name="filial">
          <option value="">Todas</option>
          ${filiais.map((f) => `<option value="${esc(f.nome)}">${esc(f.nome)}</option>`).join('')}
        </select></div>
        <div class="campo"><label for="p-alvo">Valor-alvo (R$)</label>
          <input id="p-alvo" name="alvo" type="number" min="0" step="0.01" placeholder="0,00"></div>
        <div class="campo"><label for="p-de">Vigência de (MM/AAAA)</label>
          <input id="p-de" name="de" inputmode="numeric" placeholder="em branco: desde sempre"></div>
      </div>
      <div class="campo" style="max-width:220px"><label for="p-ate">até (MM/AAAA)</label>
        <input id="p-ate" name="ate" inputmode="numeric" placeholder="em branco: sem fim"></div>`,
    acoes: `<button type="button" class="bt" data-c>Cancelar</button>
            <button type="button" class="bt pri" data-s>Adicionar</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const nome = campo('nome').value.trim();
          if (!nome) throw new Error('Informe o nome do item.');
          if (planosDoCliente().some((p) => p.nome.toLowerCase() === nome.toLowerCase())) {
            throw new Error('Já existe um item com este nome no plano deste cliente.');
          }
          // Campo vazio vira `Number('') === 0`, que é finito e não-negativo:
          // sem a conferência do texto, "não informei" entraria como
          // "a despesa deve cair para zero".
          const bruto = String(campo('alvo').value).trim();
          const alvo = Number(bruto.replace(',', '.'));
          if (!bruto || !Number.isFinite(alvo) || alvo < 0) {
            throw new Error('Informe o valor-alvo em reais.');
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

          const novo = {
            cliente: E.clienteSel, nome,
            tipo: campo('tipo').value || null,
            filial: campo('filial').value || null,
            valorAlvo: Math.round(alvo * 100) / 100,
            vigenciaInicio: de, vigenciaFim: ate, ativo: true,
          };
          await Loja.gravarCatalogo('reducao', [...(E.reducao || []), novo]);
          await Loja.auditar({
            acao: 'criar', entidade: 'plano_reducao',
            depois: { nome, tipo: novo.tipo, alvo: novo.valorAlvo },
          });
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

/** Os itens do plano que regem esta competência. */
function planosVigentes(competencia) {
  const comp = competencia || mesHoje();
  return planosDoCliente().filter((p) =>
    p.ativo !== false &&
    (!p.vigenciaInicio || p.vigenciaInicio <= comp) &&
    (!p.vigenciaFim || p.vigenciaFim >= comp));
}

// ===========================================================================
// QUEM RECONHECE DESPESA
// ===========================================================================
//
// A lista de quem, na origem, lança despesa que já nasce conferida. É cadastro
// do CLIENTE, como o plano de redução: a mesma pessoa lança para todas as
// unidades do grupo.
//
// O valor guardado é um NOME DE USUÁRIO DE OUTRO SISTEMA, texto livre — não há
// id interno para referenciar, e exigir um usuário cadastrado aqui faria o
// cadastro não cobrir justamente quem não usa este sistema.

/**
 * A forma comparável do nome: maiúsculas, sem acento, sem espaço.
 *
 * O ERP escreve `MIQUEIASSILVA`; a pessoa cadastra `Miqueias Silva`. São o
 * mesmo usuário, e sem normalizar o cadastro nunca alcançaria a carga.
 */
function chaveDoUsuario(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function reconhecedoresDoCliente() {
  return (E.reconhecedores || []).filter((r) => !r.cliente || r.cliente === E.clienteSel);
}

/** Este usuário da origem reconhece despesa? Só o cadastro ATIVO conta. */
function reconhecePorOrigem(usuarioOrigem) {
  const chave = chaveDoUsuario(usuarioOrigem);
  if (!chave) return false;
  return reconhecedoresDoCliente().some((r) => r.ativo !== false && chaveDoUsuario(r.usuario) === chave);
}

/**
 * O que a aplicação retroativa mudaria. Não grava nada.
 *
 * `usuarioOrigem` só existe em lançamento que entrou pela carga de Contas a
 * Pagar do servidor — e é por isso que a tela diz, quando ninguém tem o campo,
 * que não há o que aplicar. Contar "0 de 0" sem explicar por quê faria o
 * gestor achar que o cadastro não funciona.
 */
function avaliarReconhecimento() {
  const resumo = { avaliados: 0, reconhecidos: 0, jaReconhecidos: 0, semOrigem: 0, foraDoCadastro: 0, marcar: [] };
  for (const l of Loja.todosDoEscopo()) {
    resumo.avaliados += 1;
    if (reconhecidoDe(l)) { resumo.jaReconhecidos += 1; continue; }
    if (!l.usuarioOrigem) { resumo.semOrigem += 1; continue; }
    if (!reconhecePorOrigem(l.usuarioOrigem)) { resumo.foraDoCadastro += 1; continue; }
    resumo.reconhecidos += 1;
    resumo.marcar.push(l);
  }
  return resumo;
}

function resumoReconhecimentoHtml(r, aplicado) {
  return `<div class="msg ${aplicado ? 'ok' : ''}" data-resumo-reconhecimento>
    <strong>${aplicado ? 'Reconhecimento aplicado.' : 'Prévia — nada foi gravado.'}</strong>
    <dl class="ficha" style="margin-top:6px">
      <dt>Lançamentos avaliados</dt><dd>${inteiro(r.avaliados)}</dd>
      <dt>${aplicado ? 'Reconhecidos agora' : 'Seriam reconhecidos'}</dt><dd>${inteiro(r.reconhecidos)}</dd>
      <dt>Já estavam reconhecidos</dt><dd>${inteiro(r.jaReconhecidos)}</dd>
      <dt>Criador fora do cadastro</dt><dd>${inteiro(r.foraDoCadastro)}</dd>
      <dt>Sem criador na origem</dt><dd>${inteiro(r.semOrigem)}</dd>
    </dl>
  </div>`;
}

function viewReconhecedores() {
  const lista = reconhecedoresDoCliente();
  el('#pagina').innerHTML = `
    <div class="msg"><strong>O cadastro é do cliente inteiro.</strong>
      Toda despesa que entra por carga nasce POR RECONHECER, e alguém precisa olhar uma a uma.
      Parte dela, porém, vem de quem já conferiu na origem: o documento criado pela própria equipe
      de TI no sistema do cliente chega revisado. Quem está nesta lista dispensa essa conferência.</div>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Quem reconhece despesa</h2>
        <span class="nota">${inteiro(lista.length)} pessoa(s)</span></header>
      ${lista.length === 0 ? '<p class="vazio">Ninguém cadastrado — toda a carga vai nascer por reconhecer.</p>' : `
      <div class="rol"><table>
        <thead><tr><th>Usuário na origem</th><th>Nome</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((r, i) => `<tr>
          <td><code>${esc(r.usuario)}</code></td>
          <td>${r.nome ? esc(r.nome) : '<em style="color:var(--tinta3)">—</em>'}</td>
          <td><span class="tag ${r.ativo === false ? '' : 'bom'}">${r.ativo === false ? 'Inativo' : 'Ativo'}</span></td>
          <td><button class="bt fant peq" data-alternar-rec="${i}">${r.ativo === false ? 'Reativar' : 'Desativar'}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      <div style="margin-top:12px"><button class="bt" data-novo-rec>Adicionar pessoa</button></div>
      <p class="nota" style="margin-top:10px">A comparação ignora acento, espaço e caixa:
        <code>Miqueias Silva</code> e <code>MIQUEIASSILVA</code> são a mesma pessoa. Desativar quem
        saiu do time faz a próxima carga dele nascer por reconhecer, sem apagar o que já entrou.</p>
    </section>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Aplicar ao que já está na base</h2></header>
      <p class="nota">O cadastro decide na ENTRADA da carga. Aqui ele alcança o que já foi
        carregado — veja o que mudaria e só então aplique. Nada é recalculado sozinho: um número
        apresentado numa reunião não pode mudar porque alguém mexeu numa lista.</p>
      <div class="acoes" style="justify-content:flex-start;margin-top:10px">
        <button class="bt" data-previa-rec>Ver o que mudaria</button>
        <button class="bt pri" data-aplicar-rec>Aplicar</button>
      </div>
      <div data-saida-rec style="margin-top:12px"></div>
    </section>`;

  el('#pagina').querySelector('[data-novo-rec]')?.addEventListener('click', formReconhecedor);
  for (const bt of el('#pagina').querySelectorAll('[data-alternar-rec]')) {
    bt.addEventListener('click', async () => {
      const alvo = lista[Number(bt.dataset.alternarRec)];
      const todos = (E.reconhecedores || []).map((r) => (r === alvo ? { ...r, ativo: r.ativo === false } : r));
      await Loja.gravarCatalogo('reconhecedores', todos);
      await Loja.auditar({
        acao: 'atualizar', entidade: 'reconhecedor_origem',
        depois: { usuario: alvo.usuario, ativo: alvo.ativo === false },
      });
      render();
    });
  }
  ligarAplicacaoDeReconhecimento();
}

function ligarAplicacaoDeReconhecimento() {
  const saida = el('#pagina').querySelector('[data-saida-rec]');
  if (!saida) return;

  el('#pagina').querySelector('[data-previa-rec]')?.addEventListener('click', () => {
    saida.innerHTML = resumoReconhecimentoHtml(avaliarReconhecimento(), false);
  });

  el('#pagina').querySelector('[data-aplicar-rec]')?.addEventListener('click', async () => {
    const r = avaliarReconhecimento();
    if (!r.marcar.length) {
      saida.innerHTML = resumoReconhecimentoHtml(r, false);
      return;
    }
    // `alternarReconhecimento` opera dentro de UMA matriz por vez, porque a
    // trilha do lançamento é por empresa. O cadastro é do cliente, então o
    // agrupamento acontece aqui.
    const porEmpresa = new Map();
    for (const l of r.marcar) {
      if (!porEmpresa.has(l.empresa)) porEmpresa.set(l.empresa, []);
      porEmpresa.get(l.empresa).push(l);
    }
    for (const alvos of porEmpresa.values()) await alternarReconhecimento(alvos, true, 'cadastro_origem');
    await Loja.auditar({
      acao: 'aplicar', entidade: 'reconhecedor_origem',
      depois: { avaliados: r.avaliados, reconhecidos: r.reconhecidos },
    });
    render();
    const novaSaida = el('#pagina').querySelector('[data-saida-rec]');
    if (novaSaida) novaSaida.innerHTML = resumoReconhecimentoHtml(r, true);
  });
}

function formReconhecedor() {
  abrirModal({
    titulo: 'Adicionar quem reconhece despesa',
    corpo: `
      <div class="grade g2">
        <div class="campo"><label for="r-usuario">Usuário na origem</label>
          <input id="r-usuario" name="usuario" placeholder="como aparece na carga, ex.: MIQUEIASSILVA"></div>
        <div class="campo"><label for="r-nome">Nome</label>
          <input id="r-nome" name="nome" placeholder="opcional, para quem lê a lista"></div>
      </div>`,
    acoes: `<button type="button" class="bt" data-c>Cancelar</button>
            <button type="button" class="bt pri" data-s>Adicionar</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const usuario = campo('usuario').value.trim();
          if (!usuario) throw new Error('Informe o usuário da origem, como ele aparece na carga.');
          const chave = chaveDoUsuario(usuario);
          if (!chave) throw new Error('O usuário da origem precisa ter ao menos uma letra ou número.');
          const existente = reconhecedoresDoCliente().find((r) => chaveDoUsuario(r.usuario) === chave);
          if (existente) throw new Error(`"${existente.usuario}" já está na lista — é o mesmo usuário.`);

          const novo = {
            cliente: E.clienteSel, usuario,
            nome: campo('nome').value.trim() || null, ativo: true,
          };
          await Loja.gravarCatalogo('reconhecedores', [...(E.reconhecedores || []), novo]);
          await Loja.auditar({ acao: 'criar', entidade: 'reconhecedor_origem', depois: { usuario, nome: novo.nome } });
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}
