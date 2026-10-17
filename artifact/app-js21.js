// ===========================================================================
// PROJETO SPINCARE — o modelo da planilha "Controle Único do Projeto".
//
// A planilha é a fonte da verdade da implantação, e a estrutura dela é
// diferente da que o sistema já tinha: a linha NÃO é uma tarefa de uma
// unidade — é uma ATIVIDADE do projeto, e cada unidade acompanhada tem uma
// COLUNA DE SITUAÇÃO própria dentro dela. Uma atividade concluída em três
// unidades e não iniciada em três outras é UMA linha, não seis.
//
// É por isso que este modelo existe ao lado de projetos/tarefas em vez de ser
// encaixado nele: forçar a planilha no modelo antigo criaria 172 × 6 tarefas
// e faria a contagem de atividades — que é o número que vai para a diretoria —
// deixar de bater com a planilha.
//
// O QUE SE GUARDA É A FONTE, NUNCA O DERIVADO. A planilha traz oito colunas
// calculadas (Critério de Aceite, Status Consolidado, % Avanço, Peso, Avanço
// Ponderado, Farol, Dias p/ Prazo, Alerta), e guardar qualquer uma delas
// permitiria que o número gravado divergisse da regra que diz produzi-lo — o
// mesmo motivo pelo qual "fora do SLA" nunca é gravado neste sistema. Todas
// são recalculadas aqui, e a Entrega 5 as confere contra a planilha.
// ===========================================================================

/** As dez vagas de unidade da planilha, na ordem das colunas AE..AN. */
const SPIN_UNIDADES = [
  { k: 'hr_pb', rotulo: 'HR PB', onda: 1 },
  { k: 'hm_pb', rotulo: 'HM PB', onda: 1 },
  { k: 'hr_cg', rotulo: 'HR CG', onda: 1 },
  { k: 'uc_rj', rotulo: 'UC RJ', onda: 2 },
  { k: 'uc_sp', rotulo: 'UC SP', onda: 2 },
  { k: 'hm_ro', rotulo: 'HM RO', onda: 2 },
  { k: 'unidade_7', rotulo: '(unidade 7)', onda: null },
  { k: 'unidade_8', rotulo: '(unidade 8)', onda: null },
  { k: 'unidade_9', rotulo: '(unidade 9)', onda: null },
  { k: 'unidade_10', rotulo: '(unidade 10)', onda: null },
];
const SPIN_UNIDADE_POR_CHAVE = Object.fromEntries(SPIN_UNIDADES.map((u) => [u.k, u]));

/**
 * As situações, com a cor de cada uma.
 *
 * Este vocabulário é o DA PLANILHA, e não o das tarefas do sistema: ela diz
 * "Não iniciado" onde o sistema diz "Pendente", e traz um "Bloqueado" que o
 * sistema não tem. Traduzir na importação apagaria a diferença justamente na
 * tela que existe para refletir a planilha.
 */
const SPIN_SITUACOES = {
  'Concluído': { cor: 'var(--bom)', classe: 'bom', ordem: 0 },
  'Em andamento': { cor: 'var(--s2)', classe: 'alerta', ordem: 1 },
  'Não iniciado': { cor: 'var(--alerta)', classe: 'alerta', ordem: 2 },
  'Bloqueado': { cor: 'var(--tinta3)', classe: '', ordem: 3 },
  'Cancelado': { cor: 'var(--s1)', classe: '', ordem: 4 },
};
const SPIN_SITUACOES_LISTA = Object.keys(SPIN_SITUACOES);

/** O peso de cada criticidade, como a aba Parâmetros define. */
const SPIN_PESOS = { 'GO-LIVE': 3, 'ESTABILIZAÇÃO': 2, 'EVOLUÇÃO': 1 };

/**
 * O critério de aceite PADRÃO por tipo de entrega.
 *
 * Conferido contra a planilha: nas 172 linhas, a coluna "Critério de Aceite" é
 * exatamente o critério específico quando ele existe, e o padrão do tipo
 * quando não existe — 172 de 172. Por isso ela é calculada, e não guardada.
 */
const SPIN_CRITERIOS_PADRAO = {
  'Cadastro': 'Registros cadastrados nas unidades ativas, conferidos por amostragem e aprovados pelo líder do grupo.',
  'Importação de dados': 'Carga conferida contra a base de origem (contagem e amostragem) e aprovada pelo líder do grupo.',
  'Parametrização / Regra': 'Regra configurada nas unidades ativas, testada em um caso real e aprovada pelo líder do grupo.',
  'Conciliação': 'Bases conciliadas, divergências tratadas ou registradas, e aprovação do líder do grupo.',
  'Teste integrado (tracer)': 'Jornada ponta a ponta sem bloqueio, com as não conformidades registradas e tratadas.',
  'Treinamento': 'Turma realizada, lista de presença registrada e material entregue.',
  'Documento / Governança': 'Documento aprovado pelo responsável e publicado no repositório do projeto.',
};

/**
 * As ondas de implantação, com a fase, o mês e as unidades de cada uma.
 *
 * As fases 3 a 5 ainda NÃO têm coluna na planilha — as vagas `unidade_7` a
 * `unidade_10` existem e estão vazias. Elas ficam aqui mesmo assim, porque é o
 * cronograma que o cliente apresenta, e uma unidade sem coluna precisa
 * aparecer como PENDENTE em vez de sumir da tela.
 *
 * A composição das ondas 4 e 5 segue o CRONOGRAMA, que diverge da planilha:
 * a aba Parâmetros troca as duas listas entre dezembro e janeiro. O cronograma
 * é o documento que o cliente apresenta à diretoria, e foi ele que o pedido
 * transcreveu.
 */
const SPIN_ONDAS = [
  { n: 1, fase: 'Abertura', periodo: 'Setembro', mes: '2026-09', virada: '2026-10-01',
    unidades: ['HR João Pessoa/PB', 'HM João Pessoa/PB', 'HR Campina Grande/PB'],
    chaves: ['hr_pb', 'hm_pb', 'hr_cg'], pacientes: 483 },
  { n: 2, fase: 'Validação', periodo: 'Outubro', mes: '2026-10', virada: '2026-10-01',
    unidades: ['HM Porto Velho/RO', 'UC Union/SP', 'UC Union/RJ'],
    chaves: ['hm_ro', 'uc_sp', 'uc_rj'], pacientes: 99 },
  { n: 3, fase: 'Consolidação', periodo: 'Novembro', mes: '2026-11', virada: '2026-11-01',
    unidades: ['HM Brasília/DF', 'HM Cuiabá/MT', 'HM Goiás/GO'],
    chaves: [], pacientes: 241 },
  { n: 4, fase: 'Escala', periodo: 'Dezembro', mes: '2026-12', virada: '2026-12-01',
    unidades: ['HR Natal/RN', 'Aliança Natal/RN', 'HM Fortaleza/CE', 'HM Manaus/AM'],
    chaves: [], pacientes: 641 },
  { n: 5, fase: 'Finalização', periodo: 'Janeiro', mes: '2027-01', virada: '2027-01-01',
    unidades: ['HR Salvador/BA', 'Aliança Aracaju/SE', 'HR Recife/PE', 'HR Maceió/AL'],
    chaves: [], pacientes: 458 },
];

/**
 * A grafia canônica de cada pessoa.
 *
 * A coluna "Executante" tem variantes da mesma pessoa — "Dayvison" e "Dayvson
 * Rocha", "Rodrigo Sideaux" e "Rodrigo Sindeaux", "Beariz" e "Beatriz". Sem
 * normalizar, o filtro por executante mostraria a mesma pessoa duas vezes e o
 * diagnóstico de "sem responsável" contaria errado.
 *
 * A grafia que ganha é a da coluna "Líder do Grupo", que é a cadastrada na aba
 * Parâmetros — escolher por frequência faria "Rodrigo Sideaux" (18 linhas)
 * vencer a grafia do cadastro (19 linhas).
 */
const SPIN_ALIAS_PESSOA = {
  'dayvison': 'Dayvson Rocha',
  'rodrigo sideaux': 'Rodrigo Sindeaux',
  'beariz santos': 'Beatriz Santos',
  'mayana almeida': 'Mayanna Almeida',
  'cida': 'Cida Martorelli',
  'joacil': 'Joacil Junior',
  'danilo batista': 'Danilo Batista',
};

/** Sem acento, sem espaço duplicado, minúsculo — a chave de comparação. */
const spinChaveNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Os executantes de uma atividade, já normalizados.
 *
 * A célula pode trazer MAIS DE UMA pessoa, separadas por quebra de linha —
 * 21 linhas trazem duas. Tratá-la como texto único faria "Gabriel Cavalcanti
 * \n Danilo Batista" virar um executante inexistente com esse nome.
 *
 * "-" é uma marca explícita de "ninguém", e vira lista vazia como o branco:
 * as duas dizem a mesma coisa, e o diagnóstico conta as duas juntas.
 */
function spinExecutantes(bruto) {
  return String(bruto || '').split(/[\n;]+/).map((x) => x.trim())
    .filter((x) => x && x !== '-')
    .map((x) => SPIN_ALIAS_PESSOA[spinChaveNome(x)] || x);
}

// ----------------------------------------------------------- derivados
/** O critério de aceite: o específico manda; sem ele, o padrão do tipo. */
const spinCriterioDeAceite = (a) =>
  (a.criterioEspecifico || SPIN_CRITERIOS_PADRAO[a.tipoEntrega] || '');

/** As unidades com situação preenchida nesta atividade. */
const spinSituacoes = (a) => Object.entries(a.unidades || {})
  .filter(([, v]) => v).map(([k, v]) => ({ unidade: k, situacao: v }));

/**
 * O status consolidado: o PIOR entre as unidades.
 *
 * A ordem da planilha é Bloqueado › Não iniciado › Em andamento › Concluído —
 * uma atividade só está concluída quando está concluída em todas. Tomar a
 * melhor situação, ou a mais frequente, diria que a atividade acabou enquanto
 * uma unidade ainda não começou.
 */
function spinStatusConsolidado(a) {
  const sit = spinSituacoes(a).map((s) => s.situacao);
  if (!sit.length) return '';
  for (const alvo of ['Bloqueado', 'Não iniciado', 'Em andamento', 'Concluído', 'Cancelado']) {
    if (sit.includes(alvo)) return alvo;
  }
  return sit[0];
}

/** O avanço de 0 a 1. `null` quando a atividade não entra no cálculo. */
function spinAvanco(a) {
  const st = spinStatusConsolidado(a);
  // Cancelada e criticidade N/A ficam FORA: é o que define as "atividades
  // válidas" do painel, e incluí-las mudaria o denominador de todo percentual.
  if (!st || st === 'Cancelado' || !SPIN_PESOS[a.criticidade]) return null;
  return st === 'Concluído' ? 1 : st === 'Em andamento' ? 0.5 : st === 'Bloqueado' ? 0.25 : 0;
}

