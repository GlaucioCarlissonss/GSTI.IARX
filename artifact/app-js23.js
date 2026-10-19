// ===========================================================================
// PLANO DE AÇÃO DA IMPLANTAÇÃO — as ações que levam cada onda ao go-live.
//
// O Controle Único responde "como está cada ATIVIDADE em cada unidade". Este
// plano responde outra coisa: "o que falta fazer, por quem, e até quando".
// São 146 ações distribuídas em quatro ondas, com data de início e de fim —
// DIÁRIAS, não mensais — área responsável e líder de equipe.
//
// Por que um cadastro próprio, e não tarefas do módulo de Projetos: a tarefa
// do sistema tem competência MENSAL, e o valor deste plano está justamente no
// dia. "Vence em 2 dias" e "atrasado 5 dias" são a leitura que faz a sala de
// guerra agir; arredondá-los para o mês apagaria o plano inteiro e deixaria um
// calendário que não cobra nada de ninguém.
//
// O QUE SE GUARDA É A FONTE, NUNCA O DERIVADO. A planilha traz a coluna
// "Farol (Prazo)" já escrita — "🟢 No prazo 12d" —, e ela é descartada na
// carga. Esse texto foi calculado contra o dia em que alguém abriu o arquivo:
// gravá-lo faria o painel envelhecer em silêncio, mostrando "vence em 2 dias"
// uma semana depois. O farol é recalculado contra HOJE, toda vez, pela mesma
// razão que "fora do SLA" nunca é gravado.
// ===========================================================================

/** Os status que a planilha usa na coluna "Status da Ação". */
const PLANO_STATUS = ['Não iniciado', 'Em andamento', 'Concluído', 'Cancelado'];

/**
 * A régua do farol, em dias corridos até a data de fim.
 *
 * Três dias é o limite do amarelo porque é o que a planilha usa, e mudá-lo
 * aqui faria a tela e o documento do cliente discordarem sobre o que é
 * urgente. Dias CORRIDOS, e não úteis: o plano conta assim (de 19/10 a 31/10
 * ele escreve "12d", que são os corridos), e o motor de horas úteis existe
 * para o SLA, que é outro compromisso.
 */
const PLANO_DIAS_AMARELO = 3;

/** Hoje, em ISO. Função, e não constante: a tela fica aberta e o dia vira. */
const planoHojeISO = () => new Date().toISOString().slice(0, 10);

/** Dias corridos de `a` até `b`, pelas datas em ISO. */
function planoDiasEntre(a, b) {
  if (!a || !b) return null;
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
    - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round(ms / 86400000);
}

/**
 * O farol de uma ação, contra hoje.
 *
 * A ordem das perguntas importa: concluída e cancelada saem ANTES do prazo,
 * porque uma ação entregue na semana passada não está atrasada — ela está
 * pronta, e pintá-la de vermelho faria a lista de urgências encher de coisa
 * resolvida.
 */
function planoFarol(acao, hoje) {
  const dia = hoje || planoHojeISO();
  if (acao.status === 'Concluído') return { chave: 'CONCLUIDO', rotulo: 'Concluído', dias: null };
  if (acao.status === 'Cancelado') return { chave: 'CANCELADO', rotulo: 'Cancelado', dias: null };
  if (!acao.fim) return { chave: 'SEM_DATA', rotulo: 'Sem data', dias: null };
  const dias = planoDiasEntre(dia, acao.fim);
  if (dias < 0) return { chave: 'ATRASADO', rotulo: `Atrasado ${Math.abs(dias)}d`, dias };
  if (dias <= PLANO_DIAS_AMARELO) return { chave: 'VENCE', rotulo: `Vence em ${dias}d`, dias };
  return { chave: 'NO_PRAZO', rotulo: `No prazo ${dias}d`, dias };
}

/**
 * A SITUAÇÃO da ação — o que o placar conta.
 *
 * É o status, com uma exceção: a ação em aberto cujo prazo venceu conta como
 * ATRASADA, e não como "em andamento" ou "não iniciada". É a mesma conta que a
 * aba BASE da planilha faz na coluna "Situação", e é o que faz os cinco
 * baldes somarem o total sem contar ninguém duas vezes.
 */
function planoSituacao(acao, hoje) {
  const f = planoFarol(acao, hoje);
  return f.chave === 'ATRASADO' ? 'Atrasado' : (acao.status || 'Não iniciado');
}

const PLANO_SITUACOES = ['Não iniciado', 'Em andamento', 'Atrasado', 'Concluído', 'Cancelado'];

const PLANO_COR_FAROL = {
  CONCLUIDO: 'var(--bomtxt)', NO_PRAZO: 'var(--bomtxt)', VENCE: 'var(--alerta)',
  ATRASADO: 'var(--crit)', CANCELADO: 'var(--tinta3)', SEM_DATA: 'var(--tinta3)',
};
const PLANO_COR_SITUACAO = {
  'Concluído': 'var(--bomtxt)', 'Em andamento': 'var(--s1)', 'Atrasado': 'var(--crit)',
  'Não iniciado': 'var(--tinta3)', 'Cancelado': 'var(--tinta3)',
};

