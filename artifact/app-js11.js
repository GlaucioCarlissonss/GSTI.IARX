// ===========================================================================
// Aba Dados — a ponte com o Excel, que é onde o gestor já trabalha.
// ===========================================================================
const ROTULO_ESCOPO = { cliente: 'Cliente inteiro', empresas: 'Empresas', unidades: 'Unidades' };

/** As linhas do histórico de cargas. Serve à montagem e ao refresco no lugar. */
function linhasHistoricoCargas(cargas) {
  if (!cargas.length) return '<tr><td colspan="9" class="vazio">Nenhuma carga registrada neste escopo.</td></tr>';
  return cargas
    .map(
      (c) => `<tr${c.status === 'recusada' ? ' title="' + esc(c.mensagem || '') + '"' : ''}>
        <td>${esc(new Date(c.quando).toLocaleString('pt-BR'))}</td>
        <td>${c.modo === 'inicial' ? 'Inicial' : 'Incremental'}</td>
        <td title="${esc(c.unidades || '')}">${esc(ROTULO_ESCOPO[c.escopo || 'cliente'] || '—')}</td>
        <td>${esc(c.arquivo || '—')}</td>
        <td>${c.status === 'recusada' ? '<span class="tag crit">Recusada</span>' : '<span class="tag bom">Concluída</span>'}</td>
        <td class="num">${inteiro(c.lidas)}</td><td class="num">${inteiro(c.criadas)}</td>
        <td class="num">${inteiro(c.duplicadas)}</td><td class="num">${inteiro(c.invalidas)}</td>
      </tr>`,
    )
    .join('');
}

/**
 * As cargas de TODAS as unidades do escopo, mais recentes primeiro.
 *
 * O registro é guardado por matriz — é assim que ele é lido e gravado —, mas a
 * pergunta "por que os dados não entraram?" é do cliente: quem pergunta não sabe
 * de antemão em qual unidade a carga foi feita.
 */
async function cargasDoEscopo(escopo) {
  const listas = [];
  for (const id of empresasDoEscopoOp(escopo)) listas.push(await cargasDaEmpresa(id));
  return listas.flat().sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
}

/**
 * Atualiza o histórico SEM remontar a tela: o relatório da carga que acabou de
 * rodar está logo acima, e remontar apagaria justamente o que a pessoa foi ler.
 */
async function refrescarHistoricoCargas(escopo) {
  const corpo = el('#d-historico');
  if (corpo) corpo.innerHTML = linhasHistoricoCargas(await cargasDoEscopo(escopo));
}

/**
 * O seletor de ESCOPO da operação — o mesmo para exportar e importar.
 *
 * Antes havia uma unidade em foco, e a operação era dela. Agora o padrão é o
 * cliente inteiro, com o contador dizendo, em números, o que está marcado.
 */