const spinPeso = (a) => (spinAvanco(a) === null ? null : SPIN_PESOS[a.criticidade] || null);
const spinAvancoPonderado = (a) => {
  const av = spinAvanco(a); const p = spinPeso(a);
  return av === null || p === null ? null : av * p;
};

/**
 * Dias até o prazo — negativo é vencido.
 *
 * Sai do prazo repactuado quando ele existe; senão, da data-base da onda mais
 * o deslocamento da criticidade, como a planilha faz. A data de referência é
 * a de hoje, e não a que estava congelada na planilha: um painel que mede o
 * atraso contra uma data antiga envelhece em silêncio.
 */
const SPIN_DESLOCAMENTO = { 'GO-LIVE': -10, 'ESTABILIZAÇÃO': 15, 'EVOLUÇÃO': 45 };
function spinDiasParaPrazo(a, hoje) {
  const ref = hoje || new Date().toISOString().slice(0, 10);
  const base = a.prazoRepactuado || (a.dataBaseOnda && SPIN_DESLOCAMENTO[a.criticidade] !== undefined
    ? diaSoma(a.dataBaseOnda, SPIN_DESLOCAMENTO[a.criticidade]) : '');
  if (!base) return null;
  return Math.round((Date.parse(base + 'T00:00:00Z') - Date.parse(ref + 'T00:00:00Z')) / 86400000);
}

/** Soma dias a uma data ISO, devolvendo ISO. */
function diaSoma(iso, dias) {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(t)) return '';
  return new Date(t + dias * 86400000).toISOString().slice(0, 10);
}

/** O farol: VERDE concluído, VERMELHO bloqueado ou vencido em aberto. */
function spinFarol(a, hoje) {
  if (spinPeso(a) === null) return 'N/A';
  const st = spinStatusConsolidado(a);
  if (st === 'Bloqueado') return 'VERMELHO';
  if (st === 'Concluído') return 'VERDE';
  const dias = spinDiasParaPrazo(a, hoje);
  return dias !== null && dias < 0 ? 'VERMELHO' : 'AMARELO';
}
const SPIN_CORES_FAROL = { VERDE: 'var(--bomtxt)', AMARELO: 'var(--alerta)',
  VERMELHO: 'var(--crit)', 'N/A': 'var(--tinta3)' };

/** A atividade com tudo o que se calcula dela, para as telas consumirem. */
function spinDerivar(a, hoje) {
  const status = spinStatusConsolidado(a);
  const preenchidas = spinSituacoes(a);
  return {
    ...a,
    criterioAceite: spinCriterioDeAceite(a),
    executantes: spinExecutantes(a.executante),
    statusConsolidado: status,
    unidSemStatus: SPIN_UNIDADES.filter((u) => u.onda).length - preenchidas.length,
    statusIgualEmTodas: preenchidas.length < 2 ? ''
      : (preenchidas.every((s) => s.situacao === status) ? 'SIM' : 'NÃO'),
    avanco: spinAvanco(a),
    peso: spinPeso(a),
    avancoPonderado: spinAvancoPonderado(a),
    farol: spinFarol(a, hoje),
    diasParaPrazo: spinDiasParaPrazo(a, hoje),
  };
}

// ------------------------------------------------------------- leitura
/** As colunas da planilha, pela LETRA — o cabeçalho está na linha 2. */
const SPIN_COLUNAS = {
  id: 'A', fonte: 'B', grupoTime: 'C', frente: 'D', replicavel: 'E', atividade: 'F',
  tipoEntrega: 'G', caminho: 'I', criticidade: 'J', lider: 'K', executante: 'L',
  dataBaseOnda: 'M', prazoRepactuado: 'AD', pendencia: 'AX', proximaAcao: 'AY',
  evidencia: 'AZ', criterioEspecifico: 'BA', observacoes: 'BB',
};
const SPIN_COL_PRAZO = ['N', 'P', 'R', 'T', 'V', 'X', 'Z', 'AB'];
const SPIN_COL_SITUACAO = ['O', 'Q', 'S', 'U', 'W', 'Y', 'AA', 'AC'];
const SPIN_COL_UNIDADE = ['AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN'];

/** 'AE' → 30. O índice da coluna na grade, a partir de zero. */
function spinIndiceColuna(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Data da planilha → ISO.
 *
 * O Excel guarda data como número de dias desde 30/12/1899, e o leitor devolve
 * a célula crua. Texto em DD/MM/AAAA também aparece quando alguém digita à
 * mão. Qualquer outra coisa volta vazia em vez de virar uma data inventada.
 */
function spinData(bruto) {
  const v = String(bruto == null ? '' : bruto).trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const n = Number(v);
  // A faixa exclui números que não são data: 20000 é 1954 e 80000 é 2119.
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }
  return '';
}

/** A situação, casada sem depender de acento nem de caixa. */
function spinSituacao(bruto) {
  const chave = spinChaveNome(bruto);
  if (!chave) return '';
  return SPIN_SITUACOES_LISTA.find((s) => spinChaveNome(s) === chave) || String(bruto).trim();
}

/**
 * Lê a aba "Controle Mestre" e devolve as atividades mais o diagnóstico.
 *
 * Nada é inventado: campo vazio continua vazio e é CONTADO no diagnóstico. É
 * a diferença entre uma carga que informa o que falta e uma que preenche o
 * buraco com um palpite que ninguém mais consegue distinguir do dado real.
 */
function spinLerControleMestre(grade, cliente) {
  const cel = (linha, letra) => {
    const v = linha[spinIndiceColuna(letra)];
    return v == null ? '' : String(v).trim();
  };
  const cabecalho = grade[1] || [];
  if (cel(cabecalho, 'A') !== 'ID' || cel(cabecalho, 'F') !== 'Atividade') {
    throw new Error('A aba "Controle Mestre" não tem o cabeçalho esperado na linha 2 '
      + '(esperado "ID" na coluna A e "Atividade" na coluna F). '
      + 'Confira se o arquivo é o Controle Único do Projeto SpinCare.');
  }

  const atividades = [];
  const problemas = [];
  const normalizados = new Map();
  // O ID da planilha NÃO é único: PRE-11 nomeia duas atividades distintas
  // ("Cadastro de Usuário Externos" e "…Internos"). Ele é o rótulo do cliente,
  // e a identidade do sistema não pode depender dele sozinho — recusar a
  // segunda linha perderia uma atividade de verdade.
  //
  // A chave interna é ID + atividade. Mesmo ID com atividade DIFERENTE são
  // duas, e ganham `#2`, `#3`… na chave, mantendo o ID como veio na tela.
  // Mesmo ID com a MESMA atividade é linha repetida de fato, e aí sim a
  // segunda é recusada: das duas, não há como saber qual é a boa.
  const porId = new Map();
  const vistos = new Set();

  for (let i = 2; i < grade.length; i += 1) {
    const linha = grade[i] || [];
    const id = cel(linha, 'A');
    if (!id) continue;                      // linha de rodapé ou espaçamento
    const nLinha = i + 1;                   // número da linha como no Excel
    const nomeAtividade = cel(linha, 'F');
    const assinatura = id + '\u0000' + spinChaveNome(nomeAtividade);
    if (vistos.has(assinatura)) {
      problemas.push({ linha: nLinha, id, tipo: 'erro',
        texto: `Linha repetida: "${id}" com a mesma atividade já apareceu antes. A linha foi `
          + 'recusada — das duas, o sistema não tem como saber qual é a boa.' });
      continue;
    }
    vistos.add(assinatura);
    const repeticao = (porId.get(id) || 0) + 1;
    porId.set(id, repeticao);
    if (repeticao > 1) {
      problemas.push({ linha: nLinha, id, tipo: 'aviso',
        texto: `O ID "${id}" nomeia mais de uma atividade na planilha. As duas foram mantidas; `
          + 'convém dar um ID próprio a cada uma na origem.' });
    }

    const a = { cliente, id, chave: repeticao > 1 ? `${id}#${repeticao}` : id };
    for (const [campo, letra] of Object.entries(SPIN_COLUNAS)) {
      if (campo === 'id') continue;
      const v = cel(linha, letra);
      if (!v) continue;
      a[campo] = (campo === 'dataBaseOnda' || campo === 'prazoRepactuado') ? spinData(v) : v;
    }
    // Guarda a grafia original para o diagnóstico poder mostrar o de-para.
    for (const nome of String(a.executante || '').split(/[\n;]+/).map((x) => x.trim())) {
      const canon = nome && nome !== '-' ? SPIN_ALIAS_PESSOA[spinChaveNome(nome)] : null;
      if (canon && canon !== nome) normalizados.set(nome, canon);
    }

    const ondas = {};
    for (let o = 0; o < 8; o += 1) {
      const prazo = spinData(cel(linha, SPIN_COL_PRAZO[o]));
      const situacao = spinSituacao(cel(linha, SPIN_COL_SITUACAO[o]));
      if (prazo || situacao) ondas[String(o + 1)] = { ...(prazo && { prazo }), ...(situacao && { situacao }) };
    }
    if (Object.keys(ondas).length) a.ondas = ondas;

    const unidades = {};
    SPIN_COL_UNIDADE.forEach((letra, idx) => {
      const bruto = cel(linha, letra);
      if (!bruto) return;
      const s = spinSituacao(bruto);
      const chave = SPIN_UNIDADES[idx].k;
      if (!SPIN_SITUACOES[s]) {
        problemas.push({ linha: nLinha, id, tipo: 'aviso',
          texto: `Situação não reconhecida em ${SPIN_UNIDADES[idx].rotulo}: "${bruto}". `
            + `Valores aceitos: ${SPIN_SITUACOES_LISTA.join(', ')}. O valor foi guardado como veio.` });
      }
      unidades[chave] = s;
    });
    if (Object.keys(unidades).length) a.unidades = unidades;

    if (!a.atividade) {
      problemas.push({ linha: nLinha, id, tipo: 'erro',
        texto: 'Linha sem o nome da atividade (coluna F). Recusada.' });
      continue;
    }
    if (!a.criticidade) {
      problemas.push({ linha: nLinha, id, tipo: 'aviso',
        texto: 'Sem criticidade: a atividade entra, mas fica fora do avanço ponderado.' });
    }
    atividades.push(a);
  }

  return { atividades, problemas, normalizados: [...normalizados.entries()] };
}

/**
 * O diagnóstico da carga: o que entrou, o que falta e o que foi normalizado.
 *
 * Existe porque "172 atividades importadas" não responde à pergunta que o
 * gestor tem em seguida — quantas estão sem responsável, quantas sem caminho
 * no sistema, quantas unidades ainda não têm coluna.
 */
