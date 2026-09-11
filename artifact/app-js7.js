// ===========================================================================
// Navegação e inicialização
// ===========================================================================
/** Recortes da base. Sempre incluem 'manual' para que o que o gestor lança aqui não suma. */
const BASES = [
  { rotulo:'Completa',                 origens:null,
    nota:'Tudo: planilhas enviadas, folha de TI rateada e projeções.' },
  { rotulo:'Realizado (sem projeção)', origens:['planilha','folha_ti','manual'],
    nota:'Exclui as mensalidades projetadas do SpinCare, que ainda não ocorreram.' },
  { rotulo:'Só planilhas enviadas',    origens:['planilha','manual'],
    nota:'Apenas as linhas importadas das suas bases, sem o rateio de folha de TI.' },
  { rotulo:'Só projeções',             origens:['projecao_spincare'],
    nota:'Apenas o que foi projetado e ainda não aconteceu.' },
];
const ABAS = [
  { id:'painel',      rotulo:'Painel',      view: viewPainel },
  { id:'lancamentos', rotulo:'Lançamentos', view: viewLancamentos },
  { id:'projetos',    rotulo:'Projetos',    view: viewProjetos },
  { id:'sla',         rotulo:'SLA',         view: viewSla },
  { id:'conferencia', rotulo:'Conferência', view: viewConferencia },
  { id:'cadastros',   rotulo:'Cadastros',   view: viewCadastros },
  { id:'auditoria',   rotulo:'Auditoria',   view: viewAuditoria },
];

function pintarAbas() {
  el('#abas').innerHTML = ABAS.map((a) =>
    `<button type="button" data-aba="${a.id}"${a.id===E.aba?' aria-current="page"':''}>${a.rotulo}</button>`).join('');
  el('#abas').querySelectorAll('button').forEach((b) => b.onclick = () => { E.aba = b.dataset.aba; render(); });
}

function pintarSeletores() {
  const se = el('#f-empresa');
  se.innerHTML = E.empresas.map((e)=>`<option value="${esc(e.id)}"${e.id===E.empresa?' selected':''}>${esc(e.nome)}</option>`).join('');
  se.onchange = async () => {
    E.empresa = se.value; E.filial = ''; E.cenario = 'oficial';
    await garantirDados(E.empresa);
    E.competencia = competenciaPadrao(E.empresa);
    pintarSeletores(); render();
  };
  const sf = el('#f-filial');
  sf.innerHTML = '<option value="">Todas (consolidado)</option>' +
    filiaisDa(E.empresa).map((f)=>`<option${f.nome===E.filial?' selected':''}>${esc(f.nome)}</option>`).join('');
  sf.onchange = () => { E.filial = sf.value; render(); };

  const sb = el('#f-base');
  sb.innerHTML = BASES.map((b, i) =>
    `<option value="${i}"${i === E.baseIdx ? ' selected' : ''}>${esc(b.rotulo)}</option>`).join('');
  sb.title = BASES[E.baseIdx].nota;
  sb.onchange = () => {
    E.baseIdx = +sb.value;
    E.origens = BASES[E.baseIdx].origens ? new Set(BASES[E.baseIdx].origens) : null;
    sb.title = BASES[E.baseIdx].nota;
    render();
  };
}

let renderizando = false;
async function render() {
  if (renderizando) return;
  renderizando = true;
  sumirDica();
  try {
    const aba = ABAS.find((a)=>a.id===E.aba) || ABAS[0];
    pintarAbas();
    await aba.view();
  } catch (e) {
    el('#pagina').innerHTML = `<div class="msg erro"><strong>Falha ao montar a tela.</strong> ${esc(e.message||e)}</div>`;
  } finally { renderizando = false; }
}

async function garantirDados(empresa) {
  if (!E.mesesCarregados.has(empresa)) await Loja.lancDaEmpresa(empresa);
  await Loja.fechamentosDa(empresa);
}

function semBanco(motivo) {
  el('#pagina').innerHTML = `
    <section class="bloco">
      <h2 style="margin-bottom:8px">Armazenamento indisponível nesta visualização</h2>
      <p style="color:var(--tinta2)">${esc(motivo)}</p>
      <p style="color:var(--tinta2)">Abra esta página pelo link do artifact, logado na sua conta. Se o problema
        persistir, o mesmo sistema roda na sua máquina com <code>npm run iniciar</code>.</p>
    </section>`;
}

(async function iniciar() {
  try {
    const db = await window.claude?.use?.('db');
    if (!db) return semBanco('Esta visualização não pôde abrir a base de dados do sistema.');
    E.db = db;
    await Loja.catalogos();
    if (!E.empresas.length) {
      el('#pagina').innerHTML = `<section class="bloco"><h2>Base vazia</h2>
        <p style="color:var(--tinta2)">Nenhuma empresa cadastrada ainda nesta base.</p></section>`;
      return;
    }
    E.baseIdx = 0; E.origens = null;
    E.empresa = E.empresas[0].id;
    await garantirDados(E.empresa);
    E.competencia = competenciaPadrao(E.empresa);
    pintarSeletores();
    await render();
  } catch (e) {
    semBanco('Erro ao carregar: ' + (e.message || e));
  }
})();