/** A ação com os derivados prontos. Nenhum deles é gravado. */
function planoDerivar(acao, hoje) {
  const dia = hoje || planoHojeISO();
  const farol = planoFarol(acao, dia);
  return {
    ...acao,
    farol: farol.chave,
    farolRotulo: farol.rotulo,
    diasParaPrazo: farol.dias,
    situacao: planoSituacao(acao, dia),
    // Concluída e cancelada não entram no "o que falta": a primeira acabou, e
    // a segunda foi tirada do plano de propósito.
    emAberto: acao.status !== 'Concluído' && acao.status !== 'Cancelado',
  };
}

/** As ações do cliente em foco, já derivadas. */
function planoAcoes(hoje) {
  const dia = hoje || planoHojeISO();
  return (E.planoAcao || [])
    .filter((a) => a.cliente === E.clienteSel)
    .map((a) => planoDerivar(a, dia));
}

/**
 * O placar do plano — os mesmos números do DASHBOARD da planilha.
 *
 * Recalculados, nunca copiados: o dashboard do arquivo foi tirado no dia em
 * que alguém o abriu, e um placar guardado diria "6 atrasadas" para sempre.
 */
function planoPlacar(acoes) {
  const porSituacao = {};
  for (const s of PLANO_SITUACOES) porSituacao[s] = 0;
  const porFarol = {};
  for (const a of acoes) {
    porSituacao[a.situacao] = (porSituacao[a.situacao] || 0) + 1;
    porFarol[a.farol] = (porFarol[a.farol] || 0) + 1;
  }
  const total = acoes.length;
  const concluidas = porSituacao['Concluído'] || 0;
  // O denominador EXCLUI as canceladas: elas saíram do plano, e mantê-las
  // embaixo da divisão faria o percentual nunca poder chegar a 100%.
  const validas = total - (porSituacao['Cancelado'] || 0);
  return {
    total, validas, concluidas,
    emAndamento: porSituacao['Em andamento'] || 0,
    naoIniciadas: porSituacao['Não iniciado'] || 0,
    atrasadas: porSituacao['Atrasado'] || 0,
    canceladas: porSituacao['Cancelado'] || 0,
    pctConcluido: validas ? pct(concluidas, validas) : null,
    porSituacao, porFarol,
  };
}

/** O placar de cada onda, na ordem do cronograma. */
function planoPorOnda(acoes) {
  return SPIN_ONDAS.map((o) => {
    const dela = acoes.filter((a) => a.onda === o.n);
    return { onda: o.n, virada: o.virada, unidades: o.unidades,
      emProducao: !!o.viradaRealizada, ...planoPlacar(dela), acoes: dela };
  });
}

// --------------------------------------------------------------- a carga

/** O cabeçalho que prova que a aba é uma onda do plano. */
const PLANO_CABECALHO = ['Nº', 'Tarefa', 'Área Responsável', 'Líder de Equipe',
  'Data Início', 'Data Fim', 'Qtd Dias', 'Status da Ação'];

/** `Onda 3` → 3. Qualquer outra coisa devolve nulo. */
function planoNumeroDaOnda(nomeAba) {
  const m = /^\s*onda\s*(\d+)\s*$/i.exec(spinChaveNome(nomeAba));
  return m ? Number(m[1]) : null;
}

/**
 * A linha do cabeçalho dentro da aba da onda.
 *
 * Não é fixa: as abas trazem um título, a linha das unidades e a da data da
 * virada antes dela, e um dia alguém acrescenta uma. Procurar pelo conteúdo
 * aguenta isso; contar linhas, não.
 */
function planoLinhaDoCabecalho(grade) {
  for (let i = 0; i < Math.min(grade.length, 12); i += 1) {
    const linha = (grade[i] || []).map((c) => spinChaveNome(c));
    if (PLANO_CABECALHO.every((rot, j) => linha[j] === spinChaveNome(rot))) return i;
  }
  return -1;
}

/**
 * O arquivo É o Plano de Ação? Devolve as abas de onda, ou `null`.
 *
 * Existe pelo mesmo motivo de `abaDoControleUnico`: a carga tem de funcionar
 * em qualquer tela de importação, sem o gestor precisar adivinhar qual aceita
 * qual arquivo. O nome da aba sozinho não basta — o que prova o layout é o
 * cabeçalho.
 */
async function abaDoPlanoDeAcao(bytes) {
  const abas = await gradeDoXlsx(bytes);
  const ondas = abas
    .map((a) => ({ aba: a, onda: planoNumeroDaOnda(a.nome) }))
    .filter((x) => x.onda !== null)
    .map((x) => ({ ...x, cabecalho: planoLinhaDoCabecalho(x.aba.grade) }))
    .filter((x) => x.cabecalho >= 0);
  return ondas.length ? ondas : null;
}