function spinDiagnostico(atividades) {
  const derivadas = atividades.map((a) => spinDerivar(a));
  const contar = (f) => derivadas.filter(f).length;
  const porCampo = (campo) => contar((a) => !String(a[campo] || '').trim());
  const validas = derivadas.filter((a) => a.avanco !== null);
  const unidadesUsadas = new Set();
  for (const a of derivadas) for (const k of Object.keys(a.unidades || {})) unidadesUsadas.add(k);
  return {
    total: derivadas.length,
    validas: validas.length,
    // As três contagens do painel, sobre as VÁLIDAS — que é o mesmo universo
    // do denominador. Contar sobre o total e dividir pelas válidas é o que faz
    // os percentuais do status report somarem mais de 100%.
    concluidas: validas.filter((a) => a.statusConsolidado === 'Concluído').length,
    emAndamento: validas.filter((a) => a.statusConsolidado === 'Em andamento').length,
    naoIniciadas: validas.filter((a) => a.statusConsolidado === 'Não iniciado').length,
    bloqueadas: validas.filter((a) => a.statusConsolidado === 'Bloqueado').length,
    canceladas: derivadas.filter((a) => a.statusConsolidado === 'Cancelado').length,
    semExecutante: derivadas.filter((a) => a.executantes.length === 0).length,
    semCaminho: porCampo('caminho'),
    semCriticidade: porCampo('criticidade'),
    // "N/A" não é ausência: é uma criticidade escrita de propósito, e é ela
    // que tira a atividade do universo válido. Somá-la ao branco esconderia
    // por que 172 linhas viram 165 válidas.
    criticidadeNA: contar((a) => String(a.criticidade || '').trim() === 'N/A'),
    semDataBase: porCampo('dataBaseOnda'),
    unidadesComColuna: [...unidadesUsadas],
    // As unidades do CRONOGRAMA que ainda não têm coluna na planilha — as das
    // ondas 3 a 5. Listar só as vagas vazias (`unidade_7`…) diria "faltam
    // quatro" sem dizer quais, que é a informação que falta para agir.
    unidadesSemColuna: SPIN_ONDAS.filter((o) => !o.chaves.length).flatMap((o) => o.unidades),
    grupos: new Set(derivadas.map((a) => a.grupoTime).filter(Boolean)).size,
    executantes: new Set(derivadas.flatMap((a) => a.executantes)).size,
  };
}

/** As atividades do cliente em foco, já com os campos derivados. */
function spinAtividades() {
  return (E.spincare || []).filter((a) => a.cliente === E.clienteSel).map((a) => spinDerivar(a));
}

// ------------------------------------------------------------- a tela
/**
 * A tela do projeto SpinCare: a carga da planilha e o diagnóstico dela.
 *
 * A Entrega 1 entrega a BASE — ler a planilha sem perder nada e dizer o que
 * entrou. A listagem fiel (Entrega 2), o cronograma macro (3) e o dashboard
 * (4) leem daqui, e por isso a carga vem antes: sem base, as três seriam
 * telas bonitas sobre dados inventados.
 */
function viewSpincare() {
  const atividades = spinAtividades();
  const d = atividades.length ? spinDiagnostico(
    (E.spincare || []).filter((a) => a.cliente === E.clienteSel)) : null;
  const carga = (E.config || {}).spincareCarga || null;

  el('#pagina').innerHTML = `
    <div class="msg"><strong>A base é a planilha "Controle Único do Projeto SpinCare".</strong>
      Nela a linha é uma <strong>atividade do projeto</strong>, e cada unidade acompanhada tem uma
      coluna de situação dentro dela — uma atividade concluída em três unidades e não iniciada em
      outras três é <strong>uma</strong> linha, não seis. É por isso que ela tem cadastro próprio,
      ao lado de projetos e tarefas.</div>

    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:var(--esp-8)">
      <header><h2>Carga da planilha</h2>
        <span class="nota">${carga
          ? `última carga em ${esc(carga.quando || '—')} · ${inteiro(carga.total || 0)} atividade(s)`
          : 'nenhuma carga ainda'}</span></header>
      <div class="filtros" style="box-shadow:none;border:0;padding:0">
        <div class="campo" style="min-width:300px">
          <label for="spin-arq">Arquivo .xlsx do Controle Único</label>
          <input type="file" id="spin-arq" accept=".xlsx"></div>
        <button class="bt pri" id="spin-carregar" disabled>Conferir e carregar</button>
        ${atividades.length ? '<button class="bt fant perigo" id="spin-limpar">Remover a base carregada</button>' : ''}
      </div>
      <!-- O relatório da carga fica em estado, e não só no DOM: repintar a
           tela logo depois de gravar apagava o relatório no mesmo instante em
           que a pessoa ia lê-lo. Sem cerca invertida aqui dentro: ela fecharia
           o template literal no meio do HTML. -->
      <div id="spin-resultado" style="margin-top:var(--esp-7)">${
        E.spincareRelatorio ? relatorioSpincareHtml(E.spincareRelatorio) : ''}</div>
    </section>

    ${!d ? `<section class="bloco" style="margin-top:var(--esp-8)">
        <header><h2>Diagnóstico da base</h2></header>
        <p class="vazio">Nenhuma atividade carregada ainda. Suba a planilha acima para ver o
          que entrou e o que ficou faltando.</p>
      </section>` : `${listagemSpincareHtml()}${diagnosticoSpincareHtml(d)}`}`;

  const arq = el('#spin-arq');
  const bt = el('#spin-carregar');
  arq.addEventListener('change', () => { bt.disabled = !arq.files.length; });
  bt.addEventListener('click', () => carregarSpincare(arq, bt));
  const limpar = el('#spin-limpar');
  if (limpar) limpar.addEventListener('click', () => removerBaseSpincare());
  ligarListagemSpincare();
  dobrarBlocos();
}

/** O diagnóstico em números, com o que falta em destaque. */
function diagnosticoSpincareHtml(d) {
  const cartao = (rot, valor, apoio, cor) => `<div class="kpi">
    <span class="r">${esc(rot)}</span>
    <span class="n"${cor ? ` style="color:${cor}"` : ''}>${valor}</span>
    ${apoio ? `<span class="a">${esc(apoio)}</span>` : ''}</div>`;
  const falta = (rot, n, apoio) => `<tr>
    <td>${esc(rot)}</td>
    <td class="n"${n ? ' style="color:var(--alerta);font-weight:700"' : ''}>${inteiro(n)}</td>
    <td>${esc(apoio)}</td></tr>`;
  return `
    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:var(--esp-8)">
      <header><h2>Diagnóstico da base</h2>
        <span class="nota">${inteiro(d.total)} atividade(s) · ${inteiro(d.grupos)} grupo(s) ·
          ${inteiro(d.executantes)} executante(s)</span></header>

      <div class="kpis">
        ${cartao('Atividades válidas', inteiro(d.validas), 'excluem canceladas e sem criticidade')}
        ${cartao('Concluídas', inteiro(d.concluidas), pctTxt(pct(d.concluidas, d.validas)), 'var(--bomtxt)')}
        ${cartao('Em andamento', inteiro(d.emAndamento), pctTxt(pct(d.emAndamento, d.validas)), 'var(--s2)')}
        ${cartao('Não iniciadas', inteiro(d.naoIniciadas), pctTxt(pct(d.naoIniciadas, d.validas)), 'var(--alerta)')}
        ${cartao('Bloqueadas', inteiro(d.bloqueadas), pctTxt(pct(d.bloqueadas, d.validas)))}
      </div>

      <!-- Os três percentuais somam 100% porque numerador e denominador saem
           do MESMO universo. No status report do cliente eles somam 104,24%:
           as contagens são sobre as 172 linhas e o denominador é 165. -->
      <div class="msg" style="margin-top:var(--esp-7)">
        <strong>Os percentuais somam ${pctTxt(pct(d.concluidas + d.emAndamento + d.naoIniciadas
          + d.bloqueadas, d.validas))}.</strong>
        Numerador e denominador saem do mesmo universo — as
        ${inteiro(d.validas)} atividades válidas. No Status Report de referência eles somam
        <strong>104,24%</strong>, porque as contagens são feitas sobre as ${inteiro(d.total)} linhas
        e o denominador exclui as sem criticidade.
      </div>

      <h3 class="titulo-mini">O que ficou faltando na planilha</h3>
      <div class="rol"><table>
        <thead><tr><th>Campo</th><th class="n">Atividades</th><th>Por que importa</th></tr></thead>
        <tbody>
          ${falta('Sem executante nomeado', d.semExecutante, 'ninguém responde por elas')}
          ${falta('Sem caminho no sistema', d.semCaminho, 'quem executa não sabe onde fazer')}
          ${falta('Sem criticidade', d.semCriticidade, 'ficam fora do avanço ponderado')}
          ${falta('Criticidade "N/A"', d.criticidadeNA,
            'escrita de propósito; é ela que tira ' + inteiro(d.total - d.validas)
            + ' linha(s) do universo válido')}
          ${falta('Sem data-base da onda', d.semDataBase, 'sem ela não há prazo a medir')}
        </tbody></table></div>

      <h3 class="titulo-mini">Unidades</h3>
      <p class="nota">Com coluna na planilha: <strong>${d.unidadesComColuna.length
        ? esc(d.unidadesComColuna.map((k) => (SPIN_UNIDADE_POR_CHAVE[k] || {}).rotulo || k).join(', '))
        : 'nenhuma'}</strong>.
        ${d.unidadesSemColuna.length
          ? `Sem coluna ainda: <strong>${esc(d.unidadesSemColuna.join(', '))}</strong>.` : ''}
        As unidades das ondas 3 a 5 do cronograma ainda não têm coluna na planilha — elas aparecem
        como <strong>pendentes</strong> no cronograma macro, e não como não iniciadas: a planilha
        não diz que não começaram, ela ainda não pergunta.</p>
    </section>`;
}

/**
 * O arquivo É o Controle Único? Devolve a aba mestre, ou `null`.
 *
 * Existe para a carga funcionar EM QUALQUER TELA: o gestor não deveria ter de
 * descobrir qual das duas telas de importação aceita qual arquivo. A tela de
 * Dados tenta este caminho primeiro e, não sendo, segue pelo modelo de sempre.
 */
async function abaDoControleUnico(bytes) {
  const abas = await gradeDoXlsx(bytes);
  const mestre = abas.find((a) => spinChaveNome(a.nome) === spinChaveNome('Controle Mestre'));
  if (!mestre) return null;
  const cel = (linha, i) => String((linha || [])[i] == null ? '' : (linha || [])[i]).trim();
  // O nome da aba sozinho não basta: o que prova o layout é o cabeçalho na
  // linha 2. Aceitar pelo nome faria uma planilha homônima entrar torta.
  const cab = mestre.grade[1] || [];
  return cel(cab, 0) === 'ID' && cel(cab, 5) === 'Atividade' ? mestre : null;
}

/**
 * Lê, grava e devolve o relatório. É o ÚNICO caminho de carga do Controle
 * Único — a tela do projeto e a de Dados chamam esta função, e duas
 * implementações divergiriam na primeira correção.
 */