function seletorEscopoHtml(escopo) {
  const empresas = matrizesDoClienteAtivo();
  const filiais = empresas.flatMap(filiaisDa);
  // Com uma matriz só e nenhuma filial, os três modos dizem a mesma coisa.
  if (empresas.length <= 1 && !filiais.length) return '';
  const opcao = (chave, rotulo, apoio) => `<label title="${esc(apoio)}" style="display:flex;gap:6px;align-items:center">
      <input type="radio" name="d-escopo" value="${chave}"${escopo.modo === chave ? ' checked' : ''}> ${esc(rotulo)}</label>`;
  const caixas = (id, lista, marcados, rotuloDe) => `<div class="campo" style="min-width:230px">
      <label for="${id}">${id === 'd-esc-emp' ? 'Empresas (matrizes)' : 'Filiais'}</label>
      <div id="${id}" class="rol" style="max-height:150px;padding:6px;border:1px solid var(--borda);border-radius:8px">
        ${lista.map((x) => `<label style="display:flex;gap:6px;align-items:center;padding:2px 0">
            <input type="checkbox" value="${x.id}"${marcados.includes(x.id) ? ' checked' : ''}> ${esc(rotuloDe(x))}</label>`).join('')}
      </div></div>`;

  return `<section class="bloco" id="d-escopo-bloco">
    <header><h2>Escopo da operação</h2><span class="nota" id="d-escopo-resumo">${esc(resumoEscopoOp(escopo))}</span></header>
    <div class="msg">Vale para exportar E importar. O arquivo traz a coluna <strong>Empresa</strong>, então um arquivo
      só atende todas as unidades do escopo — e volta para elas na reimportação.</div>
    <div style="display:flex;flex-wrap:wrap;gap:16px;margin:10px 0;font-size:13px">
      ${opcao('cliente', 'Cliente inteiro', 'Todas as empresas e filiais deste cliente, num arquivo só.')}
      ${opcao('empresas', 'Empresas selecionadas', 'As matrizes marcadas. As filiais de cada uma entram junto.')}
      ${opcao('unidades', 'Unidades específicas', 'Matrizes e filiais marcadas uma a uma.')}
    </div>
    <div id="d-escopo-listas" style="display:${escopo.modo === 'cliente' ? 'none' : 'flex'};flex-wrap:wrap;gap:14px;align-items:flex-start">
      ${caixas('d-esc-emp', empresas.map((id) => ({ id, nome: nomeEmpresa(id) })), escopo.empresas, (x) => x.nome)}
      <div id="d-esc-fil-caixa" style="display:${escopo.modo === 'unidades' ? 'block' : 'none'}">
        ${caixas('d-esc-fil', filiais, escopo.filiais, (f) => f.nome + (f.uf ? ' — ' + f.uf : '') + ' · ' + nomeEmpresa(f.empresa))}
      </div>
      <div style="display:flex;gap:8px;padding-top:22px">
        <button type="button" class="bt" id="d-esc-todas">Selecionar todas</button>
        <button type="button" class="bt" id="d-esc-limpar">Limpar seleção</button>
      </div>
    </div>
  </section>`;
}

/**
 * Liga o seletor de escopo.
 *
 * Trocar de MODO remonta a tela: muda o que existe nela. Marcar uma caixa, não
 * — remontar a cada clique destruiria a lista debaixo do cursor e faria a
 * segunda marcação cair no vazio. A caixa grava o escopo e atualiza os dois
 * lugares que mostram o número; quem exporta ou importa lê o escopo na hora.
 */
function ligarSeletorEscopo() {
  const bloco = el('#d-escopo-bloco');
  if (!bloco) return;
  const atual = () => escopoOperacao();
  const remontar = (novo) => { gravarEscopoOperacao(novo); render(); };

  // Os identificadores de empresa e filial aqui são TEXTO ("alianca", "union"),
  // não número: converter transformaria cada marcação em NaN e o escopo em
  // uma lista de nulos que silenciosamente volta a valer o cliente inteiro.
  const marcados = (id) => [...bloco.querySelectorAll('#' + id + ' input:checked')].map((c) => c.value);
  const semRemontar = (novo) => {
    gravarEscopoOperacao(novo);
    const resumo = el('#d-escopo-resumo');
    if (resumo) resumo.textContent = resumoEscopoOp(novo);
    const linha = el('#d-resumo-exp');
    if (linha) {
      const total = empresasDoEscopoOp(novo).reduce((soma, id) => soma + Loja.todos(id).length, 0);
      linha.innerHTML = 'Tudo de <strong>' + esc(resumoEscopoOp(novo)) + '</strong>: ' + inteiro(total) +
        ' lançamentos, em todas as competências e cenários, num arquivo só.';
    }
  };

  bloco.querySelectorAll('input[name="d-escopo"]').forEach((r) => {
    r.onchange = () => {
      const modo = r.value;
      // Sair do modo "cliente" sem nada marcado deixaria o escopo vazio. Marcar
      // tudo é o ponto de partida honesto: a pessoa desmarca o que não quer.
      if (modo === 'empresas') return remontar({ modo, empresas: matrizesDoClienteAtivo(), filiais: [] });
      if (modo === 'cliente') return remontar({ modo, empresas: [], filiais: [] });
      remontar({ ...atual(), modo });
    };
  });

  bloco.querySelectorAll('#d-esc-emp input, #d-esc-fil input').forEach((c) => {
    c.onchange = () => semRemontar({ ...atual(), empresas: marcados('d-esc-emp'), filiais: marcados('d-esc-fil') });
  });
  el('#d-esc-todas').onclick = () => remontar({ ...atual(), empresas: matrizesDoClienteAtivo(), filiais: [] });
  el('#d-esc-limpar').onclick = () => remontar({ ...atual(), empresas: [], filiais: [] });
}

