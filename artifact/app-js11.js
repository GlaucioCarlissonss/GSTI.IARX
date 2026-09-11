// ===========================================================================
// Aba Dados — a ponte com o Excel, que é onde o gestor já trabalha.
// ===========================================================================
function viewDados() {
  const emp = E.empresa;
  const nomeEmp = (E.empresas.find((e) => e.id === emp) || {}).nome || emp;
  const total = Loja.todos(emp).length;

  el('#pagina').innerHTML = `
    <div class="msg">O mesmo modelo serve para exportar e importar. Exporte, edite no Excel e reimporte:
      as linhas que já existem são reconhecidas e <strong>não duplicam</strong>; as inválidas entram num
      relatório com o número da linha e o motivo, <strong>sem derrubar o lote</strong>.</div>

    <div class="grade g2">
      <section class="bloco">
        <header><h2>Exportar</h2><span class="nota">modelo ${MODELO_VERSAO}</span></header>
        <p style="color:var(--tinta2);margin:0 0 14px">Tudo de <strong>${esc(nomeEmp)}</strong>:
          ${inteiro(total)} lançamentos, em todas as competências e cenários.</p>
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
        <button type="button" class="bt pri" id="d-exportar">Gerar arquivo</button>
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
          <input type="file" id="d-arquivo" accept=".xlsx,.csv,.txt">
        </div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;font-size:13px">
          <input type="checkbox" id="d-criar" checked style="margin-top:2px">
          <span>Criar filiais, tipos de despesa e cenários que ainda não existirem</span></label>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:14px;font-size:13px">
          <input type="checkbox" id="d-simular" checked style="margin-top:2px">
          <span><strong>Só conferir</strong> — mostra o que aconteceria, sem gravar nada</span></label>
        <button type="button" class="bt pri" id="d-importar" disabled>Processar arquivo</button>
        <div id="d-saida-imp"></div>
      </section>
    </div>

    <section class="bloco">
      <header><h2>Colunas do modelo</h2><span class="nota">versão ${MODELO_VERSAO}</span></header>
      <div class="rol"><table><thead><tr><th>Aba</th><th>Colunas</th><th>Obrigatórias</th></tr></thead>
        <tbody>${Object.entries(ABAS_MODELO).filter(([n]) => n !== 'Modelo').map(([nome, def]) => `<tr>
          <td><strong>${esc(nome)}</strong></td>
          <td style="font-size:12px">${def.colunas.map(esc).join(' · ')}</td>
          <td style="font-size:12px">${def.obrigatorias.length ? def.obrigatorias.map(esc).join(' · ') : '—'}</td>
        </tr>`).join('')}</tbody></table></div>
    </section>`;

  const fmt = el('#d-formato');
  fmt.onchange = () => { el('#d-nota-csv').hidden = fmt.value !== 'csv'; };

  el('#d-exportar').onclick = async (ev) => {
    const bt = ev.currentTarget, saida = el('#d-saida-exp');
    bt.disabled = true; bt.textContent = 'Gerando…'; saida.hidden = true; saida.className = 'msg';
    try {
      const modulo = el('#d-modulo').value;
      const abas = await montarAbas(emp, modulo);
      const carimbo = new Date().toISOString().slice(0,10);
      const nome = `gsti-${emp}-${modulo}-${carimbo}`;
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
        depois:{ modulo, formato: fmt.value, linhas } });
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
      const rel = await importarArquivo(emp, abas, { criarCadastros: el('#d-criar').checked, simular });
      if (!simular) { E.lanc.clear(); E.mesesCarregados.clear(); E.projetos.clear(); E.sla.clear(); await garantirDados(emp); }
      saida.innerHTML = relatorioHtml(rel, simular, arq.name);
      if (!simular) {
        await Loja.auditar({ acao:'importar', entidade:'planilha', id:arq.name,
          depois:{ abas: rel.abas.map((a) => a.nome + ':' + (a.criadas ?? 0)).join(', '),
            invalidas: rel.invalidas.length } });
      }
      const btGravar = el('#d-gravar');
      if (btGravar) btGravar.onclick = () => { el('#d-simular').checked = false; btImp.click(); };
    } catch (e) {
      saida.innerHTML = `<div class="msg erro" style="margin-top:14px"><strong>Não foi possível ler o arquivo.</strong> ${esc(e.message || e)}</div>`;
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
function nomeDeAbaPeloCabecalho(colunas) {
  let melhor = 'Financeiro', pontos = -1;
  for (const [nome, def] of Object.entries(ABAS_MODELO)) {
    if (nome === 'Modelo') continue;
    const mapa = mapearColunas(nome, colunas);
    const faltando = def.obrigatorias.filter((c) => !mapa.has(c)).length;
    const p = faltando === 0 ? mapa.size * 10 : -faltando;
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
    ${simular && criadas ? `<div style="margin-top:14px"><button type="button" class="bt pri" id="d-gravar">Confirmar e gravar ${inteiro(criadas)} registro(s)</button></div>` : ''}`;
}