async function importarControleUnico(mestre, nomeArquivo) {
  const lido = spinLerControleMestre(mestre.grade, E.clienteSel);
  if (!lido.atividades.length) {
    throw new Error('A aba "Controle Mestre" não trouxe nenhuma atividade com ID. '
      + 'Confira se o cabeçalho está na linha 2 e se a coluna A tem os IDs.');
  }
  // As atividades de OUTROS clientes ficam: a base é uma só, e cada item
  // carrega o dono — é a mesma convenção de metas e do plano de redução.
  const outras = (E.spincare || []).filter((a) => a.cliente !== E.clienteSel);
  await Loja.gravarCatalogo('spincare', [...outras, ...lido.atividades]);
  await Loja.gravarConfiguracao({ spincareCarga: {
    quando: new Date().toLocaleString('pt-BR'), total: lido.atividades.length,
    arquivo: nomeArquivo, cliente: E.clienteSel } });
  await Loja.auditar({ entidade: 'spincare', acao: 'importar',
    descricao: `${lido.atividades.length} atividade(s) do Controle Único, de ${nomeArquivo}` });
  E.spincareRelatorio = lido;
  return lido;
}

/** Lê o arquivo escolhido, mostra o resultado e grava. */
async function carregarSpincare(campo, botao) {
  const alvo = el('#spin-resultado');
  const arquivo = campo.files && campo.files[0];
  if (!arquivo) return;
  botao.disabled = true;
  alvo.innerHTML = '<p class="msg">Lendo a planilha…</p>';
  try {
    const mestre = await abaDoControleUnico(new Uint8Array(await arquivo.arrayBuffer()));
    if (!mestre) {
      throw new Error('O arquivo não tem a aba "Controle Mestre" com o cabeçalho esperado na '
        + 'linha 2 ("ID" na coluna A e "Atividade" na coluna F). '
        + 'Confira se é o Controle Único do Projeto SpinCare.');
    }
    await importarControleUnico(mestre, arquivo.name);
    await render();
  } catch (e) {
    // A mensagem do erro é a que a pessoa lê para decidir o que fazer: ela
    // nomeia o arquivo e o que se esperava dele, nunca o detalhe interno.
    E.spincareRelatorio = null;
    alvo.innerHTML = `<div class="msg erro"><strong>A carga não foi feita.</strong>
      ${esc(e && e.message ? e.message : String(e))}</div>`;
    botao.disabled = false;
  }
}

/** O relatório da carga: quantas entraram e o que foi normalizado ou recusado. */
function relatorioSpincareHtml(lido) {
  const erros = lido.problemas.filter((p) => p.tipo === 'erro');
  const avisos = lido.problemas.filter((p) => p.tipo === 'aviso');
  const lista = (titulo, itens, classe) => (!itens.length ? '' : `
    <div class="msg ${classe}" style="margin-top:var(--esp-5)"><strong>${esc(titulo)}</strong>
      <ul style="margin:var(--esp-3) 0 0;padding-left:var(--esp-9)">
        ${itens.slice(0, 12).map((p) => `<li>Linha ${inteiro(p.linha)}${
          p.id ? ` (${esc(p.id)})` : ''}: ${esc(p.texto)}</li>`).join('')}
        ${itens.length > 12 ? `<li>e mais ${inteiro(itens.length - 12)}</li>` : ''}
      </ul></div>`);
  return `
    <div class="msg ok"><strong>${inteiro(lido.atividades.length)} atividade(s) carregada(s).</strong>
      ${erros.length ? `${inteiro(erros.length)} linha(s) recusada(s).` : 'Nenhuma linha recusada.'}</div>
    ${lista('Linhas recusadas', erros, 'erro')}
    ${lista('Avisos', avisos, 'alerta')}
    ${!lido.normalizados.length ? '' : `
      <div class="msg" style="margin-top:var(--esp-5)"><strong>Grafias normalizadas.</strong>
        A mesma pessoa aparecia escrita de formas diferentes; a grafia que vale é a do cadastro de
        líderes. O nome original continua no arquivo — o que mudou foi só como o sistema agrupa.
        <ul style="margin:var(--esp-3) 0 0;padding-left:var(--esp-9)">
          ${lido.normalizados.map(([de, para]) =>
            `<li><code>${esc(de)}</code> → <strong>${esc(para)}</strong></li>`).join('')}
        </ul></div>`}`;
}

/** Remove a base do cliente em foco, com confirmação e trilha. */
function removerBaseSpincare() {
  const quantas = spinAtividades().length;
  abrirModal({
    titulo: 'Remover a base do projeto SpinCare',
    corpo: `<div class="msg alerta"><strong>Isto apaga ${inteiro(quantas)} atividade(s)
      deste cliente.</strong> As telas que leem desta base voltam a ficar vazias até uma carga nova.
      A planilha de origem não é tocada.</div>`,
    acoes: [{ rotulo: 'Remover', classe: 'bt perigo', acao: async () => {
      const outras = (E.spincare || []).filter((a) => a.cliente !== E.clienteSel);
      await Loja.gravarCatalogo('spincare', outras);
      await Loja.gravarConfiguracao({ spincareCarga: null });
      E.spincareRelatorio = null;
      await Loja.auditar({ entidade: 'spincare', acao: 'excluir',
        descricao: `${quantas} atividade(s) removida(s) do Controle Único` });
      await render();
    } }],
  });
}

// ===================================================================== //
// O DASHBOARD DO SPINCARE nos Indicadores Gerais.
//
// Quatro leituras do mesmo universo: como as atividades se repartem por
// situação, quantas em cada uma, quanto cada unidade avançou, e o que fazer
// em seguida. Todas saem da base carregada — nenhum número é digitado.
// ===================================================================== //

/** As cores do Status Report, na ordem em que ele as apresenta. */
const SPIN_ORDEM_PAINEL = ['Concluído', 'Em andamento', 'Não iniciado', 'Bloqueado', 'Cancelado'];
const SPIN_ROTULO_PAINEL = {
  'Concluído': 'Concluídas', 'Em andamento': 'Em andamento', 'Não iniciado': 'Não iniciadas',
  'Bloqueado': 'Bloqueadas', 'Cancelado': 'Canceladas',
};

/** O recorte do bloco aplicado às atividades. Conjunto vazio = todas. */
function spinNoRecorte(a, f) {
  if (!f) return true;
  const passa = (conj, valor) => !conj || conj.size === 0 || conj.has(valor);
  if (f.ondas && f.ondas.size) {
    // A onda de uma atividade são as unidades dela que têm situação: a mesma
    // atividade pode estar na onda 1 e na 2 ao mesmo tempo.
    const ondas = new Set(Object.keys(a.unidades || {})
      .map((k) => (SPIN_UNIDADE_POR_CHAVE[k] || {}).onda).filter(Boolean));
    if (![...f.ondas].some((o) => ondas.has(Number(o)))) return false;
  }
  if (f.unidades && f.unidades.size) {
    if (![...f.unidades].some((u) => (a.unidades || {})[u])) return false;
  }
  if (!passa(f.frentes, a.frente)) return false;
  if (!passa(f.status, a.statusConsolidado)) return false;
  if (f.executantes && f.executantes.size) {
    if (!a.executantes.some((p) => f.executantes.has(p))) return false;
  }
  return true;
}

/**
 * O painel: distribuição, contagem por status, avanço por unidade e a lista
 * do que fazer em seguida.
 *
 * As CANCELADAS ficam fora do universo válido, e é por isso que os
 * percentuais somam 100%. No Status Report de referência eles somam 104,24%,
 * porque as contagens são feitas sobre as 172 linhas e o denominador exclui
 * as 7 de criticidade "N/A" — numerador e denominador de universos
 * diferentes.
 */
function calcularSpincare(recorte) {
  const todas = spinAtividades().filter((a) => spinNoRecorte(a, recorte));
  const validas = todas.filter((a) => a.avanco !== null);
  const porStatus = SPIN_ORDEM_PAINEL.map((st) => {
    // Cancelada não entra no universo válido; ela é contada à parte, e é o
    // que o painel do cliente chama de "não entram no cálculo".
    const base = st === 'Cancelado' ? todas : validas;
    const itens = base.filter((a) => a.statusConsolidado === st);
    return { status: st, nome: SPIN_ROTULO_PAINEL[st], cor: SPIN_SITUACOES[st].cor,
      valor: itens.length, itens, foraDoCalculo: st === 'Cancelado',
      pct: st === 'Cancelado' ? 0 : pct(itens.length, validas.length) };
  });

  // O avanço de cada unidade: ponderado (peso × avanço da unidade) e, ao
  // lado, a conclusão simples — que é o número do Status Report. São medidas
  // diferentes, e mostrar uma chamando-a da outra faria o gestor procurar um
  // erro que não existe.
  const unidades = SPIN_UNIDADES.filter((u) => u.onda)
    .filter((u) => validas.some((a) => (a.unidades || {})[u.k]))
    .map((u) => {
      const comSituacao = validas.filter((a) => (a.unidades || {})[u.k]);
      const avancoDe = (s) => (s === 'Concluído' ? 1 : s === 'Em andamento' ? 0.5
        : s === 'Bloqueado' ? 0.25 : 0);
      const somaPeso = comSituacao.reduce((t, a) => t + (a.peso || 0), 0);
      const somaPond = comSituacao.reduce((t, a) =>
        t + (a.peso || 0) * avancoDe(a.unidades[u.k]), 0);
      const concluidas = comSituacao.filter((a) => a.unidades[u.k] === 'Concluído');
      return { ...u, itens: comSituacao, total: comSituacao.length,
        concluidas: concluidas.length, itensConcluidos: concluidas,
        pctConclusao: pct(concluidas.length, comSituacao.length),
        pctPonderado: somaPeso ? Math.round((somaPond / somaPeso) * 1000) / 10 : 0 };
    });

  const porOnda = SPIN_ONDAS
    .map((o) => ({ ...o, unidades: unidades.filter((u) => u.onda === o.n) }))
    .filter((o) => o.unidades.length);

  const semExecutante = validas.filter((a) => a.executantes.length === 0);
  const emAndamento = validas.filter((a) => a.statusConsolidado === 'Em andamento');
  const naoIniciadas = validas.filter((a) => a.statusConsolidado === 'Não iniciado');
  const vencidas = validas.filter((a) => a.farol === 'VERMELHO' && a.statusConsolidado !== 'Concluído');
  const primeiraOnda = SPIN_ONDAS[0].chaves;
  const daPrimeira = validas.filter((a) => primeiraOnda.some((k) =>
    (a.unidades || {})[k] && a.unidades[k] !== 'Concluído'));

  return {
    todas, validas, porStatus, unidades, porOnda,
    // Os próximos passos SAEM DA BASE, com contador. Uma lista escrita à mão
    // continuaria dizendo "preparar a 1ª virada" depois de ela acontecer.
    passos: [
      { texto: 'Avançar nas atividades em andamento', n: emAndamento.length, itens: emAndamento,
        cor: SPIN_SITUACOES['Em andamento'].cor },
      { texto: 'Iniciar as atividades planejadas', n: naoIniciadas.length, itens: naoIniciadas,
        cor: SPIN_SITUACOES['Não iniciado'].cor },
      { texto: 'Garantir executante para as atividades sem responsável', n: semExecutante.length,
        itens: semExecutante, cor: 'var(--alerta)' },
      { texto: 'Recuperar as atividades com prazo vencido', n: vencidas.length, itens: vencidas,
        cor: 'var(--crit)' },
      { texto: `Preparar a 1ª virada (${SPIN_ONDAS[0].chaves
        .map((k) => SPIN_UNIDADE_POR_CHAVE[k].rotulo).join(', ')})`, n: daPrimeira.length,
        itens: daPrimeira, cor: 'var(--s1)' },
    ].filter((p) => p.n > 0),
  };
}