/**
 * Lê as abas de onda e devolve as ações mais o diagnóstico.
 *
 * Nada é inventado: campo vazio continua vazio e é CONTADO. Uma ação sem data
 * de fim entra com farol "Sem data" e aparece no diagnóstico — é a diferença
 * entre uma carga que informa o que falta e uma que preenche o buraco com um
 * palpite indistinguível do dado real.
 */
function planoLerOndas(ondas, cliente) {
  const acoes = [];
  const problemas = [];
  const vistos = new Set();
  const resumoOndas = [];

  for (const { aba, onda, cabecalho } of ondas) {
    const grade = aba.grade;
    const cel = (linha, i) => {
      const v = (linha || [])[i];
      return v == null ? '' : String(v).trim();
    };
    // A linha 2 da aba traz "Onda N • Go-live: d/m/aaaa • Unidades: ...".
    // Ela é LIDA e conferida contra o cronograma, não usada para sobrescrevê-lo:
    // o cronograma é código revisado, e uma planilha trocada por engano não
    // pode remontar as ondas sozinha.
    const titulo = (grade.slice(0, cabecalho).flat() || [])
      .map((c) => String(c == null ? '' : c)).find((t) => /go-?live/i.test(t)) || '';
    const goLive = spinData((/go-?live:?\s*([\d/.-]+)/i.exec(titulo) || [])[1] || '');
    const doCrono = SPIN_ONDAS.find((o) => o.n === onda);
    if (goLive && doCrono && goLive !== doCrono.virada) {
      problemas.push(`Onda ${onda}: a planilha diz go-live em ${diaExib(goLive)} e o `
        + `cronograma do sistema, ${diaExib(doCrono.virada)}. Vale o cronograma; `
        + 'confira qual dos dois está desatualizado.');
    }
    if (!doCrono) {
      problemas.push(`Onda ${onda}: a planilha traz uma onda que o cronograma não tem. `
        + 'As ações entram, mas ela não aparece agrupada no painel.');
    }

    let lidas = 0;
    for (let i = cabecalho + 1; i < grade.length; i += 1) {
      const linha = grade[i] || [];
      const n = cel(linha, 0);
      // Sem número e sem tarefa é linha de espaçamento ou rodapé.
      if (!n || !/^\d+$/.test(n)) continue;
      const tarefa = cel(linha, 1);
      if (!tarefa) {
        problemas.push(`Onda ${onda}, nº ${n}: sem descrição da tarefa — linha ignorada.`);
        continue;
      }
      // A identidade é onda + nº: é como o cliente numera, e é único dentro
      // da aba. Repetido é linha duplicada de fato, e das duas não há como
      // saber qual é a boa.
      const chave = `${onda}__${n}`;
      if (vistos.has(chave)) {
        problemas.push(`Onda ${onda}, nº ${n}: número repetido na aba — a segunda linha `
          + 'foi recusada, porque das duas não há como saber qual vale.');
        continue;
      }
      vistos.add(chave);

      const statusBruto = cel(linha, 7);
      const status = PLANO_STATUS.find((s) => spinChaveNome(s) === spinChaveNome(statusBruto))
        || '';
      if (statusBruto && !status) {
        problemas.push(`Onda ${onda}, nº ${n}: status "${statusBruto}" não é um dos `
          + `conhecidos (${PLANO_STATUS.join(', ')}) — a ação entra como não iniciada.`);
      }
      const inicio = spinData(cel(linha, 4));
      const fim = spinData(cel(linha, 5));
      if (!fim) {
        problemas.push(`Onda ${onda}, nº ${n}: sem data de fim — entra com farol "Sem data", `
          + 'e fica de fora da contagem de prazo.');
      }
      if (inicio && fim && fim < inicio) {
        problemas.push(`Onda ${onda}, nº ${n}: a data de fim (${diaExib(fim)}) vem antes `
          + `do início (${diaExib(inicio)}).`);
      }

      acoes.push({
        cliente, onda, n: Number(n), tarefa,
        area: cel(linha, 2), lider: cel(linha, 3),
        inicio, fim,
        // "Qtd Dias" é derivado da planilha e NÃO é gravado como verdade: ele
        // diverge do intervalo em várias linhas. O que vale são as pontas.
        status: status || 'Não iniciado',
        link: cel(linha, 9),
        observacoes: cel(linha, 10),
        evolucoes: cel(linha, 11),
      });
      lidas += 1;
    }
    resumoOndas.push({ onda, lidas, goLive });
  }

  const semArea = acoes.filter((a) => !a.area || a.area === '-').length;
  const semLider = acoes.filter((a) => !a.lider || a.lider === '-').length;
  const semFim = acoes.filter((a) => !a.fim).length;
  return {
    acoes, problemas, ondas: resumoOndas,
    diagnostico: { total: acoes.length, semArea, semLider, semFim },
  };
}

