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