/** As colunas da tela flutuante de atividades, do maior peso para o menor. */
const COLUNAS_ATIVIDADE_SPIN = [
  { rotulo: 'ID', campo: 'id' },
  { rotulo: 'Atividade', campo: 'atividade', texto: true },
  { rotulo: 'Grupo / Time', campo: 'grupoTime' },
  { rotulo: 'Frente', campo: 'frente' },
  { rotulo: 'Tipo de entrega', campo: 'tipoEntrega' },
  { rotulo: 'Criticidade', campo: 'criticidade' },
  { rotulo: 'Executante', valor: (a) => (a.executantes.length ? a.executantes.join(', ') : '—') },
  { rotulo: 'Status', campo: 'statusConsolidado' },
  { rotulo: 'Farol', campo: 'farol' },
  { rotulo: 'Avanço', valor: (a) => (a.avanco === null ? '—' : pctTxt(a.avanco * 100)), n: true },
  { rotulo: 'Peso', valor: (a) => (a.peso === null ? '—' : inteiro(a.peso)), n: true },
  { rotulo: 'Ponderado', valor: (a) => (a.avancoPonderado === null ? '—'
    : a.avancoPonderado.toLocaleString('pt-BR')), n: true },
  { rotulo: 'Dias p/ prazo', valor: (a) => (a.diasParaPrazo === null ? '—'
    : inteiro(a.diasParaPrazo)), n: true },
];

/**
 * A tela flutuante com as atividades que compõem um número.
 *
 * A ordem é por AVANÇO PONDERADO decrescente — o peso vezes o avanço é o que
 * diz onde está o volume de trabalho, e ordenar por ID devolveria a ordem da
 * planilha, que não responde pergunta nenhuma.
 */
function abrirAtividadesSpin(titulo, itens, nota) {
  const ordenadas = [...itens].sort((a, b) =>
    (b.avancoPonderado || 0) - (a.avancoPonderado || 0)
    || (b.peso || 0) - (a.peso || 0)
    || String(a.id).localeCompare(String(b.id), 'pt-BR'));
  abrirRegistros({
    titulo, tipo: 'spincare-atividades', larga: true,
    colunas: COLUNAS_ATIVIDADE_SPIN, itens: ordenadas, contagem: null,
    nota: nota || `${inteiro(ordenadas.length)} atividade(s), da maior para a menor `
      + 'contribuição ao avanço ponderado.',
  });
}

/** A legenda da rosca: nome, valor e fatia, porque a cor nunca basta. */
function legendaDaRoscaHtml(p) {
  return `<div class="legenda-tipos" style="flex-direction:column;gap:var(--esp-3);align-items:flex-start">
    ${p.porStatus.map((s) => `<span data-fatia="${esc(s.status)}"
        style="cursor:${s.valor ? 'pointer' : 'default'}">
      <i style="background:${s.cor}"></i>
      <strong style="color:var(--tinta)">${esc(s.nome)}</strong>
      <span style="font-variant-numeric:tabular-nums">${inteiro(s.valor)}${
        s.foraDoCalculo ? '' : ` (${pctTxt(s.pct)})`}</span>
      ${s.foraDoCalculo ? '<em>não entram no cálculo</em>' : ''}
    </span>`).join('')}
  </div>`;
}

/** As barras por unidade, agrupadas por onda, com o fundo da onda. */
function barrasPorUnidadeHtml(p) {
  const fundo = (o) => (o.n === 1 ? 'color-mix(in srgb, var(--bom) 12%, transparent)'
    : o.n === 2 ? 'color-mix(in srgb, var(--s2) 12%, transparent)'
    : 'color-mix(in srgb, var(--tinta3) 10%, transparent)');
  const corDaOnda = (o) => (o.n === 1 ? 'var(--bom)' : o.n === 2 ? 'var(--s2)' : 'var(--tinta3)');
  return p.porOnda.map((o) => `
    <div class="faixa-onda" style="background:${fundo(o)}">
      <b style="color:${corDaOnda(o)}">${inteiro(o.n)}ª ONDA — ${esc(o.fase.toUpperCase())} ·
        virada em ${esc(mesExib(o.mes))}</b>
      <div class="barras-unidade">
        ${o.unidades.map((u) => `<button type="button" class="barra-unidade"
            data-unidade="${esc(u.k)}"
            aria-label="${esc(`${u.rotulo}: ${pctTxt(u.pctPonderado)} de avanço ponderado, `
              + `${pctTxt(u.pctConclusao)} concluído, ${inteiro(u.concluidas)} de ${inteiro(u.total)} atividades`)}">
          <var style="color:${corDaOnda(o)}">${pctTxt(u.pctPonderado)}</var>
          <span class="pilar" style="background:${corDaOnda(o)};height:${
            Math.max(6, Math.round(u.pctPonderado * 0.62))}px"></span>
          <small>${esc(u.rotulo)}</small>
          <em>${pctTxt(u.pctConclusao)} concluído</em>
        </button>`).join('')}
      </div>
    </div>`).join('');
}

/**
 * O PAINEL, em uma visão só.
 *
 * Os quatro gráficos ficam lado a lado, e não em quatro acordeões: eles são
 * leituras do MESMO universo, e um painel é justamente o lugar onde elas se
 * confrontam de relance. Em caixas separadas, comparar a fatia da rosca com a
 * altura da coluna exigia abrir duas e rolar entre elas — o que desfaz a razão
 * de o painel existir.
 *
 * Cada quadro continua com título e descrição próprios: o que saiu foi a
 * dobra, não a identificação.
 */
function painelSpincareHtml(p, extras = []) {
  const quadroExtra = (x) => `
    <section class="quadro${x.largo ? ' quadro-largo' : ''}" data-quadro="${esc(x.chave)}">
      <header><h3>${esc(x.titulo)}</h3><span>${esc(x.apoio || '')}</span></header>
      <div class="quadro-corpo">${x.corpo}</div>
    </section>`;
  if (!p.todas.length) {
    // Mesmo sem a base do Controle Único, o que existe de tarefas continua
    // aparecendo: esconder tudo faria a caixa parecer quebrada.
    return `<div class="msg alerta"><strong>A base do Controle Único não foi carregada
      para este cliente.</strong> Suba a planilha em
      <strong>Gestão de Projetos › Projeto SpinCare</strong> — ou na tela de
      <strong>Sistema › Dados</strong>, que também a reconhece — e os quatro indicadores
      passam a ler dela.</div>
      ${extras.length ? `<div class="painel-spin">${extras.map(quadroExtra).join('')}</div>` : ''}`;
  }
  const maior = p.porStatus.filter((s) => !s.foraDoCalculo)
    .reduce((m, s) => (s.valor > m.valor ? s : m), { valor: -1 });
  const media = p.unidades.length
    ? pctTxt(p.unidades.reduce((s, u) => s + u.pctPonderado, 0) / p.unidades.length) : '—';
  const quadro = (chave, titulo, apoio, corpo, largo) => `
    <section class="quadro${largo ? ' quadro-largo' : ''}" data-quadro="${esc(chave)}">
      <header><h3>${esc(titulo)}</h3><span>${esc(apoio)}</span></header>
      <div class="quadro-corpo">${corpo}</div>
    </section>`;

  return `
    <div class="painel-spin">
      ${quadro('spin-distribuicao', 'Distribuição das atividades',
        `${inteiro(p.validas.length)} válidas de ${inteiro(p.todas.length)} · maior fatia: `
          + `${maior.nome} com ${pctTxt(maior.pct)}`,
        `<div class="quadro-rosca">
          <div id="spin-rosca"></div>
          ${legendaDaRoscaHtml(p)}
        </div>`)}

      ${quadro('spin-status', 'Atividades por status',
        p.porStatus.filter((s) => !s.foraDoCalculo)
          .map((s) => `${s.nome.toLowerCase()} ${inteiro(s.valor)}`).join(' · '),
        '<div id="spin-colunas"></div>')}

      ${quadro('spin-unidades', 'Percentual por unidade',
        `média ponderada de ${media} em ${inteiro(p.unidades.length)} unidade(s)`,
        `${barrasPorUnidadeHtml(p)}
        <!-- Duas medidas, nomeadas: o ponderado credita avanço parcial e pesa
             pela criticidade; a conclusão é a contagem simples, que é o número
             do Status Report. Mostrar uma chamando-a da outra faria o gestor
             procurar um erro que não existe. -->
        <p class="nota" style="margin-top:var(--esp-4)">Número grande: <strong>avanço ponderado</strong>
          (peso × avanço). Embaixo: <strong>conclusão</strong> — a contagem simples, que é o
          percentual do Status Report.</p>`, true)}

      ${quadro('spin-passos', 'Próximos passos',
        `${inteiro(p.passos.length)} frente(s) em aberto · ${
          inteiro(p.passos.reduce((s, x) => s + x.n, 0))} atividade(s)`,
        !p.passos.length
          ? '<p class="vazio">Nada em aberto no recorte.</p>'
          : `<ul class="lista-passos">${p.passos.map((x, i) => `<li data-passo="${i}"
              role="button" tabindex="0"
              aria-label="${esc(`${x.texto}: ${x.n} atividade(s). Abrir a lista.`)}">
            <span class="pastilha" style="background:${x.cor}"></span>
            <span>${esc(x.texto)}</span>
            <var style="color:${x.cor}">${inteiro(x.n)}</var>
          </li>`).join('')}</ul>`, true)}

      ${extras.map(quadroExtra).join('')}
    </div>

    <p class="nota" style="margin-top:var(--esp-6)">Os percentuais somam <strong>100%</strong> porque
      numerador e denominador saem do mesmo universo. No Status Report de referência eles somam
      <strong>104,24%</strong>: as contagens são feitas sobre todas as linhas e o denominador
      exclui as de criticidade <em>N/A</em>. Clique em qualquer número para ver as atividades
      que o compõem.</p>`;
}

