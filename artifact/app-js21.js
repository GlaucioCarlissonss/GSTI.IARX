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

    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:16px">
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
      <div id="spin-resultado" style="margin-top:14px">${
        E.spincareRelatorio ? relatorioSpincareHtml(E.spincareRelatorio) : ''}</div>
    </section>

    ${!d ? `<section class="bloco" style="margin-top:16px">
        <header><h2>Diagnóstico da base</h2></header>
        <p class="vazio">Nenhuma atividade carregada ainda. Suba a planilha acima para ver o
          que entrou e o que ficou faltando.</p>
      </section>` : diagnosticoSpincareHtml(d)}`;

  const arq = el('#spin-arq');
  const bt = el('#spin-carregar');
  arq.addEventListener('change', () => { bt.disabled = !arq.files.length; });
  bt.addEventListener('click', () => carregarSpincare(arq, bt));
  const limpar = el('#spin-limpar');
  if (limpar) limpar.addEventListener('click', () => removerBaseSpincare());
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
    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:16px">
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
      <div class="msg" style="margin-top:14px">
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

/** Lê o arquivo escolhido, mostra o resultado e grava. */
async function carregarSpincare(campo, botao) {
  const alvo = el('#spin-resultado');
  const arquivo = campo.files && campo.files[0];
  if (!arquivo) return;
  botao.disabled = true;
  alvo.innerHTML = '<p class="msg">Lendo a planilha…</p>';
  try {
    const abas = await gradeDoXlsx(new Uint8Array(await arquivo.arrayBuffer()));
    const mestre = abas.find((a) => spinChaveNome(a.nome) === spinChaveNome('Controle Mestre'));
    if (!mestre) {
      throw new Error('O arquivo não tem a aba "Controle Mestre". '
        + `Abas encontradas: ${abas.map((a) => a.nome).join(', ') || 'nenhuma'}.`);
    }
    const lido = spinLerControleMestre(mestre.grade, E.clienteSel);
    if (!lido.atividades.length) {
      throw new Error('A aba "Controle Mestre" não trouxe nenhuma atividade com ID. '
        + 'Confira se o cabeçalho está na linha 2 e se a coluna A tem os IDs.');
    }
    // As atividades de OUTROS clientes ficam: a base é uma só, e cada item
    // carrega o dono — é a mesma convenção de metas e do plano de redução.
    const outras = (E.spincare || []).filter((a) => a.cliente !== E.clienteSel);
    await Loja.gravarCatalogo('spincare', [...outras, ...lido.atividades]);
    const quando = new Date().toLocaleString('pt-BR');
    await Loja.gravarConfiguracao({ spincareCarga: {
      quando, total: lido.atividades.length, arquivo: arquivo.name, cliente: E.clienteSel } });
    await Loja.auditar({ entidade: 'spincare', acao: 'importar',
      descricao: `${lido.atividades.length} atividade(s) do Controle Único, de ${arquivo.name}` });
    E.spincareRelatorio = lido;
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
    <div class="msg ${classe}" style="margin-top:10px"><strong>${esc(titulo)}</strong>
      <ul style="margin:6px 0 0;padding-left:20px">
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
      <div class="msg" style="margin-top:10px"><strong>Grafias normalizadas.</strong>
        A mesma pessoa aparecia escrita de formas diferentes; a grafia que vale é a do cadastro de
        líderes. O nome original continua no arquivo — o que mudou foi só como o sistema agrupa.
        <ul style="margin:6px 0 0;padding-left:20px">
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