/**
 * Lê, grava e devolve o relatório. É o ÚNICO caminho de carga do plano — duas
 * implementações divergiriam na primeira correção.
 */
async function importarPlanoDeAcao(ondas, nomeArquivo) {
  const lido = planoLerOndas(ondas, E.clienteSel);
  if (!lido.acoes.length) {
    throw new Error('Nenhuma ação foi lida das abas de onda. Confira se o cabeçalho '
      + '("Nº", "Tarefa", "Área Responsável"…) está presente e se a coluna A tem os números.');
  }
  // As ações de OUTROS clientes ficam: a base é uma só, e cada item carrega o
  // dono — a mesma convenção do Controle Único, das metas e do plano de redução.
  const outras = (E.planoAcao || []).filter((a) => a.cliente !== E.clienteSel);
  await Loja.gravarCatalogo('planoacao', [...outras, ...lido.acoes]);
  await Loja.gravarConfiguracao({ planoAcaoCarga: {
    quando: new Date().toLocaleString('pt-BR'), total: lido.acoes.length,
    arquivo: nomeArquivo, cliente: E.clienteSel } });
  await Loja.auditar({ entidade: 'planoacao', acao: 'importar',
    descricao: `${lido.acoes.length} ação(ões) do Plano de Ação, de ${nomeArquivo}` });
  E.planoAcaoRelatorio = lido;
  return lido;
}

// ----------------------------------------------------------------- a tela

/** Os cortes da tela. Só de sessão: recorte de leitura não é configuração. */
function planoFiltro() {
  if (!E.planoFiltro) E.planoFiltro = { onda: '', area: '', situacao: '', lider: '', busca: '' };
  return E.planoFiltro;
}

/** As ações que passam pelos cortes, já derivadas e ordenadas. */
function planoFiltradas() {
  const f = planoFiltro();
  const texto = spinChaveNome(f.busca);
  return planoAcoes()
    .filter((a) => (!f.onda || String(a.onda) === f.onda)
      && (!f.area || a.area === f.area)
      && (!f.situacao || a.situacao === f.situacao)
      && (!f.lider || a.lider === f.lider)
      && (!texto || spinChaveNome(`${a.tarefa} ${a.area} ${a.lider} ${a.evolucoes}`).includes(texto)))
    // O MAIS URGENTE PRIMEIRO, e não pela numeração da planilha: a ordem do
    // arquivo é a de quem o escreveu, e não responde "o que fazer agora".
    // Atrasado antes de vencendo, vencendo antes de no prazo, e dentro de
    // cada grupo o prazo mais próximo na frente.
    .sort((a, b) => (PLANO_URGENCIA[a.farol] - PLANO_URGENCIA[b.farol])
      || ((a.diasParaPrazo ?? 1e9) - (b.diasParaPrazo ?? 1e9))
      || (a.onda - b.onda) || (a.n - b.n));
}

/** A ordem de urgência dos faróis. Menor vem primeiro. */
const PLANO_URGENCIA = { ATRASADO: 0, VENCE: 1, NO_PRAZO: 2, SEM_DATA: 3, CONCLUIDO: 4, CANCELADO: 5 };

/** Os valores distintos de um campo, para montar um corte. */
const planoValoresDe = (campo) => ordenado([...new Set(planoAcoes()
  .map((a) => a[campo]).filter((v) => v && v !== '-'))]);

function viewPlanoAcao() {
  const acoes = planoAcoes();
  const carga = (E.config || {}).planoAcaoCarga || null;
  const placar = planoPlacar(acoes);

  el('#pagina').innerHTML = `
    <div class="msg"><strong>A base é a planilha "Plano de Ação — Implantação SpinCare".</strong>
      Ela responde o que o Controle Único não responde: <strong>o que falta fazer, por quem e até
      quando</strong>, em datas de dia — não de mês. O farol é recalculado contra
      <strong>hoje</strong> toda vez que a tela abre; o que vem escrito na planilha foi calculado
      no dia em que alguém a abriu, e é descartado na carga.</div>

    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:var(--esp-8)">
      <header><h2>Carga da planilha</h2>
        <span class="nota">${carga
          ? `última carga em ${esc(carga.quando || '—')} · ${inteiro(carga.total || 0)} ação(ões)`
          : 'nenhuma carga ainda'}</span></header>
      <div class="filtros" style="box-shadow:none;border:0;padding:0">
        <div class="campo" style="min-width:300px">
          <label for="plano-arq">Arquivo .xlsx do Plano de Ação</label>
          <input type="file" id="plano-arq" accept=".xlsx"></div>
        <button class="bt pri" id="plano-carregar" disabled>Conferir e carregar</button>
        ${acoes.length ? '<button class="bt fant perigo" id="plano-limpar">Remover o plano carregado</button>' : ''}
      </div>
      <div id="plano-resultado" style="margin-top:var(--esp-7)">${
        E.planoAcaoRelatorio ? relatorioPlanoHtml(E.planoAcaoRelatorio) : ''}</div>
    </section>

    ${!acoes.length ? `<section class="bloco" style="margin-top:var(--esp-8)">
        <header><h2>Execução do plano</h2></header>
        <p class="vazio">Nenhuma ação carregada ainda. Suba a planilha acima para ver o placar,
          o farol de cada ação e o que está atrasado.</p>
      </section>`
      : `${placarPlanoHtml(placar)}${ondasDoPlanoHtml()}${listagemPlanoHtml()}`}`;

  const arq = el('#plano-arq');
  const bt = el('#plano-carregar');
  arq.addEventListener('change', () => { bt.disabled = !arq.files.length; });
  bt.addEventListener('click', () => carregarPlanoDeAcao(arq, bt));
  const limpar = el('#plano-limpar');
  if (limpar) limpar.addEventListener('click', () => removerPlanoDeAcao());
  ligarListagemPlano();
  dobrarBlocos();
}

