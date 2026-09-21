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