async function viewDados() {
  const escopo = escopoOperacao();
  const empresasEscopo = empresasDoEscopoOp(escopo);
  if (!empresasEscopo.length) {
    // Sem nenhuma matriz não há arquivo: filiais, tipos e cenários pertencem a
    // uma, e a carga precisa ter para onde ir.
    el('#pagina').innerHTML = '<div class="msg alerta"><strong>Este cliente ainda não tem unidade cadastrada.</strong> '
      + 'Importar e exportar precisam de ao menos uma empresa: o arquivo traz as filiais, os tipos e os cenários dela. '
      + 'Cadastre a matriz em <strong>Clientes e unidades</strong>.</div>';
    return;
  }
  const total = empresasEscopo.reduce((soma, id) => soma + Loja.todos(id).length, 0);
  const cargas = await cargasDoEscopo(escopo);
  if (!E.mapeamentos.length) await carregarMapeamentos();
  const meusMapas = (E.mapeamentos || []).filter((m) => m.cliente === E.clienteSel);

  el('#pagina').innerHTML = `
    ${seletorEscopoHtml(escopo)}
    <div class="msg">O mesmo modelo serve para exportar e importar. Exporte, edite no Excel e reimporte:
      as linhas que já existem são reconhecidas e <strong>não duplicam</strong>; as inválidas entram num
      relatório com o número da linha e o motivo, <strong>sem derrubar o lote</strong>.</div>

    <div class="grade g2">
      <section class="bloco">
        <header><h2>Exportar</h2><span class="nota">modelo ${MODELO_VERSAO}</span></header>
        <p style="color:var(--tinta2);margin:0 0 14px" id="d-resumo-exp">Tudo de
          <strong>${esc(resumoEscopoOp(escopo))}</strong>: ${inteiro(total)} lançamentos, em todas as
          competências e cenários, num arquivo só.</p>
        <div class="filtros" style="padding:0;border:0;margin-bottom:12px">
          <div class="campo"><label for="d-modulo">Módulo</label><select id="d-modulo">
            ${Object.entries(MODULOS).map(([k,v]) => `<option value="${k}">${esc(v.rotulo)}</option>`).join('')}
          </select></div>
          <div class="campo"><label for="d-formato">Formato</label><select id="d-formato">
            <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option>
          </select></div>
        </div>
        <p class="nota" id="d-nota-csv" hidden style="margin:0 0 12px">
          CSV guarda uma aba só; para o módulo completo, prefira .xlsx.</p>
        <button type="button" class="bt pri" id="d-exportar" data-escreve="export">Gerar arquivo</button>
        <div class="msg" id="d-saida-exp" hidden style="margin-top:14px"></div>
      </section>

      <section class="bloco">
        <header><h2>Importar</h2></header>
        <p style="color:var(--tinta2);margin:0 0 14px">Aceita o arquivo exportado daqui e também planilhas
          suas, desde que a aba se chame <code>Financeiro</code>, <code>SLA</code>, <code>Projetos</code>…
          Cabeçalhos são reconhecidos por apelido (<code>centro de custo</code> vale por
          <code>tipo de despesa</code>).</p>
        <div class="campo" style="margin-bottom:12px">
          <label for="d-arquivo">Arquivo .xlsx ou .csv</label>
          <input type="file" id="d-arquivo" accept=".xlsx,.csv,.txt" data-escreve="import">
        </div>
        <div class="campo" style="margin-bottom:12px">
          <label for="d-modo">Tipo de carga</label>
          <select id="d-modo">
            <option value="incremental">Incremental (arquivo do período)</option>
            <option value="inicial">Inicial (histórico completo)</option>
          </select>
        </div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;font-size:13px">
          <input type="checkbox" id="d-criar" checked style="margin-top:2px">
          <span>Criar filiais, tipos de despesa e cenários que ainda não existirem</span></label>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:14px;font-size:13px">
          <input type="checkbox" id="d-simular" checked style="margin-top:2px">
          <span><strong>Só conferir</strong> — mostra o que aconteceria, sem gravar nada</span></label>
        <button type="button" class="bt pri" id="d-importar" disabled data-escreve="import">Processar arquivo</button>
        <div id="d-saida-imp"></div>
      </section>
    </div>

    <section class="bloco">
      <header><h2>Histórico de cargas</h2><span class="nota">${inteiro(cargas.length)}</span></header>
      <div class="msg">Toda tentativa entra aqui — inclusive a recusada, que é justamente a que se investiga
        depois. A conferência (“só conferir”) não entra: prévia não é carga.</div>
      <div class="rol" style="margin-top:12px"><table>
        <thead><tr><th>Quando</th><th>Tipo</th><th>Escopo</th><th>Arquivo</th><th>Situação</th>
          <th class="num">Lidas</th><th class="num">Criadas</th><th class="num">Duplicadas</th><th class="num">Inválidas</th></tr></thead>
        <tbody id="d-historico">${linhasHistoricoCargas(cargas)}</tbody></table></div>
      ${cargas.filter((c) => c.status === 'recusada' && c.mensagem).slice(0, 2).map((c) =>
        `<div class="msg erro" style="margin-top:10px">${esc(new Date(c.quando).toLocaleString('pt-BR'))} —
          ${esc(c.arquivo || 'arquivo')}: ${esc(c.mensagem)}</div>`).join('')}
    </section>

    <section class="bloco">
      <header><h2>Cabeçalhos deste cliente</h2><span class="nota">${inteiro(meusMapas.length)}</span></header>
      <div class="msg">Onde o modelo diz <strong>Valor</strong>, a planilha de um cliente pode dizer
        <em>Vlr Total</em>. Cadastrar a equivalência evita reescrever o cabeçalho a cada carga — e o nome do
        modelo continua sendo aceito do mesmo jeito. Vale para todas as matrizes deste cliente.</div>
      ${meusMapas.length ? `<div class="rol" style="margin-top:12px"><table>
        <thead><tr><th>Aba</th><th>Coluna do modelo</th><th>Cabeçalho aceito</th><th></th></tr></thead>
        <tbody>${meusMapas.map((m) => `<tr><td>${esc(m.aba)}</td><td>${esc(m.coluna)}</td>
          <td>${esc(m.apelido)}</td>
          <td><button type="button" class="bt pequeno" data-escreve="edit" data-remover-mapa="${esc(m.id)}">Remover</button></td>
        </tr>`).join('')}</tbody></table></div>` : ''}
      <div class="filtros" style="margin-top:12px;box-shadow:none;border:0;padding:0">
        <div class="campo"><label for="mp-aba">Aba</label><select id="mp-aba">
          ${Object.keys(ABAS_MODELO).filter((n) => n !== 'Modelo').map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
        </select></div>
        <div class="campo"><label for="mp-coluna">Coluna do modelo</label><select id="mp-coluna"></select></div>
        <div class="campo"><label for="mp-apelido">Cabeçalho na planilha do cliente</label>
          <input id="mp-apelido" style="min-width:220px"></div>
        <button type="button" class="bt pri" id="mp-criar" data-escreve="edit">Cadastrar cabeçalho</button>
      </div>
      <div class="msg erro" id="mp-erro" hidden style="margin-top:10px"></div>
    </section>

    <section class="bloco">
      <header><h2>Colunas do modelo</h2><span class="nota">versão ${MODELO_VERSAO}</span></header>
      <div class="rol"><table><thead><tr><th>Aba</th><th>Colunas</th><th>Obrigatórias</th></tr></thead>
        <tbody>${Object.entries(ABAS_MODELO).filter(([n]) => n !== 'Modelo').map(([nome, def]) => `<tr>
          <td><strong>${esc(nome)}</strong></td>
          <td style="font-size:12px">${def.colunas.map(esc).join(' · ')}</td>
          <td style="font-size:12px">${def.obrigatorias.length ? def.obrigatorias.map(esc).join(' · ') : '—'}</td>
        </tr>`).join('')}</tbody></table></div>
    </section>`;

  ligarSeletorEscopo();

  const fmt = el('#d-formato');
  fmt.onchange = () => { el('#d-nota-csv').hidden = fmt.value !== 'csv'; };

  // --------------------------------------------- adaptador de cabeçalho
  const selAba = el('#mp-aba'), selColuna = el('#mp-coluna');
  const pintarColunas = () => {
    selColuna.innerHTML = (ABAS_MODELO[selAba.value] || { colunas: [] }).colunas
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  };
  selAba.onchange = pintarColunas;
  pintarColunas();

  el('#mp-criar').onclick = async () => {
    const caixa = el('#mp-erro');
    caixa.hidden = true;
    try {
      if (!E.clienteSel) throw new Error('Escolha um cliente antes de cadastrar cabeçalhos.');
      await criarMapeamento(E.clienteSel, {
        aba: selAba.value, coluna: selColuna.value, apelido: el('#mp-apelido').value,
      });
      render();
    } catch (e) {
      caixa.hidden = false;
      caixa.textContent = e.message || String(e);
    }
  };

  el('#pagina').querySelectorAll('[data-remover-mapa]').forEach((b) => {
    b.onclick = async () => {
      try { await removerMapeamento(b.dataset.removerMapa); render(); }
      catch (e) { const c = el('#mp-erro'); c.hidden = false; c.textContent = e.message || String(e); }
    };
  });

  el('#d-exportar').onclick = async (ev) => {
    const bt = ev.currentTarget, saida = el('#d-saida-exp');
    bt.disabled = true; bt.textContent = 'Gerando…'; saida.hidden = true; saida.className = 'msg';
    try {
      const modulo = el('#d-modulo').value;
      const escopoAgora = escopoOperacao();
      if (!escopoOpCompleto(escopoAgora)) {
        throw new Error('Nenhuma unidade marcada no escopo da operação. Marque ao menos uma, ' +
          'ou volte para "Cliente inteiro".');
      }
      const abas = await montarAbasDoEscopo(escopoAgora, modulo);
      const carimbo = new Date().toISOString().slice(0,10);
      const empresasAgora = empresasDoEscopoOp(escopoAgora);
      // O nome diz de quem é o arquivo: o cliente, quando é o cliente inteiro;
      // a unidade, quando é uma só; a contagem, quando são algumas.
      const alvo = escopoAgora.modo === 'cliente'
        ? ((clientePorId(E.clienteSel) || {}).nome || 'cliente')
        : empresasAgora.length === 1 ? nomeEmpresa(empresasAgora[0]) : empresasAgora.length + '-unidades';
      const nome = `gsti-${String(alvo).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${modulo}-${carimbo}`;
      let dados, arquivo;
      if (fmt.value === 'csv') {
        const principal = abas.find((a) => a.linhas.length && a.nome !== 'Modelo') || abas[1] || abas[0];
        dados = escreverCsv(principal.colunas, principal.linhas);
        arquivo = `${nome}-${principal.nome.toLowerCase()}.csv`;
      } else {
        dados = escreverXlsx(abas);
        arquivo = `${nome}.xlsx`;
      }
      const downloads = await window.claude?.use?.('downloads');
      if (!downloads) throw new Error('Esta visualização não pode salvar arquivos. Abra o sistema pelo link do artifact.');
      await downloads.save({ filename: arquivo, data: dados });
      const linhas = abas.reduce((s, a) => s + (a.nome === 'Modelo' ? 0 : a.linhas.length), 0);
      saida.hidden = false;
      saida.innerHTML = `<strong>${esc(arquivo)}</strong> — ${inteiro(linhas)} linhas em
        ${abas.filter((a)=>a.nome!=='Modelo').length} aba(s).`;
      await Loja.auditar({ acao:'exportar', entidade:'planilha', id:arquivo,
        depois:{ modulo, formato: fmt.value, linhas,
          escopo: escopoAgora.modo, unidades: resumoEscopoOp(escopoAgora) } });
    } catch (e) {
      if (e && e.code === 'declined') { saida.hidden = false; saida.className = 'msg'; saida.textContent = 'Download cancelado.'; }
      else { saida.hidden = false; saida.className = 'msg erro'; saida.textContent = e.message || String(e); }
    } finally { bt.disabled = false; bt.textContent = 'Gerar arquivo'; }
  };

  const campoArquivo = el('#d-arquivo'), btImp = el('#d-importar');
  campoArquivo.onchange = () => { btImp.disabled = !campoArquivo.files.length; el('#d-saida-imp').innerHTML = ''; };

  btImp.onclick = async (ev) => {
    const bt = ev.currentTarget, saida = el('#d-saida-imp');
    const arq = campoArquivo.files[0];
    if (!arq) return;
    const simular = el('#d-simular').checked;
    bt.disabled = true; bt.textContent = 'Lendo…';
    saida.innerHTML = '<div class="carregando" style="padding:16px 0"><span class="giro"></span> Processando…</div>';
    try {
      let abas;
      if (/\.xlsx$/i.test(arq.name)) {
        abas = await lerXlsx(new Uint8Array(await arq.arrayBuffer()));
      } else {
        const texto = await lerTextoDoArquivo(arq);
        const { colunas, linhas } = lerCsv(texto);
        abas = [{ nome: nomeDeAbaPeloCabecalho(colunas), colunas, linhas }];
      }
      const escopoAgora = escopoOperacao();
      if (!escopoOpCompleto(escopoAgora)) {
        throw new Error('Nenhuma unidade marcada no escopo da operação. Marque ao menos uma, ' +
          'ou volte para "Cliente inteiro".');
      }
      const rel = await importarArquivoNoEscopo(escopoAgora, abas, {
        criarCadastros: el('#d-criar').checked,
        simular,
        modo: el('#d-modo').value,
        modulo: 'completo',
        arquivo: arq.name,
        confirmar: bt.dataset.confirmar === '1',
      });
      delete bt.dataset.confirmar;
      if (!simular) {
        E.lanc.clear(); E.mesesCarregados.clear(); E.projetos.clear(); E.sla.clear();
        for (const id of empresasDoEscopoOp(escopoAgora)) await garantirDados(id);
      }
      saida.innerHTML = relatorioHtml(rel, simular, arq.name);
      if (!simular) await refrescarHistoricoCargas(escopoAgora);
      if (!simular) {
        await Loja.auditar({ acao:'importar', entidade:'planilha', id:arq.name,
          depois:{ abas: rel.abas.map((a) => a.nome + ':' + (a.criadas ?? 0)).join(', '),
            invalidas: rel.invalidas.length,
            escopo: escopoAgora.modo, unidades: resumoEscopoOp(escopoAgora) } });
      }
      const btGravar = el('#d-gravar');
      if (btGravar) btGravar.onclick = () => { el('#d-simular').checked = false; btImp.click(); };
    } catch (e) {
      // A recusa da carga inicial não é um beco: ela existe para a confirmação
      // ser informada, e o botão de confirmar vem junto do motivo.
      if (e && e.precisaConfirmar) {
        saida.innerHTML = `<div class="msg erro" style="margin-top:14px">${esc(e.message)}
          <div style="margin-top:10px"><button type="button" class="bt" id="d-confirmar" data-escreve="import">
            Confirmar a carga inicial mesmo assim</button></div></div>`;
        await refrescarHistoricoCargas(escopoOperacao());
        const btConf = el('#d-confirmar');
        if (btConf) btConf.onclick = () => { bt.dataset.confirmar = '1'; el('#d-simular').checked = false; bt.click(); };
      } else {
        saida.innerHTML = `<div class="msg erro" style="margin-top:14px"><strong>Não foi possível ler o arquivo.</strong> ${esc(e.message || e)}</div>`;
      }
    } finally { bt.disabled = false; bt.textContent = 'Processar arquivo'; }
  };
}