/** O placar do plano inteiro — os cinco baldes e o percentual. */
function placarPlanoHtml(p) {
  const cartao = (rot, valor, apoio, cor) => `<div class="kpi${cor ? ' drill' : ''}"
    ${cor ? `data-placar="${esc(rot)}" tabindex="0" role="button"` : ''}>
    <span class="r">${esc(rot)}</span>
    <span class="n"${cor ? ` style="color:${cor}"` : ''}>${valor}</span>
    ${apoio ? `<span class="a">${esc(apoio)}</span>` : ''}</div>`;
  return `
    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:var(--esp-8)">
      <header><h2>Execução do plano</h2>
        <span class="nota">recalculado contra hoje, ${esc(diaExib(planoHojeISO()))}</span></header>
      <div class="kpis">
        ${cartao('Total de ações', inteiro(p.total), `${inteiro(p.validas)} valem para o percentual`)}
        ${cartao('Concluídas', inteiro(p.concluidas), 'entregues', PLANO_COR_SITUACAO['Concluído'])}
        ${cartao('Em andamento', inteiro(p.emAndamento), 'começadas e no prazo', PLANO_COR_SITUACAO['Em andamento'])}
        ${cartao('Não iniciadas', inteiro(p.naoIniciadas), 'ainda no prazo', PLANO_COR_SITUACAO['Não iniciado'])}
        ${cartao('Atrasadas', inteiro(p.atrasadas), 'prazo vencido, em aberto', PLANO_COR_SITUACAO['Atrasado'])}
        ${cartao('% concluído', p.pctConcluido === null ? '—' : pctTxt(p.pctConcluido),
          'canceladas fora do denominador')}
      </div>
      ${p.canceladas ? `<p class="nota" style="margin-top:var(--esp-5)">
        ${inteiro(p.canceladas)} ação(ões) cancelada(s) — fora do cálculo, como no plano.</p>` : ''}
    </section>`;
}