/** Desenha os gráficos e liga os cliques do painel. */
function ligarPainelSpincare(p) {
  if (!p.todas.length) return;
  const alvoRosca = el('#spin-rosca');
  if (alvoRosca) {
    rosca(alvoRosca, p.porStatus.filter((s) => !s.foraDoCalculo), {
      fmt: inteiro, total: p.validas.length,
      legendaCentro: 'ATIVIDADES\nVÁLIDAS',
      rotulo: 'distribuição das atividades por situação',
      aoClicar: (f) => abrirAtividadesSpin(`${f.nome} — ${inteiro(f.valor)} atividade(s)`,
        p.porStatus.find((s) => s.status === f.status).itens),
    });
  }
  const alvoColunas = el('#spin-colunas');
  if (alvoColunas) {
    barras(alvoColunas,
      p.porStatus.map((s) => ({ rot: s.nome, status: s.status, v: { n: s.valor } })),
      [{ k: 'n', nome: 'Atividades', cor: 'var(--s1)' }],
      'lado', inteiro, inteiro,
      (ponto) => {
        const s = p.porStatus.find((x) => x.status === ponto.status);
        abrirAtividadesSpin(`${s.nome} — ${inteiro(s.valor)} atividade(s)`, s.itens);
      });
    // Cada coluna na cor do seu status: uma paleta só faria o gráfico dizer
    // menos que a rosca ao lado, que já separa as situações por cor.
    alvoColunas.querySelectorAll('svg g path[fill]').forEach((caminho, i) => {
      const s = p.porStatus[i];
      if (s) caminho.setAttribute('fill', s.cor);
    });
  }
  el('#pagina').querySelectorAll('[data-fatia]').forEach((sp) => {
    const s = p.porStatus.find((x) => x.status === sp.dataset.fatia);
    if (!s || !s.valor) return;
    sp.addEventListener('click', (ev) => {
      ev.stopPropagation();
      abrirAtividadesSpin(`${s.nome} — ${inteiro(s.valor)} atividade(s)`, s.itens);
    });
  });
  el('#pagina').querySelectorAll('[data-unidade]').forEach((bt) => {
    const u = p.unidades.find((x) => x.k === bt.dataset.unidade);
    if (!u) return;
    // `stopPropagation` porque o botão mora dentro do cartão, que é gatilho de
    // drill-down: sem barrar, o clique abriria duas telas empilhadas.
    bt.addEventListener('click', (ev) => {
      ev.stopPropagation();
      abrirAtividadesSpin(`${u.rotulo} — ${inteiro(u.total)} atividade(s)`, u.itens,
        `${inteiro(u.concluidas)} concluída(s) de ${inteiro(u.total)} (${pctTxt(u.pctConclusao)}), `
        + `com ${pctTxt(u.pctPonderado)} de avanço ponderado.`);
    });
    ligarDica(bt, () => ({ titulo: u.rotulo, linhas: [
      { nome: 'Onda', valor: `${inteiro(u.onda)}ª — ${(SPIN_ONDAS[u.onda - 1] || {}).fase || ''}` },
      { nome: 'Avanço ponderado', valor: pctTxt(u.pctPonderado) },
      { nome: 'Conclusão', valor: `${pctTxt(u.pctConclusao)} (${inteiro(u.concluidas)} de ${inteiro(u.total)})` },
    ] }));
  });
  el('#pagina').querySelectorAll('[data-passo]').forEach((li) => {
    const x = p.passos[Number(li.dataset.passo)];
    if (!x) return;
    const abrir = (ev) => {
      ev.stopPropagation();
      abrirAtividadesSpin(`${x.texto} — ${inteiro(x.n)} atividade(s)`, x.itens);
    };
    li.addEventListener('click', abrir);
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(ev); }
    });
  });
}

// ===================================================================== //
// O CRONOGRAMA ANUAL DAS VIRADAS — a visão MACRO.
//
// A pergunta é uma só: a unidade planejada para virar no mês VIROU? Tarefa
// pendente não muda essa resposta — é informação de apoio, e confundir as
// duas foi o que motivou separar macro de micro.
// ===================================================================== //

/**
 * O estado de cada unidade do cronograma.
 *
 * Três estados, e o terceiro é o que evita a mentira mais fácil:
 *
 *   CUMPRIDO   a virada aconteceu (todas as atividades da unidade concluídas)
 *   NÃO CUMPRIDO  o mês da virada passou e ela não aconteceu
 *   PENDENTE   ainda não chegou o mês, ou a planilha nem acompanha a unidade
 *
 * Uma unidade sem coluna na planilha NÃO é "não iniciada": a planilha não diz
 * que ela não começou, ela ainda não pergunta. Pintá-la de vermelho afirmaria
 * um atraso que ninguém mediu.
 */
function calcularCronograma(hoje) {
  const mesAtual = (hoje || mesHoje());
  const atividades = spinAtividades();
  const ondas = SPIN_ONDAS.map((o) => {
    const unidades = o.unidades.map((nome, i) => {
      const chave = o.chaves[i] || null;
      const acompanhadas = chave ? atividades.filter((a) => (a.unidades || {})[chave]) : [];
      const validas = acompanhadas.filter((a) => a.avanco !== null);
      const concluidas = validas.filter((a) => a.unidades[chave] === 'Concluído');
      const pendentes = validas.filter((a) => a.unidades[chave] !== 'Concluído');
      const virou = validas.length > 0 && pendentes.length === 0;
      const passou = o.mes < mesAtual;
      return {
        nome, chave, onda: o.n,
        acompanhada: !!chave && validas.length > 0,
        total: validas.length, concluidas: concluidas.length, pendentes,
        pct: pct(concluidas.length, validas.length),
        virou,
        // Sem coluna na planilha o estado é PENDENTE, mesmo com o mês vencido.
        estado: !chave || !validas.length ? 'PENDENTE'
          : virou ? 'CUMPRIDO' : (passou ? 'NÃO CUMPRIDO' : 'PENDENTE'),
        dataPlanejada: o.virada,
        // A data realizada só existe quando a virada aconteceu, e é a do mês
        // planejado: a planilha não guarda a data efetiva da virada.
        dataRealizada: virou ? o.virada : null,
      };
    });
    const acompanhadas = unidades.filter((u) => u.acompanhada);
    const viradas = acompanhadas.filter((u) => u.virou);
    return {
      ...o, unidades, acompanhadas: acompanhadas.length, viradas: viradas.length,
      // A aderência do mês: realizadas ÷ planejadas. Sem unidade acompanhada
      // ela é nula, e não zero — zero afirmaria um fracasso não medido.
      aderencia: acompanhadas.length ? pct(viradas.length, acompanhadas.length) : null,
      estado: !acompanhadas.length ? 'PENDENTE'
        : viradas.length === acompanhadas.length ? 'CUMPRIDO'
        : (o.mes < mesAtual ? 'NÃO CUMPRIDO' : 'PENDENTE'),
    };
  });
  return { ondas, mesAtual,
    pacientes: SPIN_ONDAS.reduce((s, o) => s + o.pacientes, 0),
    filiais: SPIN_ONDAS.reduce((s, o) => s + o.unidades.length, 0),
    acompanhadas: ondas.reduce((s, o) => s + o.acompanhadas, 0) };
}

const SPIN_CORES_ESTADO = { CUMPRIDO: 'var(--bomtxt)', 'NÃO CUMPRIDO': 'var(--crit)',
  PENDENTE: 'var(--tinta3)' };
const SPIN_SIMBOLO_ESTADO = { CUMPRIDO: '✓', 'NÃO CUMPRIDO': '✗', PENDENTE: '·' };

/** O cronograma: fases, unidades e o estado de cada virada. */
function cronogramaHtml(c) {
  const selo = (estado) => `<span class="tag" style="color:${SPIN_CORES_ESTADO[estado]};
    border-color:${SPIN_CORES_ESTADO[estado]}">${SPIN_SIMBOLO_ESTADO[estado]} ${esc(estado)}</span>`;
  return `
    <div class="cards-plano" style="margin-top:0">
      <div class="card-plano forte"><span class="card-rot">Total de pacientes</span>
        <strong>${inteiro(c.pacientes)}</strong>
        <span class="card-apoio">nas ${inteiro(c.filiais)} filiais do cronograma</span></div>
      <div class="card-plano"><span class="card-rot">Filiais a migrar</span>
        <strong>${inteiro(c.filiais)}</strong>
        <span class="card-apoio">em ${inteiro(c.ondas.length)} fases</span></div>
      <div class="card-plano"><span class="card-rot">Acompanhadas na planilha</span>
        <strong>${inteiro(c.acompanhadas)}</strong>
        <span class="card-apoio">as demais entram quando a planilha as incluir</span></div>
    </div>

    <div class="rol" style="margin-top:var(--esp-7)"><table class="cronograma">
      <thead><tr><th>Fase</th><th>Período</th><th>Unidades a migrar</th>
        <th class="n">Pacientes</th><th class="n">Aderência</th><th>Prazo macro</th></tr></thead>
      <tbody>${c.ondas.map((o) => `
        <tr class="fase-linha" data-fase="${inteiro(o.n)}">
          <td><button type="button" class="arv-abrir" aria-expanded="false"
              aria-label="Abrir as unidades da fase ${esc(o.fase)}">+</button>
            <strong>${inteiro(o.n)} · ${esc(o.fase)}</strong></td>
          <td>${esc(o.periodo)}<div class="arv-comp">virada em ${esc(mesExib(o.mes))}</div></td>
          <td>${o.unidades.map((u) => `<span class="tag" style="color:${
            SPIN_CORES_ESTADO[u.estado]};border-color:${SPIN_CORES_ESTADO[u.estado]}">${
            esc(u.nome)}</span>`).join(' ')}</td>
          <td class="n">${inteiro(o.pacientes)}</td>
          <td class="n">${o.aderencia === null ? '<span class="vazio2">sem medição</span>'
            : `<strong style="color:${SPIN_CORES_ESTADO[o.estado]}">${pctTxt(o.aderencia)}</strong>
               <div class="arv-comp">${inteiro(o.viradas)} de ${inteiro(o.acompanhadas)}</div>`}</td>
          <td>${selo(o.estado)}</td>
        </tr>
        ${o.unidades.map((u) => `
        <tr class="unidade-linha" data-da-fase="${inteiro(o.n)}" hidden${
            u.chave ? ` data-unidade-crono="${esc(u.chave)}"` : ''}>
          <td style="padding-left:34px">${esc(u.nome)}</td>
          <td><div class="arv-comp">planejada ${esc(diaExib(u.dataPlanejada))}</div>
            <div class="arv-comp">realizada ${u.dataRealizada ? esc(diaExib(u.dataRealizada))
              : '<span class="vazio2">—</span>'}</div></td>
          <td>${!u.acompanhada
            ? '<span class="vazio2">sem coluna na planilha ainda</span>'
            : `${inteiro(u.concluidas)} de ${inteiro(u.total)} atividade(s) concluída(s)
               ${u.pendentes.length ? `<div class="arv-comp" style="color:var(--alerta)">${
                 inteiro(u.pendentes.length)} pendente(s) — informativas, não mudam o prazo macro</div>`
                 : ''}`}</td>
          <td class="n">—</td>
          <td class="n">${u.acompanhada ? pctTxt(u.pct) : '—'}</td>
          <td>${selo(u.estado)}</td>
        </tr>`).join('')}`).join('')}
      </tbody></table></div>

    <p class="nota" style="margin-top:var(--esp-5)"><strong>Tarefa pendente não muda o prazo macro.</strong>
      O que ele mede é a unidade ter virado ou não no mês planejado; as pendências aparecem ao lado
      porque dizem o que falta, não porque reprovam a virada. Unidade <strong>sem coluna na
      planilha</strong> fica <em>pendente</em>, e não em atraso — a planilha não diz que ela não
      começou, ela ainda não pergunta.</p>`;
}