/** Excel pt-BR grava CSV em Windows-1252; um caractere de substituição denuncia. */
async function lerTextoDoArquivo(arq) {
  const bytes = new Uint8Array(await arq.arrayBuffer());
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  try { return new TextDecoder('windows-1252').decode(bytes); } catch { return utf8; }
}

/** CSV não tem nome de aba: descobre pelo cabeçalho a qual modelo pertence. */
/**
 * Qual aba este CSV é, pelo cabeçalho.
 *
 * Vence a aba que EXPLICA MAIS COLUNAS DO ARQUIVO, e só depois disso conta ter
 * todas as obrigatórias. A ordem importa: um financeiro com a coluna de valor
 * escrita de outro jeito tem todas as colunas de `TiposDespesa` presentes
 * (é só "Tipo de Despesa"), e pela regra anterior entrava como catálogo — o
 * arquivo virava cadastro de tipo, em silêncio. Melhor apontar a coluna que
 * falta no Financeiro do que acertar a aba errada sem avisar.
 */
function nomeDeAbaPeloCabecalho(colunas) {
  let melhor = 'Financeiro', pontos = -1;
  for (const [nome, def] of Object.entries(ABAS_MODELO)) {
    if (nome === 'Modelo') continue;
    const mapa = mapearColunas(nome, colunas);
    const faltando = def.obrigatorias.filter((c) => !mapa.has(c)).length;
    const p = mapa.size + (faltando === 0 ? 0.5 : 0);
    if (p > pontos) { pontos = p; melhor = nome; }
  }
  return melhor;
}