/** Uma linha por onda: o placar dela e o estado da virada. */
function ondasDoPlanoHtml() {
  const ondas = planoPorOnda(planoAcoes());
  return `
    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:var(--esp-8)">
      <header><h2>Por onda</h2>
        <span class="nota">a virada de cada frente, e o que falta para ela</span></header>
      <div class="rol"><table>
        <thead><tr><th>Onda</th><th>Unidades</th><th>Go-live</th>
          <th class="n">Ações</th><th class="n">Concluídas</th><th class="n">Atrasadas</th>
          <th class="n">% concl.</th></tr></thead>
        <tbody>${ondas.map((o) => `<tr>
          <td><strong>${inteiro(o.onda)}ª</strong>${o.emProducao
            ? ' <span class="tag" style="color:var(--bomtxt);border-color:var(--bomtxt)">em produção</span>' : ''}</td>
          <td>${o.unidades.map((u) => esc(u)).join(' · ')}</td>
          <td>${esc(diaExib(o.virada))}</td>
          <td class="n">${inteiro(o.total)}</td>
          <td class="n">${inteiro(o.concluidas)}</td>
          <td class="n"${o.atrasadas ? ' style="color:var(--crit);font-weight:700"' : ''}>${inteiro(o.atrasadas)}</td>
          <td class="n">${o.pctConcluido === null ? '—' : pctTxt(o.pctConcluido)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="nota" style="margin-top:var(--esp-5)">Uma onda pode estar
        <strong>em produção com ações em aberto</strong> — a virada é um fato, e o que falta é
        estabilização. É por isso que as duas colunas não dizem a mesma coisa.</p>
    </section>`;
}

/** A lista das ações, do mais urgente para o menos. */
function listagemPlanoHtml() {
  const f = planoFiltro();
  const lista = planoFiltradas();
  const total = planoAcoes().length;
  return `
    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:var(--esp-8)">
      <header><h2>Ações</h2>
        <span class="nota">${inteiro(lista.length)} de ${inteiro(total)} ·
          da mais urgente para a menos</span></header>
      <div class="filtros" style="box-shadow:none;border:0;padding:0 0 var(--esp-7)">
        ${cortePlanoHtml('onda', 'Onda', SPIN_ONDAS.map((o) =>
          ({ valor: String(o.n), rotulo: `${o.n}ª — ${diaExib(o.virada)}` })))}
        ${cortePlanoHtml('situacao', 'Situação', PLANO_SITUACOES)}
        ${cortePlanoHtml('area', 'Área responsável', planoValoresDe('area'))}
        ${cortePlanoHtml('lider', 'Líder de equipe', planoValoresDe('lider'))}
        <div class="campo" style="min-width:200px">
          <label for="pf-busca">Buscar</label>
          <input id="pf-busca" type="search" value="${esc(f.busca)}"
            placeholder="tarefa, área, líder ou evolução"></div>
        <button class="bt fant" id="pf-limpar">Limpar filtros</button>
      </div>
      ${!lista.length ? '<p class="vazio">Nenhuma ação neste recorte.</p>' : `
      <div class="rol"><table>
        <thead><tr><th class="n">Onda</th><th class="n">Nº</th><th>Tarefa</th>
          <th>Área</th><th>Líder</th><th>Início</th><th>Fim</th>
          <th>Situação</th><th>Farol</th></tr></thead>
        <tbody>${lista.map((a) => `<tr class="acao-plano" data-acao="${a.onda}__${a.n}"
            ${a.evolucoes ? 'style="cursor:pointer"' : ''}>
          <td class="n">${inteiro(a.onda)}ª</td>
          <td class="n">${inteiro(a.n)}</td>
          <td class="texto">${esc(a.tarefa)}${a.evolucoes
            ? '<span class="arv-comp" style="display:block">tem evolução registrada</span>' : ''}</td>
          <td>${esc(a.area || '—')}</td>
          <td>${esc(a.lider && a.lider !== '-' ? a.lider : '—')}</td>
          <td>${esc(a.inicio ? diaExib(a.inicio) : '—')}</td>
          <td>${esc(a.fim ? diaExib(a.fim) : '—')}</td>
          <td><span style="color:${PLANO_COR_SITUACAO[a.situacao] || 'var(--tinta2)'}">${
            esc(a.situacao)}</span></td>
          <td><span class="tag" style="color:${PLANO_COR_FAROL[a.farol]};border-color:${
            PLANO_COR_FAROL[a.farol]}">${esc(a.farolRotulo)}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </section>`;
}

function cortePlanoHtml(campo, rotulo, opcoes) {
  const f = planoFiltro();
  return `<div class="campo" style="min-width:150px">
    <label for="pf-${campo}">${esc(rotulo)}</label>
    <select id="pf-${campo}" data-corte-plano="${campo}">
      <option value="">Todos</option>
      ${opcoes.map((o) => {
        const valor = typeof o === 'string' ? o : o.valor;
        const nome = typeof o === 'string' ? o : o.rotulo;
        return `<option value="${esc(valor)}"${f[campo] === valor ? ' selected' : ''}>${esc(nome)}</option>`;
      }).join('')}
    </select></div>`;
}

/** Liga os cortes, a busca e o clique que abre a evolução da ação. */
function ligarListagemPlano() {
  const area = el('#pagina');
  for (const sel of area.querySelectorAll('[data-corte-plano]')) {
    sel.onchange = () => { planoFiltro()[sel.dataset.cortePlano] = sel.value; render(); };
  }
  const busca = el('#pf-busca');
  if (busca) {
    busca.onchange = () => { planoFiltro().busca = busca.value; render(); };
  }
  const limpar = el('#pf-limpar');
  if (limpar) {
    limpar.onclick = () => { E.planoFiltro = null; render(); };
  }
  for (const tr of area.querySelectorAll('.acao-plano')) {
    tr.onclick = () => abrirAcaoDoPlano(tr.dataset.acao);
  }
}

/** A ficha de uma ação: o que ela é, e o que foi registrado sobre ela. */
function abrirAcaoDoPlano(chave) {
  const [onda, n] = String(chave).split('__');
  const a = planoAcoes().find((x) => String(x.onda) === onda && String(x.n) === n);
  if (!a) return;
  const linha = (nome, valor) => `<dt>${esc(nome)}</dt><dd>${valor}</dd>`;
  abrirModal({
    titulo: `${a.onda}ª onda · nº ${a.n}`,
    corpo: `
      <h3 style="margin-bottom:var(--esp-5)">${esc(a.tarefa)}</h3>
      <dl class="ficha">
        ${linha('Área responsável', esc(a.area || '—'))}
        ${linha('Líder de equipe', esc(a.lider && a.lider !== '-' ? a.lider : '—'))}
        ${linha('Início', esc(a.inicio ? diaExib(a.inicio) : '—'))}
        ${linha('Fim planejado', esc(a.fim ? diaExib(a.fim) : '—'))}
        ${linha('Situação', `<span style="color:${PLANO_COR_SITUACAO[a.situacao]}">${esc(a.situacao)}</span>`)}
        ${linha('Farol', `<span class="tag" style="color:${PLANO_COR_FAROL[a.farol]};border-color:${
          PLANO_COR_FAROL[a.farol]}">${esc(a.farolRotulo)}</span>`)}
        ${a.link ? linha('Sala remota', `<a href="${esc(a.link)}" target="_blank" rel="noopener">abrir</a>`) : ''}
      </dl>
      ${a.evolucoes ? `<div class="msg" style="margin-top:var(--esp-7)">
        <strong>Evoluções registradas.</strong> ${esc(a.evolucoes)}</div>` : ''}
      ${a.observacoes ? `<div class="msg" style="margin-top:var(--esp-5)">
        <strong>Observações.</strong> ${esc(a.observacoes)}</div>` : ''}`,
    acoes: '<button type="button" class="bt" data-c>Fechar</button>',
    aoMontar({ raiz, fechar }) { raiz.querySelector('[data-c]').onclick = fechar; },
  });
}

/** O relatório da carga: o que entrou, e o que ficou faltando. */
function relatorioPlanoHtml(lido) {
  const d = lido.diagnostico;
  return `
    <div class="msg"><strong>${inteiro(d.total)} ação(ões) carregada(s)</strong> em
      ${inteiro(lido.ondas.length)} onda(s): ${lido.ondas
        .map((o) => `${o.onda}ª com ${inteiro(o.lidas)}`).join(' · ')}.</div>
    <div class="kpis" style="margin-top:var(--esp-5)">
      <div class="kpi"><span class="r">Sem área responsável</span>
        <span class="n"${d.semArea ? ' style="color:var(--alerta)"' : ''}>${inteiro(d.semArea)}</span></div>
      <div class="kpi"><span class="r">Sem líder de equipe</span>
        <span class="n"${d.semLider ? ' style="color:var(--alerta)"' : ''}>${inteiro(d.semLider)}</span></div>
      <div class="kpi"><span class="r">Sem data de fim</span>
        <span class="n"${d.semFim ? ' style="color:var(--alerta)"' : ''}>${inteiro(d.semFim)}</span></div>
    </div>
    ${lido.problemas.length ? `<div class="msg erro" style="margin-top:var(--esp-5)">
      <strong>${inteiro(lido.problemas.length)} aviso(s) na leitura.</strong>
      <ul style="margin:var(--esp-4) 0 0;padding-left:var(--esp-9)">
        ${lido.problemas.slice(0, 20).map((p) => `<li>${esc(p)}</li>`).join('')}
      </ul>${lido.problemas.length > 20
        ? `<p class="nota">e mais ${inteiro(lido.problemas.length - 20)}.</p>` : ''}</div>` : ''}`;
}

/** Lê o arquivo escolhido e grava. A mensagem de erro diz o que fazer. */
async function carregarPlanoDeAcao(campo, botao) {
  const alvo = el('#plano-resultado');
  const arquivo = campo.files && campo.files[0];
  if (!arquivo) return;
  botao.disabled = true;
  alvo.innerHTML = '<p class="msg">Lendo a planilha…</p>';
  try {
    const ondas = await abaDoPlanoDeAcao(new Uint8Array(await arquivo.arrayBuffer()));
    if (!ondas) {
      throw new Error('O arquivo não tem nenhuma aba chamada "Onda 1", "Onda 2"… com o '
        + 'cabeçalho esperado ("Nº", "Tarefa", "Área Responsável", "Líder de Equipe", '
        + '"Data Início", "Data Fim", "Qtd Dias", "Status da Ação"). '
        + 'Confira se é o Plano de Ação da implantação SpinCare.');
    }
    await importarPlanoDeAcao(ondas, arquivo.name);
    await render();
  } catch (e) {
    E.planoAcaoRelatorio = null;
    alvo.innerHTML = `<div class="msg erro"><strong>A carga não foi feita.</strong>
      ${esc(e && e.message ? e.message : String(e))}</div>`;
    botao.disabled = false;
  }
}

/** Remove o plano do cliente em foco. O dos outros clientes fica. */
function removerPlanoDeAcao() {
  const quantas = planoAcoes().length;
  abrirModal({
    titulo: 'Remover o plano carregado',
    corpo: `<div class="msg alerta"><strong>Isto apaga ${inteiro(quantas)} ação(ões)
      deste cliente.</strong> As telas que leem deste plano voltam a ficar vazias até uma carga
      nova. A planilha de origem não é tocada.</div>`,
    acoes: [{ rotulo: 'Remover', classe: 'bt perigo', acao: async () => {
      const outras = (E.planoAcao || []).filter((a) => a.cliente !== E.clienteSel);
      await Loja.gravarCatalogo('planoacao', outras);
      await Loja.gravarConfiguracao({ planoAcaoCarga: null });
      E.planoAcaoRelatorio = null;
      await Loja.auditar({ entidade: 'planoacao', acao: 'excluir',
        descricao: `${quantas} ação(ões) removida(s) do Plano de Ação` });
      await render();
    } }],
  });
}

// ------------------------------------------- a leitura dentro dos indicadores

/**
 * O plano resumido, para o painel da Visão Micro dos Indicadores Gerais.
 *
 * É a MESMA leitura da tela de Projetos, rodada sobre as mesmas ações — não um
 * segundo cálculo. Aqui ela responde uma pergunta de cima: das quatro ondas,
 * quais estão em dia para virar, e o que está segurando as que não estão.
 *
 * A lista mostra só o que está ATRASADO, e não as 146: o painel é de relance,
 * e uma tabela inteira dentro dele vira a tela de Projetos num lugar onde ela
 * não cabe. Quem quer o resto abre a aba, que o rodapé indica.
 */
function planoResumoHtml() {
  const acoes = planoAcoes();
  if (!acoes.length) return '';
  const p = planoPlacar(acoes);
  const ondas = planoPorOnda(acoes);
  const atrasadas = acoes.filter((a) => a.farol === 'ATRASADO')
    .sort((a, b) => a.diasParaPrazo - b.diasParaPrazo);
  const vencendo = acoes.filter((a) => a.farol === 'VENCE').length;

  return `
    <div class="kpis" style="margin-bottom:var(--esp-6)">
      <div class="kpi"><span class="r">Ações do plano</span>
        <span class="n">${inteiro(p.total)}</span>
        <span class="a">${inteiro(p.validas)} valem para o percentual</span></div>
      <div class="kpi"><span class="r">Concluídas</span>
        <span class="n" style="color:${PLANO_COR_SITUACAO['Concluído']}">${
          p.pctConcluido === null ? '—' : pctTxt(p.pctConcluido)}</span>
        <span class="a">${inteiro(p.concluidas)} de ${inteiro(p.validas)}</span></div>
      <div class="kpi"><span class="r">Atrasadas</span>
        <span class="n"${p.atrasadas ? ` style="color:${PLANO_COR_SITUACAO['Atrasado']}"` : ''}>${
          inteiro(p.atrasadas)}</span>
        <span class="a">${vencendo ? `${inteiro(vencendo)} vencendo em até 3 dias`
          : 'nenhuma vencendo nos próximos 3 dias'}</span></div>
    </div>

    <div class="rol"><table>
      <thead><tr><th>Onda</th><th>Go-live</th><th class="n">Ações</th>
        <th class="n">Concl.</th><th class="n">Atrasadas</th><th class="n">%</th></tr></thead>
      <tbody>${ondas.map((o) => `<tr>
        <td><strong>${inteiro(o.onda)}ª</strong>${o.emProducao
          ? ' <span class="tag" style="color:var(--bomtxt);border-color:var(--bomtxt)">em produção</span>'
          : ''}<div class="arv-comp">${o.unidades.map((u) => esc(u)).join(' · ')}</div></td>
        <td>${esc(diaExib(o.virada))}</td>
        <td class="n">${inteiro(o.total)}</td>
        <td class="n">${inteiro(o.concluidas)}</td>
        <td class="n"${o.atrasadas ? ' style="color:var(--crit);font-weight:700"' : ''}>${
          inteiro(o.atrasadas)}</td>
        <td class="n">${o.pctConcluido === null ? '—' : pctTxt(o.pctConcluido)}</td>
      </tr>`).join('')}</tbody>
    </table></div>

    ${atrasadas.length ? `
      <h4 class="titulo-mini">O que está atrasado${
        atrasadas.length > 8 ? ` — as 8 mais antigas de ${inteiro(atrasadas.length)}` : ''}</h4>
      <div class="rol"><table>
        <thead><tr><th class="n">Onda</th><th>Ação</th><th>Área</th><th>Líder</th>
          <th class="n">Atraso</th></tr></thead>
        <tbody>${atrasadas.slice(0, 8).map((a) => `<tr>
          <td class="n">${inteiro(a.onda)}ª</td>
          <td class="texto">${esc(a.tarefa)}</td>
          <td>${esc(a.area || '—')}</td>
          <td>${esc(a.lider && a.lider !== '-' ? a.lider : '—')}</td>
          <td class="n" style="color:var(--crit);font-weight:700">${
            inteiro(Math.abs(a.diasParaPrazo))}d</td>
        </tr>`).join('')}</tbody>
      </table></div>`
      : '<p class="nota" style="margin-top:var(--esp-5)">Nenhuma ação atrasada.</p>'}

    <p class="nota" style="margin-top:var(--esp-5)">Em
      <strong>Gestão de Projetos › Plano de Ação</strong> a lista vem inteira, com os cortes por
      onda, área e líder. O farol é recalculado contra hoje, ${esc(diaExib(planoHojeISO()))}.</p>`;
}