/** DD/MM/AAAA a partir do ISO. */
const diaExib = (iso) => (String(iso || '').length === 10
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/** Abre e fecha as fases, e liga o detalhamento de cada unidade. */
function ligarCronograma(c) {
  el('#pagina').querySelectorAll('.fase-linha').forEach((tr) => {
    const bt = tr.querySelector('.arv-abrir');
    const filhas = [...el('#pagina').querySelectorAll(
      `[data-da-fase="${tr.dataset.fase}"]`)];
    bt.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const aberto = bt.getAttribute('aria-expanded') === 'true';
      bt.setAttribute('aria-expanded', String(!aberto));
      bt.textContent = aberto ? '+' : '−';
      for (const f of filhas) f.hidden = aberto;
    });
  });
  el('#pagina').querySelectorAll('[data-unidade-crono]').forEach((tr) => {
    const chave = tr.dataset.unidadeCrono;
    const unidade = c.ondas.flatMap((o) => o.unidades).find((u) => u.chave === chave);
    if (!unidade || !unidade.acompanhada) return;
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const itens = spinAtividades().filter((a) => (a.unidades || {})[chave]);
      abrirAtividadesSpin(`${unidade.nome} — virada da ${unidade.onda}ª onda`, itens,
        `${inteiro(unidade.concluidas)} de ${inteiro(unidade.total)} concluída(s). `
        + `Prazo macro: ${unidade.estado}.`);
    });
    ligarDica(tr, () => ({ titulo: unidade.nome, linhas: [
      { nome: 'Fase', valor: `${unidade.onda}ª — ${(SPIN_ONDAS[unidade.onda - 1] || {}).fase || ''}` },
      { nome: 'Data planejada', valor: diaExib(unidade.dataPlanejada) },
      { nome: 'Data realizada', valor: unidade.dataRealizada ? diaExib(unidade.dataRealizada) : '—' },
      { nome: 'Prazo macro', valor: unidade.estado, cor: SPIN_CORES_ESTADO[unidade.estado] },
      { nome: 'Pendentes', valor: `${inteiro(unidade.pendentes.length)} atividade(s)` },
    ] }));
  });
}

// ===================================================================== //
// A LISTAGEM FIEL — a planilha inteira dentro do sistema (Entregável 2).
// ===================================================================== //

/** Os cortes da tela, guardados na sessão. Vazio = tudo. */
function filtroSpin() {
  if (!E.spinFiltro) {
    E.spinFiltro = { fonte: '', grupoTime: '', frente: '', tipoEntrega: '', executante: '',
      criticidade: '', statusConsolidado: '', farol: '', onda: '', unidade: '', busca: '' };
  }
  return E.spinFiltro;
}

/**
 * A ordem padrão: VERMELHO primeiro, e dentro dele o mais atrasado no topo.
 *
 * Ordenar por ID devolveria a ordem da planilha, que não responde pergunta
 * nenhuma. A lista existe para dizer o que fazer primeiro.
 */
const ORDEM_FAROL = { VERMELHO: 0, AMARELO: 1, VERDE: 2, 'N/A': 3 };
function ordenarAtividades(lista) {
  return [...lista].sort((a, b) =>
    (ORDEM_FAROL[a.farol] ?? 9) - (ORDEM_FAROL[b.farol] ?? 9)
    || (a.diasParaPrazo === null ? 1 : b.diasParaPrazo === null ? -1 : a.diasParaPrazo - b.diasParaPrazo)
    || String(a.id).localeCompare(String(b.id), 'pt-BR'));
}

/** As atividades que passam pelos cortes da tela. */
function atividadesFiltradas() {
  const f = filtroSpin();
  const busca = spinChaveNome(f.busca);
  return ordenarAtividades(spinAtividades().filter((a) => {
    const igual = (campo, valor) => !valor || String(a[campo] || '') === valor;
    if (!igual('fonte', f.fonte) || !igual('grupoTime', f.grupoTime)
      || !igual('frente', f.frente) || !igual('tipoEntrega', f.tipoEntrega)
      || !igual('criticidade', f.criticidade) || !igual('statusConsolidado', f.statusConsolidado)
      || !igual('farol', f.farol)) return false;
    if (f.executante && !a.executantes.includes(f.executante)) return false;
    if (f.unidade && !(a.unidades || {})[f.unidade]) return false;
    if (f.onda && !Object.keys(a.unidades || {}).some((k) =>
      String((SPIN_UNIDADE_POR_CHAVE[k] || {}).onda) === f.onda)) return false;
    if (busca && !spinChaveNome(`${a.id} ${a.atividade} ${a.caminho || ''} `
      + `${a.grupoTime || ''} ${a.executantes.join(' ')}`).includes(busca)) return false;
    return true;
  }));
}

/** Uma etiqueta de situação, na cor dela. */
const selaSituacao = (s) => (!s ? '<span class="vazio2">—</span>'
  : `<span class="tag" style="color:${(SPIN_SITUACOES[s] || {}).cor || 'var(--tinta2)'};border-color:${
    (SPIN_SITUACOES[s] || {}).cor || 'var(--linha2)'}">${esc(s)}</span>`);

/** As ondas que a base usa — só elas ganham colunas na grade. */
const ondasUsadas = (lista) => [...new Set(lista.flatMap((a) =>
  Object.keys(a.ondas || {})))].sort((x, y) => Number(x) - Number(y));