function relatorioHtml(rel, simular, nomeArquivo) {
  if (rel.semAbasConhecidas) {
    return `<div class="msg erro" style="margin-top:14px"><strong>Nenhuma aba reconhecida em ${esc(nomeArquivo)}.</strong>
      Renomeie a aba para Financeiro, SLA, Projetos, Tarefas, Envolvidos, Filiais, TiposDespesa ou Cenarios.</div>`;
  }
  const criadas = rel.abas.reduce((s, a) => s + (a.criadas || 0), 0);
  const duplicadas = rel.abas.reduce((s, a) => s + (a.duplicadas || 0), 0);
  const cab = simular
    ? `<strong>Simulação de ${esc(nomeArquivo)} — nada foi gravado.</strong> Seriam criados
       ${inteiro(criadas)} registro(s); ${inteiro(duplicadas)} já existem; ${inteiro(rel.invalidas.length)} linha(s) inválida(s).`
    : `<strong>${esc(nomeArquivo)} importado.</strong> ${inteiro(criadas)} registro(s) criado(s),
       ${inteiro(duplicadas)} já existiam (ignorados), ${inteiro(rel.invalidas.length)} inválido(s).`;
  const versao = rel.versaoArquivo && rel.versaoArquivo !== MODELO_VERSAO
    ? `<div class="msg alerta" style="margin-top:10px">Arquivo no modelo ${esc(rel.versaoArquivo)};
       o atual é ${MODELO_VERSAO}. Os cabeçalhos conhecidos foram mapeados mesmo assim.</div>` : '';
  const cadastros = rel.criouCadastros && (rel.criouCadastros.tipos.length + rel.criouCadastros.filiais.length + rel.criouCadastros.cenarios.length)
    ? `<div class="msg" style="margin-top:10px">Cadastros criados:
        ${[['tipo de despesa', rel.criouCadastros.tipos], ['filial', rel.criouCadastros.filiais], ['cenário', rel.criouCadastros.cenarios]]
          .filter(([, v]) => v.length).map(([r, v]) => `${v.length} ${r}(s) — ${v.map(esc).join(', ')}`).join(' · ')}</div>` : '';

  return `
    <div class="msg ${simular ? '' : 'bom'}" style="margin-top:14px">${cab}</div>
    ${versao}${cadastros}
    <div class="rol" style="margin-top:12px"><table>
      <thead><tr><th>Aba</th><th class="n">Lidas</th><th class="n">${simular?'A criar':'Criadas'}</th>
        <th class="n">Já existiam</th><th class="n">Inválidas</th></tr></thead>
      <tbody>${rel.abas.map((a) => a.erro
        ? `<tr><td><strong>${esc(a.nome)}</strong></td><td colspan="4" style="color:var(--crit)">${esc(a.erro)}</td></tr>`
        : `<tr><td><strong>${esc(a.nome)}</strong></td><td class="n">${inteiro(a.lidas)}</td>
           <td class="n">${inteiro(a.criadas)}</td><td class="n">${inteiro(a.duplicadas)}</td>
           <td class="n">${a.invalidas ? '<span class="tag crit">'+inteiro(a.invalidas)+'</span>' : '0'}</td></tr>`).join('')}
      </tbody></table></div>
    ${rel.invalidas.length ? `
      <section class="bloco" style="margin-top:14px">
        <header><h2>Linhas que não entraram</h2><span class="nota">${inteiro(rel.invalidas.length)} de ${inteiro(rel.abas.reduce((s,a)=>s+(a.lidas||0),0))}</span></header>
        <div class="rol"><table><thead><tr><th>Aba</th><th class="n">Linha</th><th>Motivo</th></tr></thead>
        <tbody>${rel.invalidas.slice(0, 200).map((x) => `<tr><td>${esc(x.aba)}</td>
          <td class="n">${x.linha}</td><td>${esc(x.motivo)}</td></tr>`).join('')}</tbody></table></div>
        ${rel.invalidas.length > 200 ? `<p class="nota">Mostrando as 200 primeiras.</p>` : ''}
      </section>` : ''}
    ${simular && criadas ? `<div style="margin-top:14px"><button type="button" class="bt pri" id="d-gravar" data-escreve="import">Confirmar e gravar ${inteiro(criadas)} registro(s)</button></div>` : ''}`;
}