/** A grade com a planilha inteira: identificação, ondas, unidades e cálculos. */
function gradeSpincareHtml(lista) {
  if (!lista.length) return '<p class="vazio">Nenhuma atividade neste recorte.</p>';
  const ondas = ondasUsadas(lista);
  const unidades = SPIN_UNIDADES.filter((u) =>
    lista.some((a) => (a.unidades || {})[u.k]));
  return `<div class="rol rol-fixo grade-spin"><table class="pivot">
    <thead><tr>
      <th>ID</th><th>Atividade</th><th>Fonte</th><th>Grupo / Time</th><th>Frente</th>
      <th>Tipo de entrega</th><th>Criticidade</th><th>Líder</th><th>Executante</th>
      ${ondas.map((o) => `<th class="n">Prazo O${esc(o)}</th><th>Situação O${esc(o)}</th>`).join('')}
      <th class="n">Prazo repactuado</th>
      ${unidades.map((u) => `<th>${esc(u.rotulo)}</th>`).join('')}
      <th>Status consolidado</th><th class="n">Avanço</th><th class="n">Peso</th>
      <th class="n">Ponderado</th><th>Farol</th><th class="n">Dias p/ prazo</th>
      <th>Pendência / bloqueio</th><th>Próxima ação</th><th>Evidência</th><th>Observações</th>
    </tr></thead>
    <tbody>${lista.map((a) => `<tr data-atividade="${esc(a.chave || a.id)}" style="cursor:pointer">
      <th><code>${esc(a.id)}</code></th>
      <td class="texto"><strong>${esc(a.atividade)}</strong></td>
      <td>${esc(a.fonte || '—')}</td><td>${esc(a.grupoTime || '—')}</td>
      <td>${esc(a.frente || '—')}</td><td>${esc(a.tipoEntrega || '—')}</td>
      <td>${esc(a.criticidade || '—')}</td><td>${esc(a.lider || '—')}</td>
      <td>${a.executantes.length ? esc(a.executantes.join(', '))
        : '<span class="vazio2">sem responsável</span>'}</td>
      ${ondas.map((o) => {
        const od = (a.ondas || {})[o] || {};
        return `<td class="n">${od.prazo ? esc(diaExib(od.prazo)) : '—'}</td>
          <td>${od.situacao ? esc(od.situacao) : '—'}</td>`;
      }).join('')}
      <td class="n">${a.prazoRepactuado ? esc(diaExib(a.prazoRepactuado)) : '—'}</td>
      ${unidades.map((u) => `<td>${selaSituacao((a.unidades || {})[u.k])}</td>`).join('')}
      <td>${selaSituacao(a.statusConsolidado)}</td>
      <td class="n">${a.avanco === null ? '—' : pctTxt(a.avanco * 100)}</td>
      <td class="n">${a.peso === null ? '—' : inteiro(a.peso)}</td>
      <td class="n">${a.avancoPonderado === null ? '—' : a.avancoPonderado.toLocaleString('pt-BR')}</td>
      <td><span class="tag" style="color:${SPIN_CORES_FAROL[a.farol]};border-color:${
        SPIN_CORES_FAROL[a.farol]}">${esc(a.farol)}</span></td>
      <!-- Negativo é VENCIDO, e o sinal sozinho não diz isso a quem chega na
           tela pela primeira vez: a palavra vai junto do número. -->
      <td class="n"${a.diasParaPrazo === null ? '' : ` style="color:${
        a.diasParaPrazo < 0 ? 'var(--crit)' : 'var(--tinta2)'}"`}>${
        a.diasParaPrazo === null ? '—'
          : `${inteiro(Math.abs(a.diasParaPrazo))} ${a.diasParaPrazo < 0 ? 'vencido' : 'restante'}`}</td>
      <td class="texto">${a.pendencia ? esc(a.pendencia) : '—'}</td>
      <td class="texto">${a.proximaAcao ? esc(a.proximaAcao) : '—'}</td>
      <td class="texto">${a.evidencia ? esc(a.evidencia) : '—'}</td>
      <td class="texto">${a.observacoes ? esc(a.observacoes) : '—'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/** Um seletor de corte, montado das opções que existem na base. */
function corteSpinHtml(campo, rotulo, opcoes) {
  const f = filtroSpin();
  return `<div class="campo" style="min-width:150px">
    <label for="sf-${campo}">${esc(rotulo)}</label>
    <select id="sf-${campo}" data-corte="${campo}">
      <option value="">Todos</option>
      ${opcoes.map((o) => {
        const valor = typeof o === 'string' ? o : o.valor;
        const nome = typeof o === 'string' ? o : o.rotulo;
        return `<option value="${esc(valor)}"${f[campo] === valor ? ' selected' : ''}>${esc(nome)}</option>`;
      }).join('')}
    </select></div>`;
}

/**
 * A ficha de uma atividade: TODOS os campos, inclusive os que a grade corta.
 *
 * Critério de aceite e caminho no sistema são textos longos que a grade não
 * comporta, e são justamente o que quem vai executar precisa ler.
 */
function abrirAtividadeSpin(chave) {
  const a = spinAtividades().find((x) => (x.chave || x.id) === chave);
  if (!a) return;
  const linha = (rot, valor, cor) => `<dt>${esc(rot)}</dt><dd${cor ? ` style="color:${cor}"` : ''}>${
    valor || '<span class="vazio2">—</span>'}</dd>`;
  const unidades = SPIN_UNIDADES.filter((u) => (a.unidades || {})[u.k]);
  abrirModal({
    titulo: `${a.id} — ${a.atividade}`,
    larguraPadrao: 780,
    corpo: `
      <dl class="ficha">
        ${linha('Fonte', esc(a.fonte || ''))}
        ${linha('Grupo / Time', esc(a.grupoTime || ''))}
        ${linha('Frente', esc(a.frente || ''))}
        ${linha('Tipo de entrega', esc(a.tipoEntrega || ''))}
        ${linha('Criticidade', esc(a.criticidade || ''))}
        ${linha('Passível de replicação', esc(a.replicavel || ''))}
        ${linha('Líder do grupo', esc(a.lider || ''))}
        ${linha('Executante', a.executantes.length ? esc(a.executantes.join(', ')) : '')}
        ${linha('Critério de aceite', esc(a.criterioAceite))}
        ${linha('Caminho no sistema', a.caminho ? `<code>${esc(a.caminho)}</code>` : '')}
        ${linha('Data-base da onda', a.dataBaseOnda ? esc(diaExib(a.dataBaseOnda)) : '')}
        ${linha('Prazo repactuado', a.prazoRepactuado ? esc(diaExib(a.prazoRepactuado)) : '')}
        ${linha('Status consolidado', selaSituacao(a.statusConsolidado))}
        ${linha('Avanço', a.avanco === null ? '' : pctTxt(a.avanco * 100))}
        ${linha('Peso', a.peso === null ? '' : inteiro(a.peso))}
        ${linha('Avanço ponderado', a.avancoPonderado === null ? ''
          : a.avancoPonderado.toLocaleString('pt-BR'))}
        ${linha('Farol', `<span class="tag" style="color:${SPIN_CORES_FAROL[a.farol]};border-color:${
          SPIN_CORES_FAROL[a.farol]}">${esc(a.farol)}</span>`)}
        ${linha('Dias para o prazo', a.diasParaPrazo === null ? ''
          : `${inteiro(Math.abs(a.diasParaPrazo))} ${a.diasParaPrazo < 0 ? 'vencido(s)' : 'restante(s)'}`,
          a.diasParaPrazo !== null && a.diasParaPrazo < 0 ? 'var(--crit)' : null)}
        ${linha('Status igual em todas', esc(a.statusIgualEmTodas || ''))}
        ${linha('Pendência / bloqueio', esc(a.pendencia || ''))}
        ${linha('Próxima ação', esc(a.proximaAcao || ''))}
        ${linha('Evidência', esc(a.evidencia || ''))}
        ${linha('Observações', esc(a.observacoes || ''))}
      </dl>

      <h3 class="titulo-mini">Situação por unidade</h3>
      ${!unidades.length ? '<p class="vazio">Nenhuma unidade acompanha esta atividade.</p>' : `
      <div class="rol"><table>
        <thead><tr><th>Unidade</th><th>Onda</th><th>Situação</th></tr></thead>
        <tbody>${unidades.map((u) => `<tr>
          <td>${esc(u.rotulo)}</td><td>${u.onda ? `${inteiro(u.onda)}ª` : '—'}</td>
          <td><select data-sit="${esc(u.k)}">
            ${SPIN_SITUACOES_LISTA.map((sit) => `<option${
              a.unidades[u.k] === sit ? ' selected' : ''}>${esc(sit)}</option>`).join('')}
          </select></td></tr>`).join('')}</tbody></table></div>`}

      <h3 class="titulo-mini">Acompanhamento</h3>
      <div class="campo"><label for="sa-pend">Pendência / bloqueio</label>
        <textarea id="sa-pend">${esc(a.pendencia || '')}</textarea></div>
      <div class="campo"><label for="sa-acao">Próxima ação</label>
        <textarea id="sa-acao">${esc(a.proximaAcao || '')}</textarea></div>
      <div class="campo"><label for="sa-evid">Evidência</label>
        <input id="sa-evid" value="${esc(a.evidencia || '')}"></div>
      <div class="msg" data-erro hidden></div>`,
    acoes: '<button type="button" class="bt" data-c>Fechar</button>'
      + '<button type="button" class="bt pri" data-g>Salvar</button>',
    aoMontar({ raiz, fechar }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      const erro = raiz.querySelector('[data-erro]');
      raiz.querySelector('[data-g]').onclick = async (ev) => {
        ev.target.disabled = true;
        erro.hidden = true;
        try {
          const unidadesNovas = { ...(a.unidades || {}) };
          for (const sel of raiz.querySelectorAll('[data-sit]')) {
            unidadesNovas[sel.dataset.sit] = sel.value;
          }
          const patch = {
            unidades: unidadesNovas,
            pendencia: raiz.querySelector('#sa-pend').value.trim(),
            proximaAcao: raiz.querySelector('#sa-acao').value.trim(),
            evidencia: raiz.querySelector('#sa-evid').value.trim(),
          };
          await salvarAtividadeSpin(a, patch);
          fechar();
          await render();
        } catch (e) {
          erro.hidden = false;
          erro.className = 'msg erro';
          erro.textContent = e && e.message ? e.message : String(e);
          ev.target.disabled = false;
        }
      };
    },
  });
}

/**
 * Grava a alteração e registra QUEM, QUANDO e o que mudou.
 *
 * A trilha guarda o de-para campo a campo: "editou a atividade PRE-8" não
 * responde à pergunta que alguém vai fazer daqui a três meses, que é o que
 * mudou e a partir de qual valor.
 */
async function salvarAtividadeSpin(antes, patch) {
  const chave = antes.chave || antes.id;
  const base = E.spincare || [];
  const i = base.findIndex((x) => (x.chave || x.id) === chave && x.cliente === E.clienteSel);
  if (i < 0) throw new Error('A atividade não foi encontrada na base. Recarregue a tela e tente de novo.');

  const mudancas = [];
  for (const [campo, valor] of Object.entries(patch)) {
    if (campo === 'unidades') {
      for (const [u, novo] of Object.entries(valor)) {
        const velho = (antes.unidades || {})[u];
        if (velho !== novo) {
          mudancas.push(`${(SPIN_UNIDADE_POR_CHAVE[u] || {}).rotulo || u}: ${velho || '—'} → ${novo}`);
        }
      }
    } else if (String(antes[campo] || '') !== String(valor || '')) {
      mudancas.push(`${campo}: "${antes[campo] || ''}" → "${valor || ''}"`);
    }
  }
  // Sem mudança não há o que gravar: uma trilha com uma linha por abertura de
  // tela afogaria as alterações de verdade.
  if (!mudancas.length) return { alterou: false };

  const novo = { ...base[i], ...patch };
  for (const campo of ['pendencia', 'proximaAcao', 'evidencia']) {
    if (!novo[campo]) delete novo[campo];
  }
  const lista = [...base];
  lista[i] = novo;
  await Loja.gravarCatalogo('spincare', lista);
  await Loja.auditar({ entidade: 'spincare', acao: 'atualizar', id: chave,
    descricao: `${antes.id}: ${mudancas.join(' · ')}` });
  return { alterou: true, mudancas };
}

/** A listagem com os cortes, a grade e a contagem do recorte. */
function listagemSpincareHtml() {
  const todas = spinAtividades();
  const lista = atividadesFiltradas();
  const f = filtroSpin();
  const distintos = (extrair) => [...new Set(todas.flatMap(extrair).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  const algumCorte = Object.values(f).some(Boolean);
  return `
    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:var(--esp-8)">
      <header><h2>Atividades do Controle Único</h2>
        <span class="nota">${inteiro(lista.length)} de ${inteiro(todas.length)} atividade(s)${
          algumCorte ? ' — com corte aplicado' : ''}</span></header>

      <div class="filtros" style="box-shadow:none;border:0;padding:0;margin-bottom:var(--esp-6)">
        <div class="campo" style="min-width:210px"><label for="sf-busca">Buscar</label>
          <input id="sf-busca" value="${esc(f.busca)}"
            placeholder="ID, atividade, caminho, executante"></div>
        ${corteSpinHtml('fonte', 'Fonte', distintos((a) => [a.fonte]))}
        ${corteSpinHtml('grupoTime', 'Grupo / Time', distintos((a) => [a.grupoTime]))}
        ${corteSpinHtml('frente', 'Frente', distintos((a) => [a.frente]))}
        ${corteSpinHtml('tipoEntrega', 'Tipo de entrega', distintos((a) => [a.tipoEntrega]))}
        ${corteSpinHtml('executante', 'Executante', distintos((a) => a.executantes))}
        ${corteSpinHtml('criticidade', 'Criticidade', distintos((a) => [a.criticidade]))}
        ${corteSpinHtml('statusConsolidado', 'Status', distintos((a) => [a.statusConsolidado]))}
        ${corteSpinHtml('farol', 'Farol', distintos((a) => [a.farol]))}
        ${corteSpinHtml('onda', 'Onda', SPIN_ONDAS.filter((o) => o.chaves.length)
          .map((o) => ({ valor: String(o.n), rotulo: `${o.n}ª — ${o.fase}` })))}
        ${corteSpinHtml('unidade', 'Unidade', SPIN_UNIDADES.filter((u) =>
          todas.some((a) => (a.unidades || {})[u.k])).map((u) => ({ valor: u.k, rotulo: u.rotulo })))}
        <button class="bt fant" id="sf-limpar">Limpar filtros</button>
      </div>

      <!-- A ordem padrão é VERMELHO primeiro e, dentro dele, o mais atrasado
           no topo: ordenar por ID devolveria a ordem da planilha, que não
           responde pergunta nenhuma. A lista existe para dizer o que fazer
           primeiro. -->
      <p class="nota" style="margin-bottom:var(--esp-4)">Ordenadas por <strong>farol</strong> (vermelho
        primeiro) e depois pelo <strong>atraso</strong>. Clique na linha para abrir a ficha
        completa e editar situação por unidade, pendência, próxima ação e evidência.</p>
      ${gradeSpincareHtml(lista)}
    </section>`;
}

/** Liga os cortes e o clique da linha. */
function ligarListagemSpincare() {
  const f = filtroSpin();
  el('#pagina').querySelectorAll('[data-corte]').forEach((sel) => {
    sel.addEventListener('change', () => { f[sel.dataset.corte] = sel.value; render(); });
  });
  const busca = el('#sf-busca');
  if (busca) {
    // `change`, e não `input`: repintar a cada tecla perderia o foco do campo
    // no meio da digitação.
    busca.addEventListener('change', () => { f.busca = busca.value.trim(); render(); });
  }
  const limpar = el('#sf-limpar');
  if (limpar) limpar.addEventListener('click', () => { E.spinFiltro = null; render(); });
  el('#pagina').querySelectorAll('[data-atividade]').forEach((tr) => {
    tr.addEventListener('click', () => abrirAtividadeSpin(tr.dataset.atividade));
  });
}
