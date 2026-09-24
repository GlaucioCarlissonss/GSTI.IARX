// ===========================================================================
// Indicadores Gerais — a leitura estratégica, separada da operação
// ===========================================================================
/**
 * Três blocos independentes, dois indicadores cada. Independentes de propósito:
 * cada bloco tem os PRÓPRIOS filtros, e mexer no período do financeiro não faz
 * o SLA recarregar. Os filtros também não atravessam para as demais telas —
 * quem vem conferir um número aqui não quer encontrar o sistema inteiro
 * recortado depois.
 *
 * Por isso o recorte vive em `E.filtrosInd`, que é memória de sessão: não vai
 * para o `localStorage` nem toca em `E.competencias`, que é o filtro global.
 */
/**
 * A ordem é a da leitura de diretoria: o dinheiro primeiro, depois o que se
 * entregou, por último o atendimento. A lista manda na fiação dos filtros; a
 * ordem visual dos blocos está no template de `viewIndicadores` e segue esta.
 */
const BLOCOS_IND = ['financeiro', 'projetos', 'sla'];

/**
 * Meta de conformidade de SLA quando o cliente não cadastrou nenhuma.
 *
 * Deriva de `ALVO_PADRAO` em vez de repetir o número: o 80 tem um dono só, e
 * quem quiser outro alvo cadastra a meta em vez de editar código.
 */
const META_SLA = ALVO_PADRAO.sla;

/**
 * A competência que decide QUAL meta vale para este recorte.
 *
 * É a ponta mais recente da janela: uma meta que passou a valer em março não
 * pode reger a leitura de janeiro.
 */
const mesDoRecorte = (r) => (r && (r.ate || r.de)) || mesHoje();

/**
 * Meta vs Resultado — o alvo ao lado do número, dentro do card.
 *
 * É a mesma leitura do termômetro, no tamanho de um KPI: a barra preenche o
 * resultado e o traço marca o alvo. Sem meta cadastrada não desenha nada — o
 * card continua mostrando o resultado, que é o que ele sempre mostrou.
 *
 * Sem resultado (nenhum atendimento, nenhuma entrega) a barra não aparece: uma
 * barra vazia diria "0%", que é diferente de "não houve".
 */
function metaHtml(leitura) {
  if (!leitura) return '';
  const comparador = leitura.direcao === 'minimo' ? 'mínimo' : 'teto';

  // Recorte que atravessa vigências: o placar de meses, e as metas nomeadas.
  // Uma barra única aqui mentiria — não há um alvo só para o período.
  if (leitura.varias) {
    const lista = leitura.metas
      .map((m) => `${esc(m.nome)} ${Number(m.alvoPct).toLocaleString('pt-BR')}% (${esc(vigenciaEmTexto(m))})`)
      .join(' · ');
    if (!leitura.total) {
      return `<span class="meta-kpi sem-dado">${esc(String(leitura.metas.length))} metas no período ·
        sem resultado mensal para comparar<br><small>${lista}</small></span>`;
    }
    const pct = Math.round((leitura.dentro / leitura.total) * 100);
    return `<span class="meta-kpi ${leitura.atinge ? 'dentro' : 'fora'}"
        title="Cada mês é medido contra a meta que rege aquele mês: ${esc(lista)}.">
        <span class="meta-barra" aria-hidden><i style="width:${pct}%"></i></span>
        <span class="meta-texto">${leitura.atinge ? '✓' : '✗'} ${inteiro(leitura.dentro)} de
          ${inteiro(leitura.total)} ${leitura.total === 1 ? 'mês dentro' : 'meses dentro'} da meta</span>
        <small style="color:var(--tinta3);font-size:10.5px">${lista}</small>
      </span>`;
  }

  if (leitura.atingido === null) {
    return `<span class="meta-kpi sem-dado">meta ${leitura.alvo.toLocaleString('pt-BR')}% · sem resultado no período</span>`;
  }
  const largura = Math.max(0, Math.min(100, leitura.atingido));
  const alvo = Math.max(0, Math.min(100, leitura.alvo));
  return `<span class="meta-kpi ${leitura.atinge ? 'dentro' : 'fora'}"
      title="Resultado ${esc(leitura.atingido.toLocaleString('pt-BR'))}% contra ${comparador} de ${esc(leitura.alvo.toLocaleString('pt-BR'))}%.">
      <span class="meta-barra" aria-hidden><i style="width:${largura}%"></i><b style="left:${alvo}%"></b></span>
      <span class="meta-texto">${leitura.atinge ? '✓' : '✗'} ${esc(leitura.atingido.toLocaleString('pt-BR'))}% ·
        ${comparador} ${esc(leitura.alvo.toLocaleString('pt-BR'))}%</span>
    </span>`;
}

/**
 * O semáforo da META cadastrada, a partir da leitura que `leituraMensalDeMeta`
 * devolve — que tem duas formas: um alvo só, ou um placar de meses quando a
 * janela atravessa vigências.
 *
 * Sem meta cadastrada o semáforo é CINZA, e não vermelho: "não alcançada"
 * afirmaria que existe um compromisso descumprido, quando não existe
 * compromisso nenhum.
 */
function semaforoDaMeta(leitura) {
  if (!leitura) {
    return { estado: null, texto: 'nenhuma meta de Financeiro cadastrada para este período',
      detalhe: 'Cadastre em Sistema › Cadastro › Metas para que o objetivo tenha contra o que comparar.' };
  }
  if (leitura.varias) {
    const lista = leitura.metas
      .map((m) => `${m.nome} ${Number(m.alvoPct).toLocaleString('pt-BR')}% (${vigenciaEmTexto(m)})`).join(' · ');
    if (!leitura.total) {
      return { estado: null, texto: `${leitura.metas.length} metas no período, sem resultado mensal para comparar`,
        detalhe: lista };
    }
    return { estado: !!leitura.atinge,
      texto: `${leitura.dentro} de ${leitura.total} ${leitura.total === 1 ? 'mês dentro' : 'meses dentro'} da meta`,
      detalhe: `Cada mês é medido contra a meta que rege aquele mês: ${lista}.` };
  }
  if (leitura.atingido === null || leitura.atingido === undefined) {
    return { estado: null, texto: `meta de ${Number(leitura.alvo).toLocaleString('pt-BR')}% · sem resultado no período`,
      detalhe: 'Não há dois meses com despesa fixa na janela da meta: sem variação, não há o que comparar.' };
  }
  const comparador = leitura.direcao === 'minimo' ? 'mínimo' : 'teto';
  return { estado: !!leitura.atinge,
    texto: `variação de ${leitura.atingido.toLocaleString('pt-BR')}% contra ${comparador} de `
      + `${Number(leitura.alvo).toLocaleString('pt-BR')}%`,
    detalhe: `A variação do custo fixo entre o primeiro e o último mês da vigência da meta, `
      + `medida contra o ${comparador} cadastrado.` };
}

/**
 * Semáforo: verde alcançou, vermelho não alcançou, cinza não dá para dizer.
 *
 * A cor NUNCA decide sozinha — é regra do projeto. Junto dela vão sempre o
 * símbolo (✓ / ✗ / ·), a palavra ("alcançada") e a frase que explica contra o
 * que a comparação foi feita, e o conjunto vira o `aria-label` do bloco para
 * quem lê por leitor de tela.
 *
 * `estado`: `true` verde, `false` vermelho, `null` sem base para dizer.
 */
function semaforoHtml({ rotulo, estado, texto, detalhe }) {
  const classe = estado === null ? 'neutro' : estado ? 'verde' : 'vermelho';
  const simbolo = estado === null ? '·' : estado ? '✓' : '✗';
  const palavra = estado === null ? 'sem base para dizer' : estado ? 'alcançada' : 'não alcançada';
  return `<div class="semaforo ${classe}" role="group"
      aria-label="${esc(`${rotulo}: ${palavra}. ${texto}`)}"${detalhe ? ` title="${esc(detalhe)}"` : ''}>
    <span class="semaforo-luz" aria-hidden="true">${simbolo}</span>
    <span class="semaforo-corpo">
      <b>${esc(rotulo)}</b>
      <span class="semaforo-estado">${esc(palavra)}</span>
      <small>${esc(texto)}</small>
    </span>
  </div>`;
}

/**
 * A meta em uma frase curta, para o cabeçalho do módulo.
 *
 * Existe porque só o bloco de SLA citava a meta: quem cadastrava um alvo de
 * Financeiro olhava o bloco e não via sinal nenhum de que ele existia. O
 * cabeçalho é onde se procura antes de abrir card nenhum.
 */
function resumoMetaDoModulo(leitura) {
  if (!leitura) return '';
  if (leitura.varias) {
    return leitura.metas
      .map((m) => `${Number(m.alvoPct).toLocaleString('pt-BR')}% ${vigenciaEmTexto(m)}`)
      .join(' · ');
  }
  if (leitura.alvo === null || leitura.alvo === undefined) return '';
  return `meta de ${Number(leitura.alvo).toLocaleString('pt-BR')}%`;
}


/**
 * A meta do custo recorrente, medida como o período realmente é.
 *
 * A variação de cada mês contra o mês anterior é o que a meta de Financeiro
 * limita ("não crescer mais que X%"), e é por mês que ela existe. O primeiro
 * mês da série não tem variação — não há anterior —, e fica de fora em vez de
 * entrar como zero.
 */
function metaDoCustoRecorrente(r, reducao) {
  return leituraMensalDeMeta(
    'financeiro',
    reducao.serie.map((p) => ({ comp: p.comp, valor: p.variacao })),
    reducao.variacaoTotal,
  );
}

/** Recorte em branco de um bloco: período livre, todas as filiais, tudo. */
const recorteVazio = () => ({ de: '', ate: '', filiais: new Set(), somenteReconhecidas: false });

/**
 * O mês mais ANTIGO com lançamento no escopo — '' se a base ainda não chegou.
 *
 * A competência é `AAAA-MM`, então a comparação de texto já é cronológica.
 */
function competenciaMaisAntigaDaBase() {
  let menor = '';
  for (const l of Loja.todosDoEscopo()) {
    if (l.competencia && (!menor || l.competencia < menor)) menor = l.competencia;
  }
  return menor;
}

/**
 * O último mês FECHADO: o anterior ao corrente.
 *
 * O mês em curso está pela metade — lê-lo junto com os fechados faz a série
 * terminar num degrau para baixo que não é queda de custo, é mês incompleto.
 */
const mesFechadoMaisRecente = () => mesSoma(mesHoje(), -1);

/**
 * O recorte com que um bloco ABRE.
 *
 * O Financeiro abre da primeira competência da base até o último mês fechado;
 * os outros dois abrem livres. A janela é o padrão de leitura da diretoria, e
 * por isso ela também é o destino do botão de restaurar — "limpar" para o
 * Financeiro não é deixar em branco, é voltar a esta janela.
 *
 * `padraoPendente` cobre o caso de o bloco nascer antes de a base chegar: sem
 * ele, um `de` vazio ficaria vazio para sempre e o padrão nunca valeria.
 */
function recorteInicial(bloco) {
  const r = recorteVazio();
  if (bloco !== 'financeiro') return r;
  r.de = competenciaMaisAntigaDaBase();
  r.ate = mesFechadoMaisRecente();
  r.padraoPendente = !r.de;
  return r;
}

function recorteDoBloco(bloco) {
  if (!E.filtrosInd) E.filtrosInd = {};
  if (!E.filtrosInd[bloco]) E.filtrosInd[bloco] = recorteInicial(bloco);
  const r = E.filtrosInd[bloco];
  if (r.padraoPendente) {
    const de = competenciaMaisAntigaDaBase();
    if (de) { r.de = de; r.padraoPendente = false; }
  }
  return r;
}

/** A competência está na janela do bloco? Ponta em branco não limita. */
function naJanela(comp, r) {
  if (r.de && comp < r.de) return false;
  if (r.ate && comp > r.ate) return false;
  return true;
}

const naFilialDoBloco = (valor, r) => (r.filiais.size === 0 ? true : r.filiais.has(valor || '(empresa)'));

// ------------------------------------------------------------- cálculo
/**
 * Redução de custo: só a despesa RECORRENTE entra.
 *
 * Uma compra pontual num mês e nenhuma no seguinte produziria uma "redução" que
 * é só o fim de uma compra. A tendência compara as médias das duas metades do
 * período, e não o último ponto: um mês atípico no fim não é direção.
 */
/**
 * FAROL 1 — variação dos custos fixos (mensais) E dos variáveis (pontuais).
 *
 * Absorve o antigo "Custo recorrente — variação no período": a leitura dos
 * fixos é a MESMA, número por número, e ganha ao lado a dos pontuais, que o
 * indicador antigo deixava de fora de propósito e nunca mostrava em lugar
 * nenhum.
 *
 * Três decisões:
 *
 * 1. **Fixos e variáveis são séries SEPARADAS, nunca somadas.** Uma compra
 *    pontual num mês e nenhuma no seguinte produz uma "queda" de 100% que é só
 *    o fim da compra; misturá-la ao recorrente contaminaria a única leitura
 *    que fala de patamar. São dois faróis dentro de um bloco, não um.
 * 2. **Dentro de cada série, despesa e investimento aparecem separados.**
 *    Investir R$ 50 mil num mês não é o custo subir R$ 50 mil, e um total que
 *    não distingue os dois faz o gestor explicar à diretoria uma alta que não
 *    é despesa. A divisão é por `classificacao`, que o lançamento já carrega.
 * 3. **A variação é do TOTAL do grupo**, e não de cada classificação: é a
 *    pergunta "o custo subiu?", e responder duas vezes com sinais opostos não
 *    é resposta.
 */
function calcularFarolCustos(r) {
  const base = Loja.todosDoEscopo().filter((l) =>
    passaNoFiltro(E.cenariosSel, l.cenario) && naFilialDoBloco(l.filial, r) &&
    naJanela(l.competencia, r) && (!r.somenteReconhecidas || reconhecidoDe(l)));

  const ehInvestimento = (l) => l.classificacao === 'investimento';
  const grupo = (itens) => {
    const porMes = new Map();
    for (const l of itens) {
      const a = porMes.get(l.competencia) || { despesa: 0, investimento: 0, n: 0 };
      a[ehInvestimento(l) ? 'investimento' : 'despesa'] += cent(l.valor);
      a.n += 1;
      porMes.set(l.competencia, a);
    }
    const meses = ordenado([...porMes.keys()]);
    const serie = meses.map((m, i) => {
      const a = porMes.get(m);
      const total = a.despesa + a.investimento;
      const ant = i > 0 ? porMes.get(meses[i - 1]) : null;
      const anterior = ant ? ant.despesa + ant.investimento : null;
      return {
        comp: m, rot: mesExib(m), lancamentos: a.n,
        despesa: reais(a.despesa), investimento: reais(a.investimento),
        valor: reais(total), centavos: total,
        // Sem mês anterior não há variação — e 0% diria que ficou igual.
        variacao: anterior === null || anterior === 0
          ? null : Math.round(((total - anterior) / anterior) * 1000) / 10,
      };
    });
    const primeiro = serie[0] ? serie[0].centavos : 0;
    const ultimo = serie.length ? serie[serie.length - 1].centavos : 0;
    const metade = Math.floor(serie.length / 2);
    const media = (f) => (f.length ? f.reduce((s, p) => s + p.centavos, 0) / f.length : 0);
    const inicioMedio = media(serie.slice(0, metade || 1));
    const variacaoMedia = inicioMedio === 0 ? 0 : ((media(serie.slice(metade)) - inicioMedio) / inicioMedio) * 100;
    const totalDespesa = itens.filter((l) => !ehInvestimento(l)).reduce((s, l) => s + cent(l.valor), 0);
    const totalInvestimento = itens.filter(ehInvestimento).reduce((s, l) => s + cent(l.valor), 0);
    return {
      serie, itens,
      valorInicial: reais(primeiro), valorFinal: reais(ultimo),
      variacaoTotal: serie.length < 2 || primeiro === 0
        ? null : Math.round(((ultimo - primeiro) / primeiro) * 1000) / 10,
      economia: reais(Math.max(primeiro - ultimo, 0)),
      tendencia: serie.length < 2 ? 'indefinida'
        : variacaoMedia <= -2 ? 'queda' : variacaoMedia >= 2 ? 'alta' : 'estavel',
      despesa: reais(totalDespesa), investimento: reais(totalInvestimento),
      total: reais(totalDespesa + totalInvestimento),
      pctInvestimento: pct(totalInvestimento, totalDespesa + totalInvestimento),
    };
  };

  return {
    fixos: grupo(base.filter((l) => l.natureza === 'fixa')),
    variaveis: grupo(base.filter((l) => l.natureza !== 'fixa')),
  };
}

/**
 * As DUAS medidas de um grupo, escritas juntas e nomeadas.
 *
 * `variacaoTotal` compara o primeiro mês com o último; `tendencia` compara a
 * média da primeira metade com a da segunda. A segunda é mais robusta — uma
 * ponta atípica não a move —, e as duas podem discordar de verdade. Mostrá-las
 * sem rótulo ("↓ em queda" ao lado de "+72,8%") lê-se como defeito.
 */
const SETA_TENDENCIA = { queda: '↓', alta: '↑', estavel: '→', indefinida: '·' };
const PALAVRA_TENDENCIA = {
  queda: 'em queda', alta: 'em alta', estavel: 'estável', indefinida: 'sem base para dizer',
};
const rotuloVariacao = (g) =>
  (g.variacaoTotal === null ? 'sem base para dizer' : (g.variacaoTotal > 0 ? '+' : '')
    + g.variacaoTotal.toLocaleString('pt-BR') + '% ponta a ponta')
  + ` (tendência ${SETA_TENDENCIA[g.tendencia]} ${PALAVRA_TENDENCIA[g.tendencia]})`;

/** As duas classificações. Cor E hachura: dois canais, nunca um só. */
const COR_DESPESA = 'var(--s1)';
const COR_INVESTIMENTO = 'var(--m4)';

const legendaDeClassificacaoHtml = () => `<div class="legenda-tipos" style="margin-top:10px">
  <span class="legenda-titulo">Classificação</span>
  <span><i style="background:${COR_DESPESA}" aria-hidden="true"></i>despesa</span>
  <span><i class="amostra-hachura" style="background:${COR_INVESTIMENTO}" aria-hidden="true"></i>investimento</span>
</div>`;

/**
 * Os quatro números do Farol 1: variação de cada grupo, e quanto de cada um é
 * investimento. O percentual de investimento fica ao lado da variação porque é
 * ele que explica uma alta que não é despesa.
 */
function cardsDoFarolHtml(f) {
  const variacao = (g) => (g.variacaoTotal === null
    ? '—' : (g.variacaoTotal > 0 ? '+' : '') + g.variacaoTotal.toLocaleString('pt-BR') + '%');
  const cor = (g) => (g.variacaoTotal === null ? null
    : g.variacaoTotal < 0 ? 'var(--bomtxt)' : g.variacaoTotal > 0 ? 'var(--crit)' : null);
  const card = (rot, valor, apoio, c) => `<div class="card-plano">
    <span class="card-rot">${esc(rot)}</span>
    <strong${c ? ` style="color:${c}"` : ''}>${valor}</strong>
    <span class="card-apoio">${esc(apoio)}</span></div>`;
  const apoioDe = (g) => `${brl(g.valorInicial)} → ${brl(g.valorFinal)}`
    + ` · tendência ${SETA_TENDENCIA[g.tendencia]} ${PALAVRA_TENDENCIA[g.tendencia]}`
    + `${g.pctInvestimento > 0 ? ` · ${pctTxt(g.pctInvestimento)} investimento` : ''}`;
  return `<div class="cards-plano">
    ${card('Custos fixos (mensais)', variacao(f.fixos), apoioDe(f.fixos), cor(f.fixos))}
    ${card('Custos variáveis (pontuais)', variacao(f.variaveis), apoioDe(f.variaveis), cor(f.variaveis))}
  </div>`;
}

/**
 * Um grupo do farol: o título, a série mês a mês em barras empilhadas por
 * classificação, e a tabela com a variação de cada mês.
 *
 * A tabela existe porque a barra responde "como foi ao longo do tempo" e a
 * coluna de variação responde "quanto mudou de um mês para o outro" — a
 * segunda não se lê num gráfico, e é a que vai para a reunião.
 */
function grupoDoFarolHtml(id, titulo, g) {
  if (!g.serie.length) {
    return `<h3 class="titulo-mini">${esc(titulo)}</h3>
      <p class="vazio">Nenhum lançamento deste tipo no recorte.</p>`;
  }
  return `<h3 class="titulo-mini">${esc(titulo)} — ${brl(g.total)} no período${
    g.investimento > 0 ? `, dos quais ${brl(g.investimento)} em investimento` : ''}</h3>
    <div id="i-farol-${esc(id)}"></div>
    <div class="rol rol-fixo" style="margin-top:10px;max-height:240px;min-height:0"><table>
      <thead><tr><th>Competência</th><th class="n">Despesa</th><th class="n">Investimento</th>
        <th class="n">Total</th><th class="n">Variação</th></tr></thead>
      <tbody>${g.serie.map((p) => `<tr>
        <td>${esc(p.rot)}</td>
        <td class="n">${p.despesa > 0 ? brl(p.despesa) : '—'}</td>
        <td class="n"${p.investimento > 0 ? ` style="color:${COR_INVESTIMENTO}"` : ''}>${
          p.investimento > 0 ? brl(p.investimento) : '—'}</td>
        <td class="n">${brl(p.valor)}</td>
        <td class="n"${p.variacao === null ? '' : ` style="color:${
          p.variacao < 0 ? 'var(--bomtxt)' : p.variacao > 0 ? 'var(--crit)' : 'var(--tinta2)'}"`}>${
          p.variacao === null ? '—' : (p.variacao > 0 ? '+' : '') + p.variacao.toLocaleString('pt-BR') + '%'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

function calcularReducao(r) {
  const porMes = new Map();
  for (const l of Loja.todosDoEscopo()) {
    if (l.natureza !== 'fixa') continue;
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (!naJanela(l.competencia, r)) continue;
    if (r.somenteReconhecidas && !reconhecidoDe(l)) continue;
    const atual = porMes.get(l.competencia) || { c: 0, n: 0 };
    porMes.set(l.competencia, { c: atual.c + cent(l.valor), n: atual.n + 1 });
  }
  const meses = ordenado([...porMes.keys()]);
  const serie = meses.map((m, i) => {
    const anterior = i > 0 ? porMes.get(meses[i - 1]).c : null;
    const c = porMes.get(m).c;
    return {
      comp: m, rot: mesExib(m), valor: reais(c), centavos: c, lancamentos: porMes.get(m).n,
      // Sem mês anterior não há variação — e 0 % diria que ficou igual.
      variacao: anterior === null || anterior === 0 ? null : Math.round(((c - anterior) / anterior) * 1000) / 10,
    };
  });
  const primeiro = serie[0] ? serie[0].centavos : 0;
  const ultimo = serie.length ? serie[serie.length - 1].centavos : 0;
  const metade = Math.floor(serie.length / 2);
  const media = (fatia) => (fatia.length ? fatia.reduce((s, p) => s + p.centavos, 0) / fatia.length : 0);
  const inicioMedio = media(serie.slice(0, metade || 1));
  const variacaoMedia = inicioMedio === 0 ? 0 : ((media(serie.slice(metade)) - inicioMedio) / inicioMedio) * 100;
  return {
    serie,
    valorInicial: reais(primeiro), valorFinal: reais(ultimo),
    variacaoTotal: serie.length < 2 || primeiro === 0 ? null : Math.round(((ultimo - primeiro) / primeiro) * 1000) / 10,
    economia: reais(Math.max(primeiro - ultimo, 0)),
    tendencia: serie.length < 2 ? 'indefinida' : variacaoMedia <= -2 ? 'queda' : variacaoMedia >= 2 ? 'alta' : 'estavel',
  };
}

/**
 * Despesas por reconhecer, agrupadas por centro de custo.
 *
 * Neste sistema o centro de custo É o tipo de despesa: é assim que as bases do
 * cliente vêm rotuladas, e a importação já traduz um pelo outro. O agrupamento
 * é explícito porque a carga concentra quase tudo por reconhecer — sem contador
 * por centro, o gestor veria um número grande e nenhum lugar por onde começar.
 */
function calcularPorReconhecer(r) {
  const centros = new Map();
  let universoN = 0, universoC = 0, n = 0, c = 0;
  for (const l of Loja.todosDoEscopo()) {
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (!naJanela(l.competencia, r)) continue;
    universoN += 1; universoC += cent(l.valor);
    if (reconhecidoDe(l)) continue;
    n += 1; c += cent(l.valor);
    const chave = l.tipo || '(sem centro de custo)';
    const atual = centros.get(chave) || { n: 0, c: 0 };
    centros.set(chave, { n: atual.n + 1, c: atual.c + cent(l.valor) });
  }
  return {
    quantidade: n, valor: reais(c), universoN, universoValor: reais(universoC),
    pctQuantidade: universoN ? Math.round((n / universoN) * 1000) / 10 : 0,
    centros: [...centros.entries()]
      .map(([centro, v]) => ({ centro, quantidade: v.n, valor: reais(v.c) }))
      .sort((a, b) => b.valor - a.valor),
  };
}

/**
 * Conformidade de SLA e situação dos chamados.
 *
 * "Vencido" não é status de origem: é o chamado cujo prazo passou e que ninguém
 * resolveu. Convive com aberto e em andamento, por isso é contado À PARTE — as
 * quatro somadas dariam mais que o total, e a tela precisa dizer isso.
 */
function calcularSla(r) {
  let total = 0, dentro = 0, abertos = 0, andamento = 0, resolvidos = 0, vencidos = 0, comStatus = 0;
  const agora = new Date().toISOString();
  // Por competência, para a meta poder ser medida mês a mês quando o recorte
  // atravessa vigências. Sem isto, treze meses eram julgados por uma regra só.
  const porMes = new Map();
  for (const e of escopoEmpresas()) {
    for (const s of (E.sla.get(e) || [])) {
      if (!naFilialDoBloco(s.filial, r)) continue;
      if (!naJanela(s.competencia, r)) continue;
      total += s.total || 0;
      dentro += s.dentro || 0;
      const mes = porMes.get(s.competencia) || { total: 0, dentro: 0 };
      porMes.set(s.competencia, { total: mes.total + (s.total || 0), dentro: mes.dentro + (s.dentro || 0) });
      if (!s.status) continue;
      comStatus += s.total || 1;
      const st = String(s.status).toLowerCase();
      if (/resolvid|fechad|closed|resolved/.test(st)) resolvidos += 1;
      else if (/andamento|progress|process/.test(st)) andamento += 1;
      else abertos += 1;
      if (!/resolvid|fechad|closed|resolved/.test(st) && s.prazoEm && s.prazoEm < agora) vencidos += 1;
    }
  }
  const pct = total ? Math.round((dentro / total) * 1000) / 10 : 0;
  const meta = alvoDe('sla', mesDoRecorte(r)) ?? META_SLA;
  const serie = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([comp, m]) => ({ comp, valor: m.total ? Math.round((m.dentro / m.total) * 1000) / 10 : null }));
  return {
    total, dentro, fora: total - dentro, pct, meta, serie,
    atinge: total > 0 && pct >= meta,
    distancia: total > 0 ? Math.round((pct - meta) * 10) / 10 : null,
    leitura: leituraMensalDeMeta('sla', serie, total ? pct : null),
    abertos, andamento, resolvidos, vencidos, semStatus: total - comStatus,
  };
}

/**
 * Distribui um valor por pesos sem perder nem inventar centavo.
 *
 * `ratear` já existe em `app-js1.js` e divide em N partes IGUAIS (as parcelas
 * de um lançamento); esta divide por PESO, que é outra conta. Daí o nome
 * próprio, e não uma sobrecarga da outra.
 *
 * `Math.floor` em cada parcela sempre deixa resto; devolvê-lo ao maior peso,
 * um centavo por vez, é o que faz a soma das parcelas dar EXATAMENTE o valor
 * de partida. Sem isso, o "antes" e o "depois" do comparativo divergiriam por
 * arredondamento, e a tela acusaria uma diferença que não existe.
 *
 * É a mesma conta de `ratear` em `server/src/domain/indicadores.ts`: as duas
 * pontas têm de dar o mesmo número, e `testar-rateio.cjs` confere isso.
 */
function ratearPorPeso(centavos, pesos) {
  const soma = pesos.reduce((s, p) => s + p, 0);
  // Todos os pesos em zero — um grupo em que só há despesa compartilhada.
  // Dividir igual é o único critério que não inventa desigualdade onde não há
  // dado; qualquer outro atribuiria mais a alguém por nenhum motivo.
  const base = soma > 0 ? pesos : pesos.map(() => 1);
  const total = base.reduce((s, p) => s + p, 0);
  if (total <= 0 || !base.length) return pesos.map(() => 0);

  const parcelas = base.map((p) => Math.floor((centavos * p) / total));
  let resto = centavos - parcelas.reduce((s, p) => s + p, 0);
  const ordem = base.map((p, i) => ({ p, i }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.i);
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length) {
    parcelas[ordem[k]] += 1;
    resto -= 1;
  }
  return parcelas;
}

/**
 * Despesas compartilhadas REGULARIZADAS: o rateio proporcional.
 *
 * `calcularConsumo` conta o compartilhado pelo valor INTEGRAL da pagadora — é
 * a leitura de hoje, e ela não muda. Aqui é a outra: a mesma despesa
 * distribuída entre as empresas do grupo, para que a pagadora deixe de
 * carregar 100% de um custo que o grupo usa.
 *
 * As duas convivem de propósito. A integral é o **antes** do comparativo, e
 * trocá-la pelo rateio faria um mês já lido mudar de número.
 *
 * O critério está escrito, e é uma escolha: proporcional à despesa PRÓPRIA de
 * cada empresa no período. Própria, e não total, porque incluir o
 * compartilhado no divisor tornaria a conta circular.
 */
/**
 * OBJETIVO 02 — Adequação dos custos compartilhados.
 *
 * Adequar é fazer cada unidade pagar a parte dela na ORIGEM, em vez de uma
 * filial pagar o contrato inteiro e as outras consumirem sem aparecer na conta.
 * O indicador mede o andamento disso: do que é compartilhado, quanto já foi
 * adequado.
 *
 * Quatro decisões, e cada uma muda o número:
 *
 * 1. **Só despesa FIXA (mensal) e só compartilhada.** É o universo do objetivo:
 *    uma compra pontual não tem contrato a renegociar, e o que já é 100% da
 *    filial não tem o que adequar.
 * 2. **O estado sai do MARCO, não da ausência.** Uma despesa que some pode ter
 *    sido adequada ou pode ter acabado; contar as duas como adequação faria o
 *    indicador comemorar um contrato cancelado. Ver `jaRegularizada`.
 * 3. **Compartilhado e regularizado somam o universo do mês.** São dois estados
 *    da MESMA despesa, e por isso a linha do tempo é uma barra empilhada: a
 *    altura é quanto há de compartilhado no mês, e a divisão é o andamento.
 * 4. **Os percentuais saem do último mês REALIZADO.** A base carrega projeções
 *    lançadas em competência futura; tomá-las como "hoje" faria a tela anunciar
 *    um andamento de um ano à frente. É a mesma regra do Objetivo 01.
 */
function calcularAdequacao(r) {
  const base = Loja.todosDoEscopo().filter((l) =>
    l.natureza === 'fixa' && passaNoFiltro(E.cenariosSel, l.cenario) &&
    naFilialDoBloco(l.filial, r) && naJanela(l.competencia, r));
  const compartilhadas = base.filter((l) => consumoDe(l) === 'compartilhado');

  const meses = ordenado([...new Set(base.map((l) => l.competencia).filter(Boolean))]);
  const fechado = mesSoma(mesHoje(), -1);
  const realizados = meses.filter((m) => m <= fechado);
  const referencia = realizados[realizados.length - 1] || meses[meses.length - 1] || null;

  const somaDe = (itens) => itens.reduce((s, l) => s + cent(l.valor), 0);
  const serie = meses.map((m) => {
    const doMes = compartilhadas.filter((l) => l.competencia === m);
    const reg = somaDe(doMes.filter(jaRegularizada));
    const ainda = somaDe(doMes.filter((l) => !jaRegularizada(l)));
    return {
      comp: m, rot: mesExib(m), projetado: m > fechado,
      regularizado: reais(reg), compartilhado: reais(ainda), total: reais(reg + ainda),
      pctRegularizado: pct(reg, reg + ainda),
    };
  });

  const doMesRef = compartilhadas.filter((l) => l.competencia === referencia);
  const regC = somaDe(doMesRef.filter(jaRegularizada));
  const aindaC = somaDe(doMesRef.filter((l) => !jaRegularizada(l)));
  const custoFixoMes = somaDe(base.filter((l) => l.competencia === referencia));

  // A árvore mostra o que AINDA é compartilhado: é o trabalho que resta, e é
  // sobre ele que a pergunta "de quem é, e em qual filial" tem resposta útil.
  // O que já foi adequado deixou de ser um problema a distribuir.
  const pendentes = doMesRef.filter((l) => !jaRegularizada(l));

  return {
    referencia, serie, meses,
    lancamentos: compartilhadas.length,
    pendentesNoMes: pendentes.length,
    regularizado: reais(regC), compartilhado: reais(aindaC), total: reais(regC + aindaC),
    custoFixoMes: reais(custoFixoMes),
    // OS DOIS PERCENTUAIS DO ENUNCIADO. O primeiro é o andamento; o segundo
    // diz o tamanho disso dentro do custo fixo, que é o que decide se a
    // adequação move o ponteiro do mês ou é detalhe.
    pctRegularizado: pct(regC, regC + aindaC),
    pctDoCustoFixo: pct(regC, custoFixoMes),
    // O peso do que ainda falta, no mesmo denominador: sem ele, "23% adequado"
    // não diz se o que resta é grande ou irrelevante.
    pctPendenteDoCustoFixo: pct(aindaC, custoFixoMes),
    porUnidade: quebrarPorUnidade(pendentes, (l) => cent(l.valor)),
    pendentes,
    // Todo o compartilhado da janela, para o detalhamento do número clicado.
    registros: compartilhadas,
  };
}

/** As cores dos dois estados. Fixas, e não da paleta por tipo: aqui a cor é o
 *  estado (pendente × adequado), e o verde/laranja da escala já significa isso
 *  em toda a tela. */
const COR_PENDENTE = 'var(--alerta)';
const COR_REGULARIZADO = 'var(--bom)';

/**
 * Os números do Objetivo 02 em cards, com a conta à vista.
 *
 * Os dois percentuais que o enunciado pede têm DENOMINADORES diferentes, e é
 * por isso que eles não podem ficar soltos lado a lado sem rótulo: um é sobre o
 * compartilhado, o outro sobre o custo fixo do mês. Escrever o denominador em
 * cada card é o que impede a leitura de somar os dois.
 */
function cardsDaAdequacaoHtml(a) {
  const card = (rot, valor, apoio, cor, forte) => `<div class="card-plano${forte ? ' forte' : ''}">
    <span class="card-rot">${esc(rot)}</span>
    <strong${cor ? ` style="color:${cor}"` : ''}>${valor}</strong>
    ${apoio ? `<span class="card-apoio">${esc(apoio)}</span>` : ''}</div>`;
  return `<div class="cards-plano" role="group" aria-label="Adequação em ${esc(mesExib(a.referencia))}">
    ${card('Ainda compartilhado', brl(a.compartilhado),
      `${pctTxt(a.pctPendenteDoCustoFixo)} do custo fixo do mês`, COR_PENDENTE)}
    <span class="card-op" aria-hidden="true">+</span>
    ${card('Já regularizado', brl(a.regularizado),
      `${pctTxt(a.pctDoCustoFixo)} do custo fixo do mês`, COR_REGULARIZADO)}
    <span class="card-op" aria-hidden="true">=</span>
    ${card('Compartilhado no mês', brl(a.total),
      `${pctTxt(a.pctRegularizado)} dele já regularizado`, null, true)}
  </div>`;
}

/** A chave de leitura da linha do tempo. A cor nunca é o único canal. */
const legendaDaAdequacaoHtml = () => `<div class="legenda-tipos" style="margin-top:10px">
  <span class="legenda-titulo">Linha do tempo</span>
  <span><i style="background:${COR_PENDENTE}" aria-hidden="true"></i>ainda compartilhado</span>
  <span><i style="background:${COR_REGULARIZADO}" aria-hidden="true"></i>já regularizado</span>
</div>`;

function calcularRateio(r) {
  const empresas = new Map();
  const compartilhados = [];
  // O GRUPO inteiro entra na lista, e não só quem tem lançamento: a empresa
  // que ainda não gastou nada por conta própria é justamente a que mais
  // depende do que o grupo paga por ela. Peso zero recebe zero, e a linha diz
  // isso em vez de sumir.
  for (const e of escopoEmpresas()) {
    empresas.set(e, {
      empresa: e, nome: String(nomeEmpresa(e)),
      cor: corDaMatriz(e), corEscura: corCompartilhada(e),
      proprio: 0, pago: 0, recebido: 0, segmentos: [],
    });
  }
  for (const l of Loja.todosDoEscopo()) {
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (!naJanela(l.competencia, r)) continue;
    const c = cent(l.valor);
    if (!empresas.has(l.empresa)) {
      empresas.set(l.empresa, {
        empresa: l.empresa, nome: String(nomeEmpresa(l.empresa)),
        cor: corDaMatriz(l.empresa), corEscura: corCompartilhada(l.empresa),
        proprio: 0, pago: 0, recebido: 0, segmentos: [],
      });
    }
    const e = empresas.get(l.empresa);
    if (consumoDe(l) === 'compartilhado') { e.pago += c; compartilhados.push(l); }
    else e.proprio += c;
  }

  const lista = [...empresas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const pesos = lista.map((e) => e.proprio);
  for (const l of compartilhados) {
    const parcelas = ratearPorPeso(cent(l.valor), pesos);
    lista.forEach((e, i) => {
      if (parcelas[i] <= 0) return;
      e.recebido += parcelas[i];
      e.segmentos.push({
        descricao: l.descricao || l.tipo,
        origem: String(nomeEmpresa(l.empresa)),
        valor: reais(parcelas[i]),
        pct: pct(parcelas[i], cent(l.valor)),
        beneficiadas: beneficiadasDe(l),
      });
    });
  }

  const compartilhado = compartilhados.reduce((s, l) => s + cent(l.valor), 0);
  const total = lista.reduce((s, e) => s + e.proprio + e.pago, 0);
  return {
    total: reais(total), compartilhado: reais(compartilhado),
    pctCompartilhado: pct(compartilhado, total),
    lancamentos: compartilhados.length,
    divisaoIgual: lista.length > 0 && lista.every((e) => e.proprio === 0),
    sanidade: reais(lista.reduce((s, e) => s + e.recebido, 0)),
    // A EXIBIÇÃO sai por valor decrescente; `lista` continua alfabética porque
    // é ela que indexa `ratearPorPeso`, e mudar essa ordem mudaria para quem
    // vai o centavo de resto — o total fecharia igual, as parcelas não.
    porEmpresa: lista.map((e) => ({
      ...e,
      proprioValor: reais(e.proprio),
      pagoValor: reais(e.pago),
      recebidoValor: reais(e.recebido),
      antes: reais(e.proprio + e.pago),
      depois: reais(e.proprio + e.recebido),
      variacao: reais((e.proprio + e.recebido) - (e.proprio + e.pago)),
      pagadora: e.pago > 0,
    })).sort((a, b) => b.antes - a.antes),
  };
}

/**
 * O plano de redução aplicado ao recorte: de quanto para quanto.
 *
 * Cada item do cadastro casa com os lançamentos pelo NOME do tipo de despesa
 * e, quando informada, pelo nome da filial — é assim que o modelo do artifact
 * guarda o lançamento. O valor ATUAL sai dos lançamentos; o ALVO, do cadastro.
 * Nada aqui é estimado.
 */
/**
 * A janela que o OBJETIVO 01 percorre — a vigência da meta de Financeiro.
 *
 * O indicador é declaradamente INDEPENDENTE do filtro de período do bloco: a
 * linha do tempo dele é a do compromisso cadastrado, e não a do recorte que
 * alguém escolheu para olhar outra coisa. Recortar o objetivo pelo filtro faria
 * "a meta foi alcançada?" mudar de resposta conforme o mês em que se olha.
 *
 * Ponta em aberto (meta sem início, ou sem fim) se estica até onde existe
 * despesa fixa na base: é o máximo que se pode afirmar sem inventar mês.
 */
function janelaDoObjetivo() {
  const fixas = Loja.todosDoEscopo().filter((l) => l.natureza === 'fixa' && passaNoFiltro(E.cenariosSel, l.cenario));
  const comps = ordenado([...new Set(fixas.map((l) => l.competencia).filter(Boolean))]);
  const primeira = comps[0] || null;
  const ultima = comps[comps.length - 1] || null;

  const metas = (E.metas || []).filter((m) =>
    m && m.modulo === 'financeiro' && m.ativo !== false && (!m.cliente || m.cliente === E.clienteSel));
  if (!metas.length) return { de: primeira, ate: ultima, metas: [], semMeta: true };

  // `vigenciaInicio` vazio é "desde sempre": a ponta abre, e o `null` vence
  // qualquer data. O mesmo vale para o fim.
  const abreNoInicio = metas.some((m) => !m.vigenciaInicio);
  const abreNoFim = metas.some((m) => !m.vigenciaFim);
  const de = abreNoInicio ? primeira
    : ordenado(metas.map((m) => m.vigenciaInicio))[0];
  const ate = abreNoFim ? ultima
    : ordenado(metas.map((m) => m.vigenciaFim)).pop();
  return { de: de || primeira, ate: ate || ultima, metas, semMeta: false };
}

/**
 * O escopo de um plano é o par (tipo de despesa, filial), em que vazio quer
 * dizer "tudo". `contemEscopo(a, b)` responde: tudo o que `b` alcança, `a`
 * também alcança?
 */
const contemEscopo = (a, b) =>
  (!a.tipo || a.tipo === b.tipo) && (!a.filial || a.filial === b.filial);

/** Um lançamento entra no plano quando casa com o escopo dele. */
const planoAlcanca = (p, l) =>
  (!p.tipo || l.tipo === p.tipo) && (!p.filial || l.filial === p.filial);

/**
 * A ordem dos planos é CRONOLÓGICA — vigência vazia é "desde sempre" e vem
 * primeiro. Empate: o corte maior à frente, e o nome por último, para que a
 * ordem não dependa da ordem em que alguém cadastrou.
 */
const porVigenciaDoPlano = (a, b) =>
  String(a.vigenciaInicio || '').localeCompare(String(b.vigenciaInicio || ''))
  || cent(b.valorAlvo) - cent(a.valorAlvo)
  || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');

/**
 * OS PLANOS SÃO DEGRAUS DE UMA ESCADA, NÃO LEITURAS ALTERNATIVAS DO MESMO MÊS.
 *
 * Dois planos sobre a mesma despesa se somam no tempo: se um corta R$ 3.500 a
 * partir de 01/2027 e o outro corta R$ 5.000 a partir de 02/2027, o segundo
 * não parte dos R$ 13.300 de hoje — parte dos R$ 9.800 que o primeiro deixou.
 * Medir os dois contra a mesma base conta o mesmo dinheiro duas vezes e
 * promete uma economia que o plano não produz: era o que a tela fazia, com as
 * duas linhas anunciando "de R$ 13.300,00".
 *
 * Encadeia-se quando o escopo do plano ANTERIOR cabe dentro do escopo do
 * posterior — é aí, e só aí, que se sabe que aquele corte já saiu desta base.
 * O contrário é indeterminado: cortar R$ 10.000 "do custo fixo" em janeiro não
 * diz quanto disso saiu de Pessoas, e atribuir tudo seria inventar. Nesse caso
 * o degrau parte do valor cheio, que é o único número que a base sustenta.
 */
function planosEmCadeia(planos) {
  const ordem = [...planos].sort(porVigenciaDoPlano);
  return ordem.map((p, i) => ({
    plano: p,
    jaCortado: ordem.slice(0, i).reduce(
      (s, q) => s + (contemEscopo(p, q) ? cent(q.valorAlvo) : 0), 0),
  }));
}

/**
 * OBJETIVO 01 — Redução de custo sobre a despesa FIXA (mensal).
 *
 * Três decisões que mudam o número, e cada uma tem razão própria:
 *
 * 1. **Só despesa fixa entra.** O objetivo é sobre custo recorrente: uma compra
 *    pontual daquele mesmo tipo de despesa entrava na conta e fazia o "atual"
 *    subir num mês sem que nada recorrente tivesse mudado.
 * 2. **Tudo é MENSAL.** O alvo cadastrado é o valor que aquela despesa deve
 *    passar a custar POR MÊS. Comparar com a soma de oito meses — que é o que
 *    o indicador fazia — punha os dois lados em unidades diferentes, e a
 *    "redução" resultante não significava nada. O `atual` passa a ser o nível
 *    do ÚLTIMO mês com despesa na janela: quanto custa hoje.
 * 3. **A janela é a da meta, não a do filtro.** Ver `janelaDoObjetivo`.
 */
function calcularPlanoReducao(r) {
  const janela = janelaDoObjetivo();
  const naJanelaDoObjetivo = (comp) =>
    (!janela.de || comp >= janela.de) && (!janela.ate || comp <= janela.ate);

  // O filtro de FILIAL do bloco continua valendo — ele diz de quem é a leitura,
  // e não de quando. Só o período é ignorado.
  const base = Loja.todosDoEscopo().filter((l) =>
    l.natureza === 'fixa' && passaNoFiltro(E.cenariosSel, l.cenario) &&
    naFilialDoBloco(l.filial, r) && naJanelaDoObjetivo(l.competencia));

  const meses = ordenado([...new Set(base.map((l) => l.competencia).filter(Boolean))]);
  // O mês de REFERÊNCIA é o último mês REALIZADO — e não simplesmente o último
  // da janela. A base carrega projeções lançadas com competência futura, e uma
  // meta sem fim estica a janela até elas: sem este corte, o "quanto custa
  // hoje" saía de dezembro de 2027, o card comparava o alvo contra um mês que
  // ainda não aconteceu e a legenda anunciava valores de um ano à frente.
  //
  // O mês corrente também fica de fora: ele está pela metade, e tomá-lo como
  // referência faria o custo parecer ter despencado no dia 3.
  const fechado = mesSoma(mesHoje(), -1);
  const realizados = meses.filter((m) => m <= fechado);
  const referencia = realizados[realizados.length - 1] || meses[meses.length - 1] || null;
  const doMesRef = base.filter((l) => l.competencia === referencia);
  const totalFixasMes = doMesRef.reduce((s, l) => s + cent(l.valor), 0);

  const gastoDaFilial = new Map();
  for (const l of doMesRef) {
    const chave = l.empresa + '|' + (l.filial || '');
    gastoDaFilial.set(chave, (gastoDaFilial.get(chave) || 0) + cent(l.valor));
  }

  // Os planos que valem em ALGUM mês da janela — e não só no mês corrente: um
  // alvo que vigorou de março a junho é parte da história que a linha conta.
  const doCliente = planosDoCliente().filter((p) => p.ativo !== false);
  const vigentes = doCliente.filter((p) =>
    (!p.vigenciaFim || !janela.de || p.vigenciaFim >= janela.de) &&
    (!p.vigenciaInicio || !janela.ate || p.vigenciaInicio <= janela.ate));

  const itens = planosEmCadeia(vigentes).map(({ plano: p, jaCortado }) => {
    const casam = base.filter((l) => planoAlcanca(p, l));
    const noMes = casam.filter((l) => l.competencia === referencia);
    const bruto = noMes.reduce((s, l) => s + cent(l.valor), 0);
    // A BASE DESTE DEGRAU: o que a despesa custa hoje, menos o que os planos
    // anteriores já se comprometeram a tirar dela. Ver `planosEmCadeia`.
    const atual = Math.max(0, bruto - jaCortado);

    // O VALOR CADASTRADO É QUANTO CORTAR: o alvo do item é o que ele custa
    // hoje menos a redução pactuada.
    //
    // A versão anterior tirava a base do PRIMEIRO mês da janela, e isso quebrou
    // na base real: um tipo que só passa a existir no meio do período tinha
    // base zero, o alvo virava R$ 0,00 e a tela anunciava "100% de redução".
    // O mês de referência é o único que sempre existe para um item vigente.
    const corte = cent(p.valorAlvo);
    const alvo = Math.max(0, atual - corte);

    // A série do item: quanto aquela despesa custou em cada mês da janela.
    const porMes = new Map();
    for (const l of casam) porMes.set(l.competencia, (porMes.get(l.competencia) || 0) + cent(l.valor));

    const porFilial = new Map();
    for (const l of noMes) {
      const chave = l.empresa + '|' + (l.filial || '');
      const no = porFilial.get(chave) || {
        unidade: l.filial || String(nomeEmpresa(l.empresa)),
        cor: corDaMatriz(l.empresa), valor: 0,
      };
      no.valor += cent(l.valor);
      porFilial.set(chave, no);
    }

    return {
      nome: p.nome, tipo: p.tipo, filial: p.filial,
      vigencia: vigenciaEmTexto(p), vigenciaInicio: p.vigenciaInicio || '',
      atual: reais(atual), alvo: reais(alvo), corte: reais(corte),
      // O que a despesa custa de verdade no mês, antes do desconto do degrau
      // anterior: é ele que dá o peso real dela no custo fixo.
      custoBruto: reais(bruto), jaCortadoAntes: reais(jaCortado),
      reducao: reais(corte),
      pctReducao: pct(corte, atual),
      // O veredicto NÃO é por item: o alvo do item é derivado do próprio custo
      // dele, e comparar um com o outro seria comparar um número consigo
      // mesmo. Quem julga é o agregado, contra o mês em que o plano começou.
      atinge: null,
      semDespesa: bruto === 0,
      // O PESO da despesa no custo fixo sai do valor CHEIO dela — é o que ela
      // representa no mês, e não o que sobrou depois do degrau anterior.
      pctDoGrupo: pct(bruto, totalFixasMes),
      // A coluna da tabela: quanto do custo fixo total ESTA meta corta. É o
      // percentual que soma — o anterior repetia 10,4% em duas linhas que
      // cortam valores diferentes, porque media a mesma despesa duas vezes.
      pctDoCorte: pct(corte, totalFixasMes),
      porMes,
      porFilial: [...porFilial.entries()]
        .map(([chave, f]) => ({ ...f, valorReais: reais(f.valor), pctDaFilial: pct(f.valor, gastoDaFilial.get(chave) || 0) }))
        .sort((a, b) => b.valor - a.valor),
      registros: casam,
    };
  });

  // OS TOTAIS SAEM DA UNIÃO DOS ESCOPOS, e não da soma das linhas. Dois planos
  // sobre "Pessoas" são dois degraus da MESMA despesa: somar o "atual" das duas
  // linhas contaria os mesmos R$ 13.300 duas vezes, e o percentual sobre o
  // custo fixo passaria de 100% com plano nenhum sendo grande.
  const alcancado = (l) => vigentes.some((p) => planoAlcanca(p, l));
  const totalAtual = doMesRef.filter(alcancado).reduce((s, l) => s + cent(l.valor), 0);
  const metaTotal = itens.reduce((s, i) => s + cent(i.corte), 0);
  const totalAlvo = Math.max(0, totalAtual - metaTotal);

  // A linha do tempo: mês a mês, o custo das despesas do plano contra o alvo
  // mensal somado. O alvo é uma reta — é um compromisso, não uma medição.
  const serie = meses.map((m) => {
    const c = base.filter((l) => l.competencia === m && alcancado(l))
      .reduce((s, l) => s + cent(l.valor), 0);
    return { comp: m, rot: mesExib(m), valor: reais(c), centavos: c, alvo: reais(totalAlvo) };
  });

  // OS TRÊS NÚMEROS DO PLANO, todos sobre o mês de referência e fechando a
  // conta na tela: custo fixo total − meta total = resultado esperado.
  const resultadoEsperado = Math.max(0, totalFixasMes - metaTotal);

  // O VEREDICTO é do agregado, e contra um mês fixo: o primeiro da janela em
  // que algum plano já vigorava. Comparar o custo de hoje com um alvo derivado
  // do custo de hoje seria comparar um número consigo mesmo — foi o que a
  // versão anterior fazia, e por isso o alvo nunca podia ser alcançado.
  const vigenteEm = (p, m) =>
    (!p.vigenciaInicio || p.vigenciaInicio <= m) && (!p.vigenciaFim || p.vigenciaFim >= m);
  // O mês base tem de ser REALIZADO. Antes ele era o primeiro mês da janela com
  // plano vigente, e um plano que só começa a valer no futuro punha a base num
  // mês que ainda não aconteceu — cujos lançamentos são só as projeções já
  // cadastradas. Na base real isso produziu a frase "o custo fixo subiu
  // R$ 95.572,89 desde 01/2027", comparando agosto de 2026 com janeiro de 2027.
  const mesBase = realizados.find((m) => vigentes.some((p) => vigenteEm(p, m))) || null;
  const custoFixoBase = mesBase
    ? base.filter((l) => l.competencia === mesBase).reduce((s, l) => s + cent(l.valor), 0)
    : 0;
  const jaCortado = mesBase ? custoFixoBase - totalFixasMes : 0;
  // Plano que só passa a valer no futuro não tem o que julgar: o primeiro mês
  // em que ele vigora.
  const inicioNoFuturo = !mesBase && vigentes.length
    ? ordenado(vigentes.map((p) => p.vigenciaInicio).filter(Boolean))[0] || null
    : null;

  return {
    itens, serie, janela, referencia,
    // Os lançamentos do plano, como UNIÃO dos escopos. Somar os `registros` de
    // cada item listaria o mesmo lançamento uma vez por plano que o alcança —
    // dois planos sobre "Pessoas" mostrariam a folha inteira em dobro, e a soma
    // do detalhamento deixaria de bater com o número clicado.
    registros: base.filter(alcancado),
    composicao: composicaoDoCustoFixo(base, meses, referencia, vigentes),
    totalAtual: reais(totalAtual), totalAlvo: reais(totalAlvo),
    metaTotal: reais(metaTotal),
    resultadoEsperado: reais(resultadoEsperado),
    mesBase, custoFixoBase: reais(custoFixoBase), jaCortado: reais(jaCortado), inicioNoFuturo,
    totalReducao: reais(metaTotal),
    pctReducao: pct(metaTotal, totalAtual),
    // O percentual que o enunciado pede: quanto o plano representa sobre o
    // TOTAL do custo fixo mensal — os dois no mesmo mês de referência.
    pctDasFixas: pct(totalAtual, totalFixasMes),
    fixasDoMes: reais(totalFixasMes),
    // Alcançado quando o custo fixo já caiu, desde o mês base, pelo menos o
    // que se combinou cortar.
    // Sem mês base realizado não há veredicto: `null` é o cinza de "a apurar".
    atinge: !mesBase ? null : metaTotal > 0 && jaCortado >= metaTotal,
    // O semáforo da META cadastrada, medida na janela dela — e não no recorte
    // do bloco, que é justamente o que esta entrega desacoplou.
    leituraMeta: metaNaJanelaDoObjetivo(r, janela),
  };
}

/**
 * A composição do custo fixo mês a mês, por TIPO DE DESPESA.
 *
 * É o que a barra de cada mês empilha. Três decisões:
 *
 * 1. **A barra inteira é o custo fixo do mês**, e não só as despesas do plano.
 *    A leitura que o gestor pediu é "quanto custa hoje o custo fixo, e do que
 *    ele é feito" — um gráfico só das despesas do plano mostraria a parte e
 *    esconderia o todo contra o qual a meta é medida.
 * 2. **A ordem dos segmentos é a das VAGAS DA PALETA**, e não a do valor. Este
 *    ponto foi medido, não escolhido por gosto: a paleta é validada entre cores
 *    VIZINHAS na ordem das vagas (ΔE ≥ 8 para daltonismo, ≥ 15 para visão
 *    normal), e empilhar por valor produz vizinhanças arbitrárias — na base
 *    real o pior par cairia a ΔE 7,1 entre o laranja e o vermelho, abaixo do
 *    piso. Empilhar na ordem das vagas devolve a garantia para qualquer base
 *    de cliente, e de quebra mantém a mesma altura para a mesma cor em todos
 *    os meses, que é o que permite comparar barras com o olho. Quem quer saber
 *    o que pesa mais lê a LEGENDA, que é ordenada por valor.
 * 3. **A cor vem de `corDoTipo`**, que é por NOME e não por tamanho: a cor
 *    segue a entidade, nunca o ranking. Do nono tipo em diante tudo cai em
 *    "Outros" — inventar uma nona cor daria duas indistinguíveis. "Outros" vai
 *    na PRIMEIRA vaga porque o cinza dele encosta mal no verde da oitava
 *    (ΔE 13,6, abaixo do piso) e bem no laranja da primeira (ΔE 18,1).
 */
/**
 * A legenda das cores do empilhamento, com o valor do mês de referência.
 *
 * Não é enfeite: três das oito cores ficam abaixo de 3:1 contra o fundo claro,
 * e a regra é que uma cor fraca só entra acompanhada de rótulo visível. A
 * legenda É esse rótulo — sem ela o gráfico seria cor pura, que é justamente o
 * que o projeto não admite.
 */
function legendaDeTiposHtml(composicao) {
  const { series, pontos, referencia } = composicao;
  const visiveis = series.filter((s) => s.total > 0);
  if (!visiveis.length) return '';
  // Ordenada por VALOR, ao contrário do empilhamento, que vai pela ordem das
  // vagas da paleta. É a legenda que responde "o que pesa mais", e é por isso
  // que a barra pode se dar ao luxo de empilhar na ordem que protege as cores.
  const porValor = [...visiveis].sort((a, b) => b.naReferencia - a.naReferencia
    || b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
  const temProjecao = pontos.some((p) => p.projetado);
  return `<div class="legenda-tipos">
    <span class="legenda-titulo">Valores de ${esc(mesExib(referencia))}:</span>
    ${porValor.map((s) => `<span><i style="background:${s.cor}"></i>${esc(s.nome)} ·
      ${s.naReferencia > 0
        ? brl(s.naReferencia)
        : `<em title="Este tipo tem despesa em outros meses da janela, mas nenhuma em ${esc(mesExib(referencia))}.">sem despesa neste mês</em>`}</span>`).join('')}
    ${temProjecao ? `<span class="legenda-proj"><i aria-hidden="true"></i>Barra hachurada = projeção,
      repetindo a composição de ${esc(mesExib(referencia))}</span>` : ''}
  </div>`;
}

/**
 * O gráfico do Objetivo 01: barras empilhadas por tipo, projeção, linha de topo
 * e os marcos de meta.
 *
 * É uma função própria, e não `barras()`, porque `barras()` serve a outros
 * cinco gráficos do sistema e nenhum deles tem projeção, linha de topo nem
 * caixa fixa. Enfiar tudo lá dentro por parâmetro transformaria um desenho
 * simples em quatro desenhos mal resolvidos.
 *
 * `aoClicar(ponto)` recebe o mês; quem liga o detalhamento é o chamador.
 */
/**
 * Os três números do plano, em cards: custo fixo total − meta total = o
 * resultado esperado. A conta fecha na tela, que é o ponto: o gestor confere a
 * subtração com o olho antes de acreditar no verde ou no vermelho.
 */
function cardsDoPlanoHtml({ custo, meta, esperado, atinge, rotulo }) {
  const corFim = atinge === null ? 'var(--tinta3)' : atinge ? 'var(--bomtxt)' : 'var(--crit)';
  const card = (r, v, cor, forte) => `<div class="card-plano${forte ? ' forte' : ''}">
    <span class="card-rot">${esc(r)}</span>
    <strong${cor ? ` style="color:${cor}"` : ''}>${v}</strong></div>`;
  return `<div class="cards-plano"${rotulo ? ` aria-label="${esc(rotulo)}"` : ''}>
    ${card('Custo fixo total', brl(custo))}
    <span class="card-op" aria-hidden="true">−</span>
    ${card('Meta total', brl(meta))}
    <span class="card-op" aria-hidden="true">=</span>
    ${card('Resultado esperado', brl(esperado), corFim, true)}
  </div>`;
}

/**
 * A META CADASTRADA de um mês, aberta pelo ponto cinza do gráfico.
 *
 * O ponto marca o compromisso; clicar nele tem de mostrar o compromisso, e não
 * as despesas do mês — essas continuam a um clique, na barra logo abaixo.
 */
function abrirMetasDoMes(rot, mc) {
  abrirModal({
    titulo: `Meta de redução — ${rot}`,
    tipo: 'meta-do-mes',
    corpo: `
      ${cardsDoPlanoHtml({ ...mc, rotulo: `Custo fixo menos a meta, em ${rot}` })}
      <div class="msg${mc.atinge === null ? '' : mc.atinge ? ' bom' : ' erro'}" style="margin-top:12px">
        <strong>${mc.atinge === null ? 'Mês ainda não apurado.'
          : mc.atinge ? 'Meta alcançada.' : 'Meta não alcançada.'}</strong>
        ${mc.atinge === null
          ? ' É um mês projetado: o custo dele repete o último mês realizado, então não há resultado para julgar.'
          : ` O custo fixo de ${esc(rot)} é ${brl(mc.custo)}, contra o patamar de ${brl(mc.alvoFixo !== undefined ? mc.alvoFixo : mc.esperado)} que o plano pede.`}
      </div>
      <div class="rol" style="margin-top:12px"><table>
        <thead><tr><th>Plano cadastrado</th><th>Tipo de despesa</th><th>Vigência</th>
          <th class="n">Custo no mês</th><th class="n">Meta (cortar)</th><th class="n">Deve chegar a</th></tr></thead>
        <tbody>${mc.metas.map((x) => `<tr>
          <td>${esc(x.nome)}${x.filial ? `<div class="arv-comp">${esc(x.filial)}</div>` : ''}</td>
          <td><i class="ponto-matriz" style="background:${x.cor}" aria-hidden="true"></i>${esc(x.tipo)}</td>
          <td>${esc(x.vigencia)}</td>
          <td class="n"${x.jaCortadoAntes > 0
            ? ` title="${esc(`A despesa custa ${brl(x.custoBruto)} no mês; ${brl(x.jaCortadoAntes)} `
                + 'já são meta de um plano que começa antes, e este parte do que sobra.')}"`
            : ''}>${brl(x.realizado)}${x.jaCortadoAntes > 0
              ? `<div class="arv-comp">de ${brl(x.custoBruto)} − ${brl(x.jaCortadoAntes)}</div>` : ''}</td>
          <td class="n">${brl(x.corte)}</td>
          <td class="n">${brl(x.alvo)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">Total</td><td class="n">${brl(mc.meta)}</td>
          <td class="n">${brl(mc.esperado)}</td></tr></tfoot>
      </table></div>
      <p class="nota" style="margin-top:10px">O valor cadastrado é <strong>quanto cortar</strong>:
        o patamar a atingir é o custo de hoje menos ele. Os planos aparecem em
        <strong>ordem de vigência</strong> e <strong>em cadeia</strong> — quando dois alcançam a
        mesma despesa, o que começa depois parte do patamar que o anterior deixou, e não do
        custo cheio. Cadastro em Sistema › Cadastro › Plano de redução.</p>`,
    acoes: '<button type="button" class="bt" data-c>Fechar</button>',
    aoMontar({ raiz, fechar }) { raiz.querySelector('[data-c]').onclick = fechar; },
  });
}

/**
 * O detalhamento em árvore: TIPO → EMPRESA → FILIAL → LANÇAMENTO.
 *
 * A mesma estrutura da árvore "por unidade" do card, com um nível a mais no
 * topo. Uma lista plana de 122 lançamentos responde "quais são", mas não
 * responde "de onde vem o peso" — e é essa a pergunta de quem clicou numa
 * barra empilhada por tipo. A árvore responde as duas: o nível 1 repete as
 * cores do gráfico, e cada nível abaixo diz o seu peso dentro do nível de cima.
 *
 * Cada nível ordena por valor DECRESCENTE, que é a regra da tela inteira.
 *
 * É montada por inteiro de uma vez, e não sob demanda como a do card: aqui o
 * recorte já é um mês só, e os níveis nascem fechados — o custo de montar é o
 * de percorrer a lista que a tela já tem na mão.
 */
function arvoreDoDetalhamentoHtml(lancamentos, prefixoDoLancamento) {
  if (!lancamentos.length) return '<p class="vazio">Nenhum registro neste recorte.</p>';

  const total = lancamentos.reduce((s, l) => s + cent(l.valor), 0);
  const agrupar = (lista, chave) => {
    const m = new Map();
    for (const l of lista) {
      const k = chave(l);
      if (!m.has(k)) m.set(k, { nome: k, valor: 0, itens: [] });
      const no = m.get(k);
      no.valor += cent(l.valor);
      no.itens.push(l);
    }
    return [...m.values()].sort((a, b) => b.valor - a.valor);
  };

  const barra = (valor, pai, cor, rot) => `<td class="num">${brl(reais(valor))}</td>
    <td>${barraDeRepresentatividadeHtml(pct(valor, pai), cor, rot)}</td>`;

  const linhas = [];
  agrupar(lancamentos, (l) => String(l.tipo || 'Sem tipo')).forEach((t, i) => {
    const cor = corDoTipo(t.nome);
    const nT = `t${i}`;
    linhas.push(`<tr class="nivel-1" data-no="${nT}">
      <td><button type="button" class="arv-abrir" aria-expanded="false" data-abrir-no="${nT}"
            aria-label="Abrir as empresas de ${esc(t.nome)}"><span aria-hidden="true">+</span></button>
        <i class="ponto-matriz" style="background:${cor}" aria-hidden="true"></i>${esc(t.nome)}</td>
      ${barra(t.valor, total, cor, `${t.nome}: ${brl(reais(t.valor))} · ${pctTxt(pct(t.valor, total))} do mês`)}
    </tr>`);

    agrupar(t.itens, (l) => String(nomeEmpresa(l.empresa))).forEach((e, j) => {
      const nE = `${nT}:e${j}`;
      linhas.push(`<tr class="nivel-2" data-no="${nE}" data-pai="${nT}" hidden>
        <td><button type="button" class="arv-abrir" aria-expanded="false" data-abrir-no="${nE}"
              aria-label="Abrir as filiais de ${esc(e.nome)}"><span aria-hidden="true">+</span></button>${esc(e.nome)}</td>
        ${barra(e.valor, t.valor, cor, `${e.nome}: ${brl(reais(e.valor))} · ${pctTxt(pct(e.valor, t.valor))} de ${t.nome}`)}
      </tr>`);

      agrupar(e.itens, (l) => String(l.filial || 'Sem filial (nível empresa)')).forEach((f, k) => {
        const nF = `${nE}:f${k}`;
        linhas.push(`<tr class="nivel-3" data-no="${nF}" data-pai="${nE}" hidden>
          <td><span class="arv-vazio" aria-hidden="true"></span>
            <button type="button" class="arv-abrir" aria-expanded="false" data-abrir-no="${nF}"
              aria-label="Abrir os lançamentos de ${esc(f.nome)}"><span aria-hidden="true">+</span></button>${esc(f.nome)}</td>
          ${barra(f.valor, e.valor, cor, `${f.nome}: ${brl(reais(f.valor))} · ${pctTxt(pct(f.valor, e.valor))} de ${e.nome}`)}
        </tr>`);

        [...f.itens].sort((a, b) => cent(b.valor) - cent(a.valor)).forEach((l) => {
          const c = cent(l.valor);
          const rotulo = l.descricao || l.fornecedor || l.tipo || 'Lançamento';
          linhas.push(`<tr class="nivel-4" data-pai="${nF}"${classeReconhecimento(l)} hidden>
            <td>${prefixoDoLancamento ? prefixoDoLancamento(l) : '<span class="arv-vazio" aria-hidden="true"></span>'}
              <span class="arv-vazio" aria-hidden="true"></span>
              <span class="arv-vazio" aria-hidden="true"></span>${esc(rotulo)}
              <span class="arv-comp">${esc(mesExib(l.competencia))}${
                reconhecidoDe(l) ? '' : ' · por reconhecer'}</span></td>
            ${barra(c, f.valor, cor, `${rotulo}: ${brl(l.valor)} · ${pctTxt(pct(c, f.valor))} de ${f.nome}`
              + (l.fornecedor ? ` · ${l.fornecedor}` : ''))}
          </tr>`);
        });
      });
    });
  });

  return `<div class="rol" data-arvore-det><table class="arvore-unidades larga">
    <thead><tr><th>Tipo / empresa / filial / lançamento</th>
      <th class="num">Valor</th><th>Representatividade</th></tr></thead>
    <tbody>${linhas.join('')}</tbody></table></div>`;
}

/**
 * Liga a árvore do detalhamento. Estado só na tela: uma árvore dentro de um
 * modal que fecha não tem por que sobreviver a ele, e guardar cada nó em
 * `localStorage` encheria a loja de chaves de um recorte que passou.
 */
function ligarArvoreDoDetalhamento(raiz) {
  const tabela = raiz.querySelector('[data-arvore-det] table');
  if (!tabela) return;
  const aplicar = (no, aberto) => {
    const bt = tabela.querySelector(`[data-abrir-no="${CSS.escape(no)}"]`);
    if (bt) {
      bt.setAttribute('aria-expanded', String(aberto));
      bt.firstElementChild.textContent = aberto ? '−' : '+';
    }
    for (const filho of tabela.querySelectorAll(`[data-pai="${CSS.escape(no)}"]`)) {
      filho.hidden = !aberto;
      // Fechar o pai recolhe o que estava aberto abaixo: netos visíveis sob um
      // pai fechado seriam uma árvore mentindo sobre si.
      if (!aberto && filho.dataset.no) aplicar(filho.dataset.no, false);
    }
  };
  for (const bt of tabela.querySelectorAll('[data-abrir-no]')) {
    bt.onclick = (ev) => {
      ev.stopPropagation();
      aplicar(bt.dataset.abrirNo, bt.getAttribute('aria-expanded') !== 'true');
    };
  }
}

/**
 * As despesas fixas de UMA competência, no mesmo recorte que o objetivo usa.
 *
 * Repete os filtros de `calcularPlanoReducao` de propósito — é isso que faz a
 * soma da lista fechar com a altura da barra clicada. Consultar por outro
 * caminho abriria espaço para os dois divergirem sem ninguém perceber.
 */
function fixasDaCompetencia(r, comp) {
  if (!comp) return [];
  return Loja.todosDoEscopo().filter((l) =>
    l.natureza === 'fixa' && l.competencia === comp &&
    passaNoFiltro(E.cenariosSel, l.cenario) && naFilialDoBloco(l.filial, r));
}

function barrasDoObjetivo(alvo, dados, aoClicar) {
  alvo.replaceChildren();
  const { series, pontos } = dados;
  if (!pontos.length) { alvo.innerHTML = '<p class="vazio">Sem despesa fixa na vigência da meta.</p>'; return; }

  const marcos = dados.marcos || new Map();
  const L = 700, ALT = 30, LARG_CAIXA = 176, VAO = 4;
  const mE = 80, mD = 12, lp = L - mE - mD;
  const passo = lp / Math.max(pontos.length, 1);
  const cx = (i) => mE + passo * (i + 0.5);

  // As caixas fixas são posicionadas ANTES de o resto do desenho existir,
  // porque é o número de níveis delas que decide a altura do gráfico. Cada
  // caixa recebe o nível mais alto em que ela não encosta em nenhuma vizinha —
  // empilhar por ordem de chegada, como eu fazia, deixava sete caixas em cima
  // umas das outras e escondia justamente as barras.
  //
  // Mês PROJETADO não ganha caixa fixa: um plano sem fim de vigência cobre
  // todos eles, e dezesseis caixas dizendo "a apurar" cobririam o gráfico para
  // não informar nada. O ponto cinza continua lá, e o balão traz a meta.
  const planejadas = [];
  pontos.forEach((p, i) => {
    if (p.projetado || !marcos.has(p.comp)) return;
    planejadas.push({ i, p, mc: marcos.get(p.comp),
      x: Math.max(0, Math.min(L - mD - LARG_CAIXA, cx(i) - LARG_CAIXA / 2)) });
  });
  planejadas.sort((a, b) => a.x - b.x);
  const niveis = [];
  for (const c of planejadas) {
    let n = 0;
    while (niveis[n] && niveis[n] > c.x - VAO) n++;
    niveis[n] = c.x + LARG_CAIXA;
    c.nivel = n;
  }

  const alturaCaixas = niveis.length ? niveis.length * (ALT + VAO) + 12 : 14;
  const A = 236 + alturaCaixas + 24, m = { t: alturaCaixas, d: mD, b: 48, e: mE };
  const ap = A - m.t - m.b;
  const max = Math.max(0, ...pontos.map((p) => series.reduce((s, x) => s + (p.v[x.k] || 0), 0)));
  const { teto, marcas } = escalaBoa(max);
  const y = (v) => m.t + ap - (v / teto) * ap;
  const larg = Math.min(passo * 0.62, 34);

  const svg = svgEl('svg', { viewBox: `0 0 ${L} ${A}`, role: 'img',
    'aria-label': `Custo fixo mês a mês por tipo de despesa, ${pontos.length} meses`
      + (planejadas.length ? ', com os meses que têm plano de redução marcados' : '') });

  // A hachura que marca a projeção. A opacidade sozinha não serve como canal:
  // quem não distingue tons claros não veria diferença nenhuma entre realizado
  // e projetado, e a diferença entre os dois é o ponto.
  const defs = svgEl('defs', {});
  const hach = svgEl('pattern', { id: 'hachura-proj', width: 6, height: 6,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  hach.appendChild(svgEl('rect', { width: 6, height: 6, fill: 'var(--sup)', 'fill-opacity': 0.34 }));
  hach.appendChild(svgEl('rect', { width: 1.6, height: 6, fill: 'var(--sup)', 'fill-opacity': 0.85 }));
  defs.appendChild(hach);
  svg.appendChild(defs);

  for (const mk of marcas) {
    svg.appendChild(svgEl('line', { x1: m.e, x2: L - m.d, y1: y(mk), y2: y(mk),
      stroke: mk === 0 ? 'var(--linha2)' : 'var(--linha)', 'stroke-width': 1 }));
    const t = svgEl('text', { x: m.e - 8, y: y(mk) + 3.5, 'text-anchor': 'end', class: 'eixo' });
    t.textContent = curto(mk);
    svg.appendChild(t);
  }

  const balao = (p) => [
    ...series
      .filter((s) => (p.v[s.k] || 0) > 0)       // tipo zerado não vira linha: procurar-se-ia uma despesa que não existe
      .sort((a, b) => (p.v[b.k] || 0) - (p.v[a.k] || 0))
      .map((s) => ({ nome: s.nome, cor: s.cor, valor: brl(p.v[s.k] || 0) })),
    { nome: p.projetado ? 'Total projetado' : 'Total do mês', valor: brl(p.total) },
    ...(!marcos.has(p.comp) ? [] : (() => {
      const mc = marcos.get(p.comp);
      return [
        { nome: 'Meta total do plano', valor: brl(mc.meta) },
        { nome: 'Resultado esperado', valor: brl(mc.esperado),
          cor: mc.atinge === null ? 'var(--tinta3)' : mc.atinge ? 'var(--bom)' : 'var(--crit)' },
        ...mc.metas.map((x) => ({ nome: `· ${x.tipo}`, cor: x.cor,
          valor: `cortar ${brl(x.corte)}` })),
        { nome: 'Clique no ponto', valor: 'ver a meta cadastrada' },
      ];
    })()),
  ];

  pontos.forEach((p, i) => {
    const g = svgEl('g', {});
    let acc = 0;
    for (const s of series) {
      const v = p.v[s.k] || 0, base = acc; acc += v;
      // 1px de vão e canto RETO: no empilhado o topo arredondado faz cada
      // faixa parecer um objeto solto, e 2px de vão separavam demais cores que
      // formam um valor só.
      const topo = y(acc), alt = Math.max(y(base) - topo - 1, 0);
      if (alt <= 0) continue;
      const d = pathBarra(cx(i) - larg / 2, topo, larg, alt, 0);
      g.appendChild(svgEl('path', { d, fill: s.cor,
        'fill-opacity': p.projetado ? 0.55 : 1 }));
      if (p.projetado) g.appendChild(svgEl('path', { d, fill: 'url(#hachura-proj)' }));
    }
    // A área de captura por ÚLTIMO, para ficar por cima dos segmentos: embaixo
    // deles, uma barra alta a cobre inteira e o ponteiro nunca a alcança.
    g.appendChild(svgEl('rect', { x: cx(i) - passo / 2, y: m.t, width: passo, height: ap, fill: 'transparent' }));

    const titulo = p.rot + (p.projetado ? ' · projetado' : '');
    // `stopPropagation` porque o `.kpi` que embrulha o gráfico tem o próprio
    // `mousemove` (a dica do indicador, posta por `ligarKpis`): sendo ancestral,
    // ele dispara DEPOIS e sobrescreveria o balão do mês pelo do card inteiro.
    g.addEventListener('mousemove', (ev) => { ev.stopPropagation(); mostrarDica(ev, titulo, balao(p)); });
    g.addEventListener('mouseleave', sumirDica);
    if (aoClicar && p.total > 0) {
      g.style.cursor = 'pointer';
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${titulo}: ${brl(p.total)} — abrir os lançamentos deste mês`);
      // `stopPropagation` pela mesma razão do balão: o `.kpi` que embrulha o
      // gráfico também é um gatilho de drill-down, e sem isto um clique na
      // barra abria DUAS telas empilhadas — a do mês e a do card inteiro.
      const abrir = (ev) => { ev.stopPropagation(); sumirDica(); aoClicar(p); };
      g.addEventListener('click', abrir);
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(ev); }
      });
      // O foco de teclado abre o mesmo balão, posicionado pelo retângulo do
      // elemento — é a regra que vale para todo gatilho do sistema.
      g.addEventListener('focus', () => {
        const r = g.getBoundingClientRect();
        mostrarDica({ clientX: r.left + r.width / 2, clientY: r.top + 12 }, titulo, balao(p));
      });
      g.addEventListener('blur', sumirDica);
    }
    svg.appendChild(g);
    // Inclinado a 80°, CADA barra ganha o seu rótulo. Na horizontal, com 24
    // meses, só cabia um a cada dois — e metade das barras ficava sem dizer de
    // que mês era.
    // A âncora fica logo ABAIXO do eixo, e não na borda de baixo: com
    // `text-anchor:end` e -80°, o texto se estende para baixo e para a
    // esquerda da âncora — ancorado na borda, ele caía fora do desenho e só
    // sobrava o último caractere.
    const t = svgEl('text', { x: 0, y: 0, 'text-anchor': 'end', class: 'eixo',
      transform: `translate(${cx(i) + 3},${A - m.b + 9}) rotate(-80)` });
    t.textContent = p.rot;
    svg.appendChild(t);
  });

  // A LINHA DE TOPO: liga o alto de cada barra, realizada e projetada. Ela não
  // repete a altura da barra — o que ela mostra é a TENDÊNCIA, que num
  // empilhado com sete cores some no meio dos segmentos.
  const topoY = (p) => y(series.reduce((s, x) => s + (p.v[x.k] || 0), 0));
  svg.appendChild(svgEl('path', {
    d: pontos.map((p, i) => `${i ? 'L' : 'M'}${cx(i)},${topoY(p)}`).join(' '),
    fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  const alturaPonto = new Map();
  pontos.forEach((p, i) => {
    const lista = marcos.get(p.comp);
    const py = topoY(p);
    alturaPonto.set(p.comp, py);
    // O ponto: AZUL quando o mês não tem compromisso; CINZA quando tem e ainda
    // não dá para julgar (mês projetado); VERDE ou VERMELHO quando dá.
    const cor = !lista ? 'var(--s1)'
      : lista.atinge === null ? 'var(--tinta3)'
        : lista.atinge ? 'var(--bom)' : 'var(--crit)';
    // O PONTO DE UM MÊS COM META abre a META CADASTRADA, e não os lançamentos
    // do mês: quem clica no marcador do compromisso quer ver o compromisso.
    // Os lançamentos continuam a um clique — na barra, logo abaixo.
    const ponto = svgEl('circle', { cx: cx(i), cy: py, r: lista ? 5 : 3,
      fill: cor, stroke: 'var(--sup)', 'stroke-width': 1.5 });
    if (aoClicar && p.total > 0) {
      ponto.style.cursor = 'pointer';
      ponto.setAttribute('role', 'button');
      ponto.setAttribute('tabindex', '0');
      ponto.setAttribute('aria-label', lista
        ? `${p.rot}: abrir a meta cadastrada deste mês`
        : `${p.rot}${p.projetado ? ' (projetado)' : ''}: ${brl(p.total)} — abrir os lançamentos deste mês`);
      const abrir = (ev) => { ev.stopPropagation(); sumirDica(); aoClicar(p, lista ? 'meta' : 'lancamentos'); };
      ponto.addEventListener('click', abrir);
      ponto.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(ev); }
      });
    }
    svg.appendChild(ponto);
  });

  // As caixas fixas, na faixa reservada no topo, cada uma no nível calculado
  // lá em cima. Uma por MÊS com plano — e não uma por meta, que é o que antes
  // enchia a faixa de caixas repetindo o mesmo mês. A haste tracejada liga a
  // caixa ao ponto dela: com várias na tela, sem a haste não se sabe de que
  // mês cada uma fala.
  //
  // Dentro dela vão os TRÊS NÚMEROS — custo fixo, meta e resultado esperado —,
  // os mesmos dos cards do topo do card. É o balão fixo que o gestor pediu.
  for (const c of planejadas) {
    const mc = c.mc;
    const yy = 6 + c.nivel * (ALT + VAO);
    const corC = mc.atinge === null ? 'var(--tinta3)' : mc.atinge ? 'var(--bom)' : 'var(--crit)';
    const simbolo = mc.atinge === null ? '\u00b7' : mc.atinge ? '\u2713' : '\u2717';
    const tipos = mc.metas.map((x) => x.tipo).join(', ');
    const dica = `${c.p.rot} \u2014 custo fixo ${brl(mc.custo)} menos a meta de ${brl(mc.meta)} `
      + `d\u00e1 o resultado esperado de ${brl(mc.esperado)}. A reduzir: ${tipos}. `
      + (mc.atinge === null ? 'M\u00eas ainda n\u00e3o apurado.'
        : mc.atinge ? 'Meta alcan\u00e7ada.' : 'Meta n\u00e3o alcan\u00e7ada.')
      + ' Clique no ponto para ver a meta cadastrada.';

    const gc = svgEl('g', { class: 'caixa-meta' });
    gc.appendChild(svgEl('line', { x1: cx(c.i), x2: cx(c.i), y1: yy + ALT,
      y2: alturaPonto.get(c.p.comp) - 6,
      stroke: corC, 'stroke-width': 1, 'stroke-dasharray': '2 2', opacity: 0.55 }));
    gc.appendChild(svgEl('rect', { x: c.x, y: yy, width: LARG_CAIXA, height: ALT, rx: 5,
      fill: 'var(--sup)', stroke: corC, 'stroke-width': 1.2 }));
    // Faixa de cor à esquerda: o estado se lê antes de a pessoa ler o texto.
    gc.appendChild(svgEl('rect', { x: c.x, y: yy, width: 3, height: ALT,
      fill: corC, rx: 1.5 }));

    const l1 = svgEl('text', { x: c.x + 9, y: yy + 12, class: 'rot-meta', fill: corC });
    l1.textContent = `${simbolo} ${c.p.rot}`;
    gc.appendChild(l1);
    // Sem o "R$" repetido três vezes: ele não cabe na caixa e não acrescenta
    // nada — a coluna toda é dinheiro, e o balão e a tela da meta trazem o
    // valor por extenso.
    const semMoeda = (v) => curto(v).replace('R$ ', '');
    const l2 = svgEl('text', { x: c.x + 9, y: yy + 24, class: 'rot-meta-nums' });
    l2.textContent = `${semMoeda(mc.custo)} \u2212 ${semMoeda(mc.meta)} = ${semMoeda(mc.esperado)}`;
    gc.appendChild(l2);

    gc.appendChild(svgEl('title', {})).textContent = dica;
    gc.setAttribute('aria-label', dica);
    svg.appendChild(gc);
  }

  alvo.appendChild(svg);
}

function composicaoDoCustoFixo(base, meses, referencia, planos) {
  const OUTROS = 'Outros';
  const rotulo = (l) => {
    const nome = String(l.tipo || '').trim() || 'Sem tipo';
    return corDoTipo(nome) === 'var(--tinta3)' ? OUTROS : nome;
  };

  // centavos[tipo][competência]
  const porTipo = new Map();
  for (const l of base) {
    const t = rotulo(l);
    if (!porTipo.has(t)) porTipo.set(t, new Map());
    const m = porTipo.get(t);
    m.set(l.competencia, (m.get(l.competencia) || 0) + cent(l.valor));
  }

  const pesoNaReferencia = (t) => (porTipo.get(t).get(referencia) || 0);
  const vaga = (t) => (t === OUTROS ? -1 : ordemDosTipos().indexOf(t));
  const nomes = [...porTipo.keys()].sort((a, b) => vaga(a) - vaga(b));

  const series = nomes.map((nome) => ({
    k: nome, nome,
    cor: nome === OUTROS ? 'var(--tinta3)' : corDoTipo(nome),
    total: reais([...porTipo.get(nome).values()].reduce((s, c) => s + c, 0)),
    naReferencia: reais(pesoNaReferencia(nome)),
  }));

  // A COMPOSIÇÃO DO MÊS DE REFERÊNCIA, que é o molde das barras projetadas:
  // "as barras futuras são projetadas com base nas despesas fixas do último
  // mês". Repetir a composição inteira, e não só o total, é o que permite a
  // barra projetada manter as mesmas cores da realizada.
  const doRef = {};
  for (const nome of nomes) doRef[nome] = pesoNaReferencia(nome);

  const pontos = meses.map((m) => {
    // Depois do mês de referência, a barra é PROJEÇÃO. Os lançamentos futuros
    // que já existem na base (parcelas e projeções cadastradas) são deliberada-
    // mente ignorados aqui: o que este objetivo pergunta é "se nada mudar, o
    // custo fixo de hoje continua assim?" — e é o custo de hoje, repetido, que
    // responde. Quem quer ver o que já está lançado no futuro tem o indicador
    // "Custo recorrente mês a mês", que mostra exatamente isso.
    const projetado = !!referencia && m > referencia;
    const v = {};
    let totalC = 0;
    for (const nome of nomes) {
      const c = projetado ? (doRef[nome] || 0) : (porTipo.get(nome).get(m) || 0);
      v[nome] = reais(c);
      totalC += c;
    }
    return { comp: m, rot: mesExib(m), v, total: reais(totalC), centavos: totalC, projetado };
  });

  return { series, pontos, referencia, marcos: marcosDeMeta(pontos, porTipo, planos, referencia) };
}

/**
 * Os marcos de meta por mês: o que o ponto da linha azul anuncia.
 *
 * Um marco é um **plano de redução vigente naquele mês**, porque é o plano que
 * sabe QUAL tipo de despesa deve cair e para quanto — a meta de `metas` é um
 * percentual de variação do custo fixo inteiro, e não nomeia despesa nenhuma.
 * É por isso que a caixa fixa sai do plano e não da meta.
 *
 * Três estados, e o terceiro é o que evita uma mentira: mês **futuro** não tem
 * realizado, então não é verde nem vermelho — é "a apurar". Pintar de verde um
 * mês que ainda não aconteceu afirmaria um resultado inventado.
 */
function marcosDeMeta(pontos, porTipo, planos, referencia) {
  const vigenteEm = (p, m) =>
    (!p.vigenciaInicio || p.vigenciaInicio <= m) && (!p.vigenciaFim || p.vigenciaFim >= m);

  const marcos = new Map();
  for (const pt of pontos) {
    const doMes = (planos || []).filter((p) => vigenteEm(p, pt.comp));
    if (!doMes.length) continue;
    // Num mês projetado o realizado é o do mês de referência, repetido — é a
    // mesma barra, então tem de ser o mesmo número.
    const chave = pt.projetado ? referencia : pt.comp;

    // Em cadeia e em ordem cronológica, pela mesma razão da tabela do item: um
    // plano que começa depois parte do patamar que o anterior deixou, não do
    // custo cheio. Ver `planosEmCadeia`.
    const metas = planosEmCadeia(doMes).map(({ plano: p, jaCortado }) => {
      const tipo = String(p.tipo || '').trim();
      const serie = tipo ? porTipo.get(tipo) : null;
      const bruto = tipo
        ? (serie ? (serie.get(chave) || 0) : 0)
        : Math.round(pt.total * 100);
      const realizadoC = Math.max(0, bruto - jaCortado);
      const corteC = cent(p.valorAlvo);
      return {
        nome: p.nome, tipo: tipo || 'todo o custo fixo',
        cor: tipo ? corDoTipo(tipo) : 'var(--tinta3)',
        corte: reais(corteC), realizado: reais(realizadoC),
        custoBruto: reais(bruto), jaCortadoAntes: reais(jaCortado),
        alvo: reais(Math.max(0, realizadoC - corteC)),
        vigencia: vigenciaEmTexto(p),
        filial: p.filial || null,
      };
    });

    // OS TRÊS NÚMEROS DO MÊS, os mesmos dos cards do topo: custo fixo total,
    // meta total e o resultado esperado. É isso que a caixa fixa anuncia.
    const custoC = Math.round(pt.total * 100);
    const metaC = metas.reduce((s, x) => s + cent(x.corte), 0);
    marcos.set(pt.comp, {
      metas,
      custo: pt.total,
      meta: reais(metaC),
      esperado: reais(Math.max(0, custoC - metaC)),
      projetado: pt.projetado,
      // `null` = a apurar. É o estado dos meses que ainda não aconteceram.
      atinge: pt.projetado ? null : custoC > 0 && metaC > 0 && custoC <= Math.max(0, custoC - metaC),
    });
  }

  // O VEREDICTO de cada mês realizado: o custo fixo dele já está no patamar que
  // o plano pede? O patamar de referência é o do PRIMEIRO mês com plano — um
  // alvo tirado do próprio mês seria o número comparado consigo mesmo.
  const realizados = pontos.filter((x) => !x.projetado && marcos.has(x.comp));
  if (realizados.length) {
    const primeiro = realizados[0];
    const alvoFixo = Math.max(0, Math.round(primeiro.total * 100) - cent(marcos.get(primeiro.comp).meta));
    for (const pt of pontos) {
      const m = marcos.get(pt.comp);
      if (!m) continue;
      m.alvoFixo = reais(alvoFixo);
      m.atinge = pt.projetado ? null : Math.round(pt.total * 100) <= alvoFixo;
    }
  }
  return marcos;
}

/**
 * A meta de Financeiro medida na janela do objetivo.
 *
 * Mesma conta de `metaDoCustoRecorrente` — a variação do custo recorrente mês a
 * mês contra o teto cadastrado —, só que sobre a janela da meta em vez da do
 * filtro. Sem isso, o semáforo do objetivo mudaria de cor quando alguém mexesse
 * no período para olhar outro indicador.
 */
function metaNaJanelaDoObjetivo(r, janela) {
  const porMes = new Map();
  for (const l of Loja.todosDoEscopo()) {
    if (l.natureza !== 'fixa') continue;
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (janela.de && l.competencia < janela.de) continue;
    if (janela.ate && l.competencia > janela.ate) continue;
    porMes.set(l.competencia, (porMes.get(l.competencia) || 0) + cent(l.valor));
  }
  const meses = ordenado([...porMes.keys()]);
  const pontos = meses.map((m, i) => {
    const anterior = i > 0 ? porMes.get(meses[i - 1]) : null;
    const c = porMes.get(m);
    return { comp: m,
      valor: anterior === null || anterior === 0 ? null : Math.round(((c - anterior) / anterior) * 1000) / 10 };
  });
  const primeiro = meses.length ? porMes.get(meses[0]) : 0;
  const ultimo = meses.length ? porMes.get(meses[meses.length - 1]) : 0;
  const total = meses.length < 2 || primeiro === 0
    ? null : Math.round(((ultimo - primeiro) / primeiro) * 1000) / 10;
  return leituraMensalDeMeta('financeiro', pontos, total);
}

/**
 * Despesa PAGA por uma unidade e CONSUMIDA por outras.
 *
 * **Não há rateio.** O lançamento compartilhado conta pelo valor INTEGRAL da
 * pagadora, e a tabela lista QUEM se beneficia sem atribuir número por filial.
 * Dividir exigiria um critério que ninguém definiu, e um número inventado é
 * pior que um número ausente — por isso as beneficiadas saem como nomes.
 */
function calcularConsumo(r) {
  let total = 0, centralizado = 0, lancamentos = 0;
  const porUnidade = new Map();
  for (const l of Loja.todosDoEscopo()) {
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (!naJanela(l.competencia, r)) continue;
    const c = cent(l.valor);
    total += c;
    const chave = l.empresa + '|' + (l.filial || '');
    const atual = porUnidade.get(chave)
      || { empresa: l.empresa, filial: l.filial || null, centralizado: 0, total: 0, lancamentos: 0, beneficiadas: new Set() };
    atual.total += c;
    if (consumoDe(l) === 'compartilhado') {
      atual.centralizado += c;
      atual.lancamentos += 1;
      centralizado += c;
      lancamentos += 1;
      for (const n of beneficiadasDe(l)) atual.beneficiadas.add(n);
    }
    porUnidade.set(chave, atual);
  }
  const linhas = [...porUnidade.values()]
    .filter((u) => u.centralizado > 0)
    .map((u) => ({
      empresa: u.empresa,
      filial: u.filial,
      unidade: u.filial || nomeEmpresa(u.empresa),
      valor: reais(u.centralizado),
      totalUnidade: reais(u.total),
      pctDaUnidade: u.total ? Math.round((u.centralizado / u.total) * 1000) / 10 : 0,
      lancamentos: u.lancamentos,
      beneficiadas: [...u.beneficiadas].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    }))
    .sort((a, b) => b.valor - a.valor);
  return {
    total: reais(total),
    centralizado: reais(centralizado),
    pct: total ? Math.round((centralizado / total) * 1000) / 10 : 0,
    lancamentos,
    linhas,
  };
}

/**
 * Equilíbrio de despesas, mês a mês.
 *
 * O percentual do gasto que uma unidade paga e outras consomem. A meta é TETO:
 * passar dela é o problema, ao contrário do SLA, onde subir é bom.
 *
 * A série vem completa: um mês sem lançamento entra como zero explícito. Uma
 * linha que pula de março para maio faz parecer que abril não existiu, quando
 * o que houve foi abril sem despesa centralizada — que é informação.
 */
function calcularEquilibrio(r) {
  const porMes = new Map();
  for (const l of Loja.todosDoEscopo()) {
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (!naJanela(l.competencia, r)) continue;
    const atual = porMes.get(l.competencia) || { total: 0, centralizado: 0 };
    const c = cent(l.valor);
    atual.total += c;
    if (consumoDe(l) === 'compartilhado') atual.centralizado += c;
    porMes.set(l.competencia, atual);
  }
  const meses = ordenado([...porMes.keys()]);
  const cheia = meses.length ? intervalo(meses[0], meses[meses.length - 1]) : [];
  const serie = cheia.map((m) => {
    const x = porMes.get(m) || { total: 0, centralizado: 0 };
    return {
      comp: m, rot: mesExib(m),
      total: reais(x.total), centralizado: reais(x.centralizado),
      pct: x.total ? Math.round((x.centralizado / x.total) * 1000) / 10 : 0,
    };
  });
  const atual = serie.length ? serie[serie.length - 1] : null;
  const anterior = serie.length > 1 ? serie[serie.length - 2] : null;
  const meta = alvoDe('equilibrio', atual ? atual.comp : null);
  return {
    serie, atual, anterior,
    // Pontos percentuais: de 10% para 12% são +2 p.p., e chamar isso de +20%
    // confundiria duas grandezas diferentes.
    variacaoPp: atual && anterior ? Math.round((atual.pct - anterior.pct) * 10) / 10 : null,
    leitura: leituraDeMeta(meta, atual ? atual.pct : null, 'equilibrio'),
  };
}

/**
 * Entrega de tarefas na competência.
 *
 * O denominador do "no prazo" é o que foi ENTREGUE: uma tarefa ainda em aberto
 * não está fora do prazo enquanto o mês planejado não passou. A cancelada fica
 * de fora das duas contas — não foi entregue nem está pendente.
 */
function calcularProjetos(r) {
  let entregues = 0, noPrazo = 0, pendentes = 0, atrasadas = 0, canceladas = 0, total = 0;
  const hoje = mesHoje();
  // Por competência de entrega planejada — a mesma que a janela do bloco usa —,
  // para a meta poder ser medida mês a mês quando o recorte cruza vigências.
  const porMes = new Map();
  for (const e of escopoEmpresas()) {
    for (const p of (E.projetos.get(e) || [])) {
      if (!naFilialDoBloco(p.filial, r)) continue;
      for (const t of (p.tarefas || [])) {
        if (!naJanela(t.fimPlanejado, r)) continue;
        total += 1;
        if (t.status === 'cancelada') { canceladas += 1; continue; }
        if (t.status === 'concluida' && t.fimReal) {
          entregues += 1;
          const mes = porMes.get(t.fimPlanejado) || { entregues: 0, noPrazo: 0 };
          mes.entregues += 1;
          if (t.fimReal <= t.fimPlanejado) { noPrazo += 1; mes.noPrazo += 1; }
          porMes.set(t.fimPlanejado, mes);
        } else {
          pendentes += 1;
          if (t.fimPlanejado < hoje) atrasadas += 1;
        }
      }
    }
  }
  const pct = entregues ? Math.round((noPrazo / entregues) * 1000) / 10 : 0;
  const serie = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([comp, m]) => ({ comp, valor: m.entregues ? Math.round((m.noPrazo / m.entregues) * 1000) / 10 : null }));
  return {
    total, entregues, noPrazo, foraDoPrazo: entregues - noPrazo, canceladas, pendentes, atrasadas, pct, serie,
    // O 80 que pintava este card era um número solto, sem constante e sem dono.
    // Agora sai do mesmo cadastro que rege o SLA.
    meta: alvoDe('projetos', mesDoRecorte(r)),
    leitura: leituraMensalDeMeta('projetos', serie, entregues ? pct : null),
  };
}

// -------------------------------------------------------------- desenho
/**
 * Termômetro: preenchimento proporcional ao percentual, com o marcador da meta.
 *
 * A cor carrega a severidade, mas nunca sozinha — o número e a palavra estão
 * ao lado, e a meta vem rotulada sobre o próprio traço. A trilha não pintada é
 * um tom fraco da mesma escala, para o estado se ler na barra inteira.
 */
function termometro(alvo, pct, meta, rotulo) {
  alvo.replaceChildren();
  const L = 700, A = 74, m = { e: 8, d: 8, t: 26 }, lp = L - m.e - m.d, alt = 22;
  const cor = pct >= meta ? 'var(--bom)' : pct >= meta - 10 ? 'var(--alerta)' : 'var(--crit)';
  const svg = svgEl('svg', { viewBox: `0 0 ${L} ${A}`, role: 'img',
    'aria-label': `${rotulo}: ${pct}% contra a meta de ${meta}%` });

  svg.appendChild(svgEl('rect', { x: m.e, y: m.t, width: lp, height: alt, rx: 6,
    fill: 'color-mix(in srgb, var(--tinta3) 16%, transparent)' }));
  const cheio = Math.max(0, Math.min(100, pct)) / 100 * lp;
  if (cheio > 0) {
    svg.appendChild(svgEl('path', { d: pathBarra(m.e, m.t, cheio, alt, 6), fill: cor }));
  }

  // Marcador da meta: traço de ponta a ponta da barra, rotulado. Uma linha sem
  // rótulo viraria decoração — e é justamente o número que decide a leitura.
  const xm = m.e + (meta / 100) * lp;
  svg.appendChild(svgEl('line', { x1: xm, x2: xm, y1: m.t - 6, y2: m.t + alt + 6,
    stroke: 'var(--tinta)', 'stroke-width': 2 }));
  const rot = svgEl('text', { x: xm, y: m.t - 11, 'text-anchor': 'middle', class: 'eixo' });
  rot.textContent = `meta ${meta}%`;
  svg.appendChild(rot);

  const valor = svgEl('text', { x: m.e + 10, y: m.t + alt + 18, class: 'eixo' });
  valor.textContent = '0%';
  svg.appendChild(valor);
  const fim = svgEl('text', { x: L - m.d - 10, y: m.t + alt + 18, 'text-anchor': 'end', class: 'eixo' });
  fim.textContent = '100%';
  svg.appendChild(fim);
  alvo.appendChild(svg);
}

/** Filtros do bloco: período próprio e filiais próprias, nada global. */
function filtrosDoBloco(bloco, r) {
  return `<div class="filtros" style="box-shadow:none;border:0;padding:0;margin-bottom:14px">
      <div class="campo" style="width:118px"><label for="i-${bloco}-de">De</label>
        <input id="i-${bloco}-de" value="${r.de ? mesExib(r.de) : ''}" placeholder="MM/AAAA"></div>
      <div class="campo" style="width:118px"><label for="i-${bloco}-ate">Até</label>
        <input id="i-${bloco}-ate" value="${r.ate ? mesExib(r.ate) : ''}" placeholder="MM/AAAA"></div>
      <div class="campo" style="min-width:190px"><label>Filial</label>
        <div data-sel="i-${bloco}-filial"></div></div>
      ${bloco === 'financeiro' ? `
      <div class="campo" style="min-width:230px"><label for="i-rec">Despesas consideradas</label>
        <select id="i-rec">
          <option value="tudo"${r.somenteReconhecidas ? '' : ' selected'}>Ver tudo</option>
          <option value="rec"${r.somenteReconhecidas ? ' selected' : ''}>Apenas reconhecidas</option>
        </select></div>` : ''}
      <button class="bt fant" data-limpar="${bloco}">${bloco === 'financeiro'
        ? 'Voltar ao período padrão' : 'Limpar filtros do bloco'}</button>
    </div>`;
}

/**
 * Como os custos são classificados — a legenda fixa do bloco Financeiro.
 *
 * Fica ACIMA dos indicadores porque é a chave de leitura de todos eles: sem
 * saber o que conta como fixa, variável e investimento, "variação do custo
 * recorrente" é um número sem régua. O link abre em aba nova, com `noopener`.
 */
function caixaDeCategorizacaoHtml() {
  const fonte = 'https://razonet.com.br/contabilidade-digital/diferenca-custo-despesa-investimento';
  return `<div class="msg caixa-categorias" style="margin-bottom:14px">
    <strong>Como classificamos os custos:</strong>
    <ol class="lista-categorias">
      <li>Custos com <strong>Despesas Fixas</strong> (Mensais)</li>
      <li>Custos com <strong>Despesas Variáveis</strong> (Pontuais)</li>
      <li>Custos com <strong>Investimentos</strong></li>
    </ol>
    <a href="${fonte}" target="_blank" rel="noopener noreferrer">Saiba mais sobre custo, despesa e investimento</a>
  </div>`;
}

/**
 * Um indicador da tela: um bloco de largura inteira, com o número no
 * cabeçalho.
 *
 * Antes eram seis cartões em faixas de dois, lado a lado. Ler dois números
 * concorrentes na mesma linha é o que o cliente reclamou, e com o corpo de
 * cada um (faixa, legenda, árvore) a faixa dupla ficava ilegível. Agora cada
 * indicador ocupa a linha inteira.
 *
 * O bloco é `section.bloco` com `<h2>`, e é só isso que ele precisa ser:
 * `dobrarBlocos` o converte em acordeão fechado, com `aria-expanded`, seta
 * `+/−` e memória entre visitas. O valor vai no cabeçalho — é o que o
 * enunciado chama de "cabeçalho fixo: título, valor principal e estado".
 */
function blocoIndicador({ chave, titulo, descricao, valor, cor, apoio, corpo, nota }) {
  return `
    <section class="bloco bloco-indicador" style="margin-top:14px">
      <header><h2>${esc(titulo)}</h2>
        <span class="nota valor-cabecalho"${cor ? ` style="color:${cor}"` : ''}>${valor}</span>
        ${descricao ? `<p class="descricao-indicador">${esc(descricao)}</p>` : ''}</header>
      <div class="kpi kpi-largo" data-kpi="${esc(chave)}">
        <span class="r">${esc(titulo)}</span>
        <span class="n"${cor ? ` style="color:${cor}"` : ''}>${valor}</span>
        ${apoio ? `<span class="a">${apoio}</span>` : ''}
        ${corpo || ''}
      </div>
      ${nota ? `<p class="nota" style="margin-top:10px">${nota}</p>` : ''}
    </section>`;
}

/** A barra dupla do comparativo antes → depois. Mesma escala nas duas. */
function barrasComparativasHtml(antes, depois, corAntes, corDepois, teto, detalhe) {
  const largura = (v) => (teto > 0 ? Math.max(0, Math.min(100, (v / teto) * 100)) : 0);
  return `<span class="comparativo"${detalhe ? ` data-dica="${esc(JSON.stringify(detalhe))}"` : ''}>
    <span class="comparativo-linha"><b>antes</b>
      <span aria-hidden="true"><i style="width:${largura(antes)}%;background:${corAntes}"></i></span>
      <var>${brl(antes)}</var></span>
    <span class="comparativo-linha"><b>depois</b>
      <span aria-hidden="true"><i style="width:${largura(depois)}%;background:${corDepois}"></i></span>
      <var>${brl(depois)}</var></span>
  </span>`;
}

async function viewIndicadores() {
  await Loja.configuracao();
  for (const e of escopoEmpresas()) { await Loja.slaDa(e); await Loja.projetosDa(e); }

  const rf = recorteDoBloco('financeiro');
  const rs = recorteDoBloco('sla');
  const rp = recorteDoBloco('projetos');
  const reducao = calcularReducao(rf);
  const consumo = calcularConsumo(rf);
  const equilibrio = calcularEquilibrio(rf);
  const pendente = calcularPorReconhecer(rf);
  const sla = calcularSla(rs);
  const proj = calcularProjetos(rp);
  const rateio = calcularRateio(rf);
  const adequacao = calcularAdequacao(rf);
  const farol = calcularFarolCustos(rf);
  const plano = calcularPlanoReducao(rf);

  // As quebras por unidade saem dos MESMOS registros que os cálculos acima
  // percorrem — é isso que garante que a soma da árvore seja o número do card.
  const emDinheiro = (v) => brl(reais(v));
  const naoReconhecidos = Loja.todosDoEscopo().filter((l) =>
    passaNoFiltro(E.cenariosSel, l.cenario) && naFilialDoBloco(l.filial, rf) &&
    naJanela(l.competencia, rf) && !reconhecidoDe(l));
  const tickets = ticketsDoRecorte(rs);
  const q = {
    fixos: quebrarPorUnidade(fixosDoRecorte(rf), (l) => cent(l.valor)),
    pendentes: quebrarPorUnidade(naoReconhecidos, (l) => cent(l.valor)),
    sla: quebraDeSla(tickets, sla.meta),
    entregues: quebrarPorUnidade(tarefasDoRecorte(rp, 'entregues'), () => 1),
    tarefasPendentes: quebrarPorUnidade(tarefasDoRecorte(rp, 'pendentes'), () => 1),
  };
  // No SLA, o que a filial "vale" para a faixa é o volume de atendimento: uma
  // filial com 2 chamados não pode ocupar o mesmo espaço de uma com 2000.
  const extraSla = {
    coluna: 'Chamados',
    colunaExtra: 'Conformidade',
    matriz: (m) => rotuloConformidade(m),
    filial: (f) => rotuloConformidade(f),
  };
  const semExtra = { coluna: 'Tarefas', colunaExtra: '', matriz: () => '', filial: () => '' };

  // A seta e a palavra da tendência subiram para `SETA_TENDENCIA` e
  // `PALAVRA_TENDENCIA`: `rotuloVariacao` também precisa delas, e duas cópias
  // divergiriam na primeira correção.
  const corPrimeira = rateio.porEmpresa.length ? rateio.porEmpresa[0].cor : 'var(--m1)';

  el('#pagina').innerHTML = `
    <div class="msg"><strong>Leitura estratégica, separada da operação.</strong>
      Os indicadores estão agrupados pelo módulo a que pertencem: abrir <em>Financeiro</em> abre os
      indicadores financeiros, e o mesmo vale para SLA e Projetos. Dentro de cada indicador, a
      expansão continua por empresa e, dentro dela, por filial. Os filtros são de cada módulo e não
      atravessam para as outras telas — nem sobrevivem ao recarregar.</div>

    <section class="bloco bloco-modulo" data-dobra-padrao="aberto" style="margin-top:16px">
      <header>
        <h2>Financeiro</h2>
        <span class="nota">${[
          resumoMetaDoModulo(metaDoCustoRecorrente(rf, reducao)),
          rf.somenteReconhecidas ? 'apenas despesas reconhecidas' : 'todas as despesas',
        ].filter(Boolean).join(' · ')}</span>
      </header>
      ${filtrosDoBloco('financeiro', rf)}
      ${caixaDeCategorizacaoHtml()}

    ${blocoIndicador({
      chave: 'plano-reducao',
      titulo: 'Objetivo 01: Redução de Custo',
      descricao: 'Plano de Redução de Custos sobre Despesas Fixas(Mensais)',
      valor: plano.itens.length
        ? `${brl(plano.fixasDoMes)} → ${brl(plano.resultadoEsperado)}`
        : '—',
      // A cor do cabeçalho segue o SEMÁFORO, e não o tamanho da redução: verde
      // porque "sobrou redução a fazer" pintaria de bom exatamente o caso em
      // que o alvo ainda não foi alcançado — o oposto do que os faróis dizem
      // dois centímetros abaixo.
      cor: !plano.itens.length || plano.totalAlvo === 0 ? null
        : plano.atinge ? 'var(--bomtxt)' : 'var(--crit)',
      apoio: plano.itens.length
        ? `${inteiro(plano.itens.length)} despesa(s) no plano · meta de cortar ${brl(plano.metaTotal)} `
          + `(${pctTxt(pct(cent(plano.metaTotal), cent(plano.fixasDoMes)))} do custo fixo)`
          + `${plano.referencia ? ` · valores de ${mesExib(plano.referencia)}` : ''}`
        : 'nenhuma despesa no plano — cadastre em Sistema › Cadastro › Plano de redução',
      corpo: `
        ${plano.itens.length === 0 ? '' : cardsDoPlanoHtml({
          custo: plano.fixasDoMes, meta: plano.metaTotal, esperado: plano.resultadoEsperado,
          atinge: plano.atinge, rotulo: `Custo fixo menos a meta, em ${mesExib(plano.referencia)}` })}
        <div class="semaforos">
          ${semaforoHtml({ rotulo: 'Meta cadastrada', ...semaforoDaMeta(plano.leituraMeta) })}
          ${semaforoHtml({ rotulo: 'Alvo do plano',
            estado: plano.itens.length === 0 || plano.metaTotal === 0 ? null : plano.atinge,
            texto: plano.itens.length === 0
              ? 'nenhuma despesa no plano de redução'
              : !plano.mesBase
                ? `o plano só passa a valer em ${plano.inicioNoFuturo ? mesExib(plano.inicioNoFuturo) : 'um mês futuro'}`
                  + ` — a meta é cortar ${brl(plano.metaTotal)}`
                : plano.jaCortado > 0
                  ? `o custo fixo caiu ${brl(plano.jaCortado)} desde ${mesExib(plano.mesBase)}, `
                    + `contra a meta de cortar ${brl(plano.metaTotal)}`
                  : `o custo fixo subiu ${brl(-plano.jaCortado)} desde ${mesExib(plano.mesBase)}, `
                    + `e a meta é cortar ${brl(plano.metaTotal)}`,
            detalhe: !plano.itens.length
              ? 'Cadastre as despesas e quanto cortar em Sistema › Cadastro › Plano de redução.'
              : !plano.mesBase
                ? 'Não há mês REALIZADO com este plano vigente, então não há resultado para julgar. '
                  + 'A comparação começa no primeiro mês fechado em que ele valer.'
                : `Compara o custo fixo de ${mesExib(plano.referencia)} com o de ${mesExib(plano.mesBase)}, `
                  + 'que é o primeiro mês REALIZADO em que algum plano já vigorava. O alvo tem de sair de '
                  + 'um mês fixo e passado: derivado do mês corrente ele desceria junto com o custo, e num '
                  + 'mês futuro compararia o hoje com uma projeção.' })}
        </div>
        ${plano.composicao.pontos.length === 0 ? '' : `
        <h3 class="titulo-mini">Custo fixo mês a mês, por tipo de despesa${
          plano.janela.de ? ` — ${mesExib(plano.janela.de)} a ${mesExib(plano.janela.ate)}` : ''}</h3>
        ${legendaDeTiposHtml(plano.composicao)}
        <div id="i-plano-serie" style="margin-top:2px"></div>`}
        ${plano.itens.length === 0 ? '' : `
        <div class="rol" style="margin-top:12px"><table>
          <thead><tr><th>Item</th><th class="n">Atual / mês</th><th class="n">Alvo / mês</th>
            <th>Atual × alvo</th><th class="n">Meta (cortar)</th>
            <th class="n" title="Quanto do custo fixo total do mês esta meta corta. A coluna soma a meta total.">% do custo fixo</th></tr></thead>
          <tbody>${plano.itens.map((i) => `<tr data-plano="${esc(i.nome)}">
            <td>${esc(i.nome)}<div class="arv-comp">${
              [i.tipo, i.filial, i.vigencia].filter(Boolean).map(esc).join(' · ')}</div>${
              i.jaCortadoAntes > 0
                ? `<div class="arv-comp" title="${esc(`A despesa custa ${brl(i.custoBruto)} no mês; `
                    + `${brl(i.jaCortadoAntes)} já são meta de um plano que começa antes.`)}"
                    >parte de ${brl(i.custoBruto)} − ${brl(i.jaCortadoAntes)} já pactuados</div>`
                : ''}</td>
            <td class="n">${brl(i.atual)}</td>
            <td class="n">${brl(i.alvo)}</td>
            <td>${i.semDespesa
              ? '<span class="nota">sem despesa fixa no mês de referência</span>'
              : barrasComparativasHtml(i.atual, i.alvo, 'var(--crit)', 'var(--bom)', Math.max(i.atual, i.alvo),
                  { titulo: i.nome, linhas: [
                    { nome: 'Vigência', valor: i.vigencia },
                    ...(i.jaCortadoAntes > 0 ? [
                      { nome: 'Custo da despesa no mês', valor: brl(i.custoBruto) },
                      { nome: 'Já pactuado antes', valor: `− ${brl(i.jaCortadoAntes)}` },
                    ] : []),
                    { nome: 'Base deste plano', valor: brl(i.atual), cor: 'var(--crit)' },
                    { nome: 'Alvo mensal', valor: brl(i.alvo), cor: 'var(--bom)' },
                    { nome: 'Redução', valor: `${brl(i.reducao)} (${pctTxt(i.pctReducao)})` },
                    { nome: 'Peso da despesa no custo fixo', valor: pctTxt(i.pctDoGrupo) },
                    { nome: 'Do custo fixo, esta meta corta', valor: pctTxt(i.pctDoCorte) },
                    ...i.porFilial.slice(0, 6).map((f) => ({
                      nome: f.unidade, valor: `${brl(f.valorReais)} · ${pctTxt(f.pctDaFilial)} da unidade`, cor: f.cor,
                    })),
                  ] })}</td>
            <td class="n" style="color:${i.corte > 0 ? 'var(--bomtxt)' : 'var(--tinta2)'}">${
              i.semDespesa ? '—' : brl(i.corte)}</td>
            <td class="n">${i.semDespesa ? '—' : pctTxt(i.pctDoCorte)}</td>
          </tr>
          ${i.porFilial.length === 0 ? '' : `<tr class="plano-filiais"><td colspan="6">
            <div class="plano-filiais-lista">${i.porFilial.map((f) => `<span>
              <i style="background:${f.cor}" aria-hidden="true"></i>${esc(f.unidade)}
              <b title="${esc(`${f.unidade}: ${brl(f.valorReais)} — ${pctTxt(f.pctDaFilial)} da despesa fixa desta unidade`)}">${pctTxt(f.pctDaFilial)}</b>
            </span>`).join('')}</div></td></tr>`}`).join('')}</tbody>
        </table></div>`}`,
      nota: plano.itens.length
        ? 'Só despesa de natureza <strong>fixa (mensal)</strong> entra, e tudo é <strong>por mês</strong>: o '
          + `atual é o que as despesas do plano custaram em ${plano.referencia ? mesExib(plano.referencia) : 'nenhum mês'}, `
          + 'contra o alvo mensal do cadastro. Os planos vêm em <strong>ordem de vigência</strong> e '
          + '<strong>em cadeia</strong>: quando dois alcançam a mesma despesa, o que começa depois parte do '
          + 'patamar que o anterior deixou — medir os dois contra o mesmo valor contaria o mesmo dinheiro '
          + 'duas vezes. A janela é a da <strong>meta cadastrada</strong> — o filtro de '
          + 'período do bloco não alcança este objetivo, para que "a meta foi alcançada?" não mude de resposta '
          + 'conforme o mês que alguém escolheu olhar.'
        : 'Sem alvo cadastrado não há de quanto para quanto — e um alvo inventado seria pior que a ausência dele.',
    })}

    ${blocoIndicador({
      chave: 'rateio',
      titulo: 'Objetivo 02: Adequação dos Custos Compartilhados',
      descricao: 'Normalização dos Custos com Despesas FIXAS(MENSAIS) que são compartilhadas '
        + 'e pago por uma filial VERSOS as Regularizadas',
      valor: adequacao.lancamentos
        ? `${brl(adequacao.compartilhado)} → ${brl(adequacao.regularizado)}`
        : '—',
      cor: !adequacao.lancamentos ? null
        : adequacao.pctRegularizado >= 100 ? 'var(--bomtxt)'
          : adequacao.pctRegularizado > 0 ? null : 'var(--crit)',
      apoio: adequacao.lancamentos
        ? `${pctTxt(adequacao.pctRegularizado)} já regularizado · `
          + `${pctTxt(adequacao.pctDoCustoFixo)} do custo fixo mensal`
          + `${adequacao.referencia ? ` · valores de ${mesExib(adequacao.referencia)}` : ''}`
        : 'nenhuma despesa fixa classificada como compartilhada',
      corpo: adequacao.lancamentos === 0 ? `
        <div class="msg alerta">
          <strong>Nenhuma despesa fixa está classificada como compartilhada.</strong>
          O objetivo mede a adequação de contratos que uma filial paga e o grupo consome — e esse
          consumo é uma <em>classificação</em>, não algo que se deduza do valor. Enquanto ninguém
          marcar quais despesas são compartilhadas, o indicador não tem o que medir.
        </div>
        <div class="acoes" style="justify-content:flex-start;margin-top:10px">
          <button type="button" class="bt pri" data-classificar>Classificar despesas compartilhadas</button>
        </div>` : `
        ${cardsDaAdequacaoHtml(adequacao)}
        ${legendaDaAdequacaoHtml()}
        <div id="i-adequacao" style="margin-top:2px"></div>
        <h3 class="titulo-mini">O que ainda é compartilhado, por empresa e filial${
          adequacao.referencia ? ` — ${mesExib(adequacao.referencia)}` : ''}</h3>
        ${adequacao.porUnidade.length
          ? `${faixaDeMatrizesHtml(fatiasDe(adequacao.porUnidade, emDinheiro))}
             ${legendaDeMatrizesHtml(fatiasDe(adequacao.porUnidade, emDinheiro))}
             ${arvoreDeUnidadesHtml('ind-adequacao', adequacao.porUnidade, emDinheiro)}`
          : '<p class="vazio">Nada pendente no mês de referência: tudo o que é compartilhado já foi regularizado.</p>'}
        <div class="acoes" style="justify-content:flex-start;margin-top:10px">
          <button type="button" class="bt" data-classificar>Classificar despesas compartilhadas</button>
        </div>
        <h3 class="titulo-mini">Como ficaria rateado entre as empresas</h3>
        <!-- O critério sai do rodapé do bloco e passa a morar JUNTO da tabela
             que ele explica: o bloco agora fala de duas coisas, e uma nota no
             fim descreveria a de cima. -->
        <p class="nota" style="margin:2px 0 0">O <strong>antes</strong> é como a unidade aparece hoje:
          o que é dela mais 100% do que ela paga. O <strong>depois</strong> é o que é dela mais a parcela
          que lhe cabe. O critério é <strong>proporcional à despesa própria</strong> de cada empresa no
          período; com nenhuma empresa tendo despesa própria, a divisão sai igual. O total redistribui,
          não cresce — e nenhum lançamento é alterado.</p>
        ${rateio.lancamentos === 0 ? '<p class="vazio">Sem despesa compartilhada no recorte.</p>' : `
        ${legendaDeConsumoHtml(corPrimeira)}
        <div class="rol" style="margin-top:10px"><table>
          <thead><tr><th>Empresa</th><th class="n">Própria</th><th class="n">Rateio recebido</th>
            <th>Antes → depois</th><th class="n">Variação</th></tr></thead>
          <tbody>${rateio.porEmpresa.map((e) => {
            const teto = Math.max(...rateio.porEmpresa.map((x) => Math.max(x.antes, x.depois)), 1);
            return `<tr>
            <td><i class="ponto-matriz" style="background:${e.cor}" aria-hidden="true"></i>${esc(e.nome)}
              ${e.pagadora ? '<span class="tag" title="Esta empresa paga ao menos uma despesa compartilhada do grupo">pagadora</span>' : ''}</td>
            <td class="n">${brl(e.proprioValor)}</td>
            <td class="n" style="color:${e.corEscura}"${e.segmentos.length
              ? ` title="${esc(e.segmentos.map((s) => `${s.descricao} (de ${s.origem}): ${brl(s.valor)} — ${pctTxt(s.pct)}`
                  + (s.beneficiadas.length ? ` · beneficia ${s.beneficiadas.join(', ')}` : '')).join('\\n'))}"`
              : ''}>${brl(e.recebidoValor)}</td>
            <td>${barrasComparativasHtml(e.antes, e.depois, e.cor, e.corEscura, teto,
              { titulo: e.nome, linhas: [
                { nome: 'Antes (100% na pagadora)', valor: brl(e.antes), cor: e.cor },
                { nome: 'Depois (rateio proporcional)', valor: brl(e.depois), cor: e.corEscura },
                { nome: 'Despesa própria', valor: brl(e.proprioValor) },
                { nome: 'Rateio recebido', valor: brl(e.recebidoValor) },
                ...(e.pagadora ? [{ nome: 'Rateio pago', valor: brl(e.pagoValor) }] : []),
                ...e.segmentos.slice(0, 5).map((sg) => ({
                  nome: `${sg.descricao} (de ${sg.origem})`,
                  valor: `${brl(sg.valor)} · ${pctTxt(sg.pct)}`,
                  cor: e.corEscura,
                })),
              ] })}</td>
            <td class="n" style="color:${e.variacao < 0 ? 'var(--bomtxt)' : e.variacao > 0 ? 'var(--alerta)' : 'var(--tinta2)'}">${
              e.variacao === 0 ? '—' : (e.variacao > 0 ? '+' : '') + brl(e.variacao)}</td>
          </tr>`;
          }).join('')}</tbody>
          <tfoot><tr><td>Total rateado</td><td class="n"></td>
            <td class="n">${brl(rateio.sanidade)}</td><td></td><td class="n"></td></tr></tfoot>
        </table></div>`}`,
      nota: adequacao.lancamentos
        ? 'Só despesa de natureza <strong>fixa (mensal)</strong> e <strong>classificada como '
          + 'compartilhada</strong> entra. Regularizada é a que tem <strong>marco de adequação</strong> '
          + 'cadastrado e já alcançou o mês — uma despesa que apenas sumiu da base não conta, porque '
          + 'ter sido adequada e ter acabado são coisas diferentes. Os percentuais são do último mês '
          + '<strong>realizado</strong> do recorte — um mês futuro só tem projeção lançada, e tomá-lo '
          + 'como "hoje" anunciaria um andamento que ainda não aconteceu. O rateio abaixo é a '
          + 'simulação de como o custo ficaria distribuído, e não muda lançamento nenhum.'
        : '',
    })}

    ${blocoIndicador({
      chave: 'custo-recorrente',
      titulo: 'Farol 1 - Variação dos custos Fixos(Mensais) e Variação dos custos Variáveis(pontuais)',
      // O NÚMERO DO CABEÇALHO continua sendo o dos fixos, e não uma média dos
      // dois: é o patamar recorrente que responde "o custo subiu?", e somar
      // uma compra pontual a ele foi justamente o que o indicador antigo
      // evitava. A variação dos pontuais vem ao lado, no apoio e nos cards.
      valor: farol.fixos.variacaoTotal === null
        ? '—'
        : (farol.fixos.variacaoTotal > 0 ? '+' : '') + farol.fixos.variacaoTotal.toLocaleString('pt-BR') + '%',
      cor: farol.fixos.tendencia === 'queda' ? 'var(--bomtxt)'
        : farol.fixos.tendencia === 'alta' ? 'var(--crit)' : null,
      // As duas medidas vêm NOMEADAS. A porcentagem é ponta a ponta (primeiro
      // contra último mês) e a palavra é a tendência (média da primeira metade
      // contra a da segunda). Elas podem discordar de verdade — uma série que
      // dá um salto só no último mês é "em queda" na tendência e "+72%" ponta a
      // ponta —, e escrevê-las juntas sem rótulo lê-se como defeito.
      apoio: `fixos ${esc(rotuloVariacao(farol.fixos))} · variáveis ${esc(rotuloVariacao(farol.variaveis))}`
        + `${farol.fixos.economia > 0 ? ` · economia de ${brl(farol.fixos.economia)}/mês` : ''}`,
      corpo: `${metaHtml(metaDoCustoRecorrente(rf, reducao))}
        ${cardsDoFarolHtml(farol)}
        ${legendaDeClassificacaoHtml()}
        ${grupoDoFarolHtml('fixos', 'Custos fixos (mensais)', farol.fixos)}
        ${grupoDoFarolHtml('variaveis', 'Custos variáveis (pontuais)', farol.variaveis)}
        <h3 class="titulo-mini">Custo fixo por empresa e filial</h3>
        ${faixaDeMatrizesHtml(fatiasDe(q.fixos, emDinheiro))}
        ${legendaDeMatrizesHtml(fatiasDe(q.fixos, emDinheiro))}
        ${arvoreDeUnidadesHtml('ind-fixos', q.fixos, emDinheiro)}`,
      nota: 'Fixos e variáveis são séries <strong>separadas, nunca somadas</strong>: uma compra pontual '
        + 'num mês e nenhuma no seguinte produz uma "queda" de 100% que é só o fim da compra, e '
        + 'misturá-la ao recorrente contaminaria a única leitura que fala de patamar. Dentro de cada '
        + 'série, <strong>despesa</strong> e <strong>investimento</strong> aparecem separados — investir '
        + 'R$ 50 mil num mês não é o custo subir R$ 50 mil. A variação é a do total de cada grupo.',
    })}

    ${blocoIndicador({
      chave: 'por-reconhecer',
      titulo: 'Despesas por reconhecer',
      valor: brl(pendente.valor),
      cor: pendente.quantidade ? 'var(--alerta)' : 'var(--bomtxt)',
      apoio: `${inteiro(pendente.quantidade)} de ${inteiro(pendente.universoN)} lançamentos `
        + `(${pendente.pctQuantidade.toLocaleString('pt-BR')}%)`,
      corpo: `${faixaDeMatrizesHtml(fatiasDe(q.pendentes, emDinheiro))}
        ${legendaDeMatrizesHtml(fatiasDe(q.pendentes, emDinheiro))}
        ${arvoreDeUnidadesHtml('ind-pendentes', q.pendentes, emDinheiro)}`,
    })}

    <section class="bloco" style="margin-top:14px">
      <header><h2>Custo recorrente mês a mês</h2>
        <span class="nota">${inteiro(reducao.serie.length)} competência(s)</span></header>
      <div id="i-reducao"></div>
      ${reducao.serie.length ? `<div class="rol rol-fixo" style="margin-top:12px;max-height:280px;min-height:0"><table>
        <thead><tr><th>Competência</th><th class="n">Custo recorrente</th><th class="n">Variação</th></tr></thead>
        <tbody>${reducao.serie.map((p) => `<tr>
          <td>${esc(p.rot)}</td><td class="n">${brl(p.valor)}</td>
          <td class="n"${p.variacao === null ? '' : ` style="color:${p.variacao < 0 ? 'var(--bomtxt)' : p.variacao > 0 ? 'var(--crit)' : 'var(--tinta2)'}"`}>${
            p.variacao === null ? '—' : (p.variacao > 0 ? '+' : '') + p.variacao.toLocaleString('pt-BR') + '%'}</td>
        </tr>`).join('')}</tbody></table></div>` : ''}
      ${rf.somenteReconhecidas ? '<p class="nota" style="margin-top:10px">Exibindo apenas despesas reconhecidas.</p>' : ''}
    </section>

    <section class="bloco" style="margin-top:14px">
      <header><h2>Por reconhecer, por centro de custo</h2>
        <span class="nota">${inteiro(pendente.centros.length)} centro(s)</span></header>
      ${pendente.centros.length === 0
        ? '<p class="vazio">Nada por reconhecer neste recorte.</p>'
        : `<div class="rol"><table>
            <thead><tr><th>Centro de custo</th><th class="n">Lançamentos</th><th class="n">Valor</th></tr></thead>
            <tbody>${pendente.centros.map((c) => `<tr data-centro="${esc(c.centro)}">
              <td>${esc(c.centro)}</td><td class="n">${inteiro(c.quantidade)}</td>
              <td class="n" style="color:var(--alerta);font-weight:700">${brl(c.valor)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td><td class="n">${inteiro(pendente.quantidade)}</td>
              <td class="n">${brl(pendente.valor)}</td></tr></tfoot></table></div>
          <p class="nota" style="margin-top:10px">O centro de custo é o tipo de despesa — é assim que as bases
            vêm rotuladas.</p>`}
    </section>

    ${consumo.lancamentos === 0 ? '' : `
    <section class="bloco" style="margin-top:14px">
      <header><h2>Despesa paga por uma unidade, consumida por outras</h2>
        <span class="nota">${brl(consumo.centralizado)} de ${brl(consumo.total)} · ${
          consumo.pct.toLocaleString('pt-BR')}%</span></header>
      <div class="rol"><table>
        <thead><tr><th>Unidade pagadora</th><th class="n">Centralizado</th>
          <th class="n">Do que ela paga</th><th>Beneficia</th></tr></thead>
        <tbody>${consumo.linhas.map((u) => `<tr>
          <td>${esc(u.unidade)}${u.filial ? '' : ' <span style="color:var(--tinta3)">· nível empresa</span>'}</td>
          <td class="n">${brl(u.valor)}</td>
          <td class="n">${u.pctDaUnidade.toLocaleString('pt-BR')}%</td>
          <td>${u.beneficiadas.length ? esc(u.beneficiadas.join(', ')) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="nota" style="margin-top:10px">O valor é o que a unidade pagadora desembolsa por inteiro.
        Não há divisão por filial beneficiada: somar as linhas daria mais que o total, porque a mesma
        despesa serve a várias. A leitura <strong>rateada</strong> dessa mesma despesa está no indicador
        de despesas compartilhadas regularizadas, acima.</p>

      ${!equilibrio.atual ? '' : `
      <div style="margin-top:14px;border-top:1px solid var(--linha);padding-top:12px">
        <strong>Equilíbrio de despesas, mês a mês</strong>
        <p style="margin:4px 0 0;font-size:13px">
          ${equilibrio.atual.pct.toLocaleString('pt-BR')}% em ${esc(equilibrio.atual.rot)}${
            equilibrio.anterior
              ? ` · ${equilibrio.anterior.pct.toLocaleString('pt-BR')}% em ${esc(equilibrio.anterior.rot)}${
                  equilibrio.variacaoPp === null ? '' :
                  ` <span style="color:${equilibrio.variacaoPp > 0 ? 'var(--crit)' : 'var(--bomtxt)'}">(${
                    equilibrio.variacaoPp > 0 ? '+' : ''}${equilibrio.variacaoPp.toLocaleString('pt-BR')} p.p.)</span>`}`
              : ''}
        </p>
        ${equilibrio.anterior ? '' :
          '<p class="nota" style="margin:4px 0 0">Sem mês anterior com movimento neste recorte — não há contra o que comparar.</p>'}
        ${metaHtml(equilibrio.leitura)}
        <div class="rol rol-fixo" style="margin-top:10px;max-height:200px;min-height:0"><table>
          <thead><tr><th>Competência</th><th class="n">Centralizado</th><th class="n">Total</th><th class="n">%</th></tr></thead>
          <tbody>${equilibrio.serie.map((m) => `<tr>
            <td>${esc(m.rot)}</td><td class="n">${brl(m.centralizado)}</td>
            <td class="n">${brl(m.total)}</td><td class="n">${m.pct.toLocaleString('pt-BR')}%</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`}
    </section>`}

    </section>

    <section class="bloco bloco-modulo" data-dobra-padrao="aberto" style="margin-top:16px">
      <header>
        <h2>Projetos</h2>
        <span class="nota">${[
          resumoMetaDoModulo(proj.leitura),
          'por competência de entrega planejada',
        ].filter(Boolean).join(' · ')}</span>
      </header>
      ${filtrosDoBloco('projetos', rp)}

    ${blocoIndicador({
      chave: 'projetos-prazo',
      titulo: 'Tarefas entregues no prazo',
      valor: proj.entregues ? proj.pct.toLocaleString('pt-BR') + '%' : '—',
      cor: proj.entregues === 0 ? null : proj.leitura ? (proj.leitura.atinge ? 'var(--bomtxt)' : 'var(--crit)') : null,
      apoio: proj.entregues
        ? `${inteiro(proj.noPrazo)} de ${inteiro(proj.entregues)} entregues`
        : 'nenhuma tarefa entregue no recorte',
      corpo: `${metaHtml(proj.leitura)}
        ${faixaDeMatrizesHtml(fatiasDe(q.entregues, inteiro))}
        ${legendaDeMatrizesHtml(fatiasDe(q.entregues, inteiro))}
        ${arvoreDeUnidadesHtml('ind-entregues', q.entregues, inteiro, semExtra)}`,
      nota: `O denominador do percentual é o que foi <strong>entregue</strong>: tarefa ainda em aberto não
        está fora do prazo enquanto o mês planejado não passa.${
          proj.canceladas ? ` ${inteiro(proj.canceladas)} cancelada(s) ficam fora das duas contas.` : ''}`,
    })}

    ${blocoIndicador({
      chave: 'projetos-pendentes',
      titulo: 'Tarefas pendentes',
      valor: inteiro(proj.pendentes),
      cor: proj.atrasadas ? 'var(--alerta)' : null,
      apoio: proj.atrasadas
        ? `${inteiro(proj.atrasadas)} com o mês planejado já vencido`
        : 'nenhuma com o mês planejado vencido',
      corpo: `${faixaDeMatrizesHtml(fatiasDe(q.tarefasPendentes, inteiro))}
        ${legendaDeMatrizesHtml(fatiasDe(q.tarefasPendentes, inteiro))}
        ${arvoreDeUnidadesHtml('ind-tarefas-pendentes', q.tarefasPendentes, inteiro, semExtra)}`,
    })}
    </section>

    <section class="bloco bloco-modulo" data-dobra-padrao="aberto" style="margin-top:16px">
      <header>
        <h2>SLA</h2>
        <span class="nota">${resumoMetaDoModulo(sla.leitura) || `meta de ${sla.meta}%`}</span>
      </header>
      ${filtrosDoBloco('sla', rs)}

    ${blocoIndicador({
      chave: 'sla-conformidade',
      titulo: 'Atendidos dentro do SLA',
      valor: sla.total ? sla.pct.toLocaleString('pt-BR') + '%' : '—',
      cor: sla.total === 0 ? null : sla.atinge ? 'var(--bomtxt)' : 'var(--crit)',
      apoio: sla.total
        ? `${sla.atinge ? '✓ atinge' : '✗ abaixo d'}a meta de ${sla.meta}% · ${
            sla.distancia > 0 ? '+' : ''}${sla.distancia.toLocaleString('pt-BR')} p.p.`
        : 'sem chamado no recorte',
      corpo: `${metaHtml(sla.leitura)}
        ${faixaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
        ${legendaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
        ${arvoreDeUnidadesHtml('ind-sla', q.sla, inteiro, extraSla)}
        <div id="i-termometro" style="margin-top:14px"></div>`,
    })}

    ${blocoIndicador({
      chave: 'sla-chamados',
      titulo: 'Chamados no recorte',
      valor: inteiro(sla.total),
      apoio: `${inteiro(sla.dentro)} dentro · ${inteiro(sla.fora)} fora`,
      corpo: `${faixaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
        ${legendaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
        ${arvoreDeUnidadesHtml('ind-chamados', q.sla, inteiro, extraSla)}
        <div class="grade g3" style="margin-top:14px">
          ${[['Abertos', sla.abertos, ''], ['Em andamento', sla.andamento, ''],
             ['Resolvidos', sla.resolvidos, 'bomtxt'], ['Vencidos', sla.vencidos, 'crit']]
            .map(([rot, n, cor]) => `<div class="bloco" style="box-shadow:none">
              <span style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--tinta3)">${esc(rot)}</span>
              <div style="font-size:25px;font-weight:600${cor ? `;color:var(--${cor})` : ''}">${inteiro(n)}</div>
            </div>`).join('')}
        </div>`,
      nota: `<strong>Vencido</strong> atravessa aberto e em andamento — é o chamado cujo prazo passou e ninguém
        resolveu. Por isso não soma com os outros três.${sla.semStatus > 0
          ? ` ${inteiro(sla.semStatus)} atendimento(s) vêm de registro agregado do mês, que não tem situação.` : ''}`,
    })}
    </section>`;

  // ----------------------------------------------------------- desenho
  if (reducao.serie.length) {
    linhas(el('#i-reducao'), reducao.serie.map((p) => ({ rot: p.rot, v: { custo: p.valor } })),
      [{ k: 'custo', nome: 'Custo recorrente', cor: 'var(--s1)' }]);
  } else {
    el('#i-reducao').innerHTML = '<p class="vazio">Sem despesa recorrente neste recorte.</p>';
  }
  // A linha do tempo do Objetivo 01: o custo mensal das despesas do plano
  // contra o alvo. O alvo é uma RETA — é um compromisso cadastrado, não uma
  // medição —, e é a distância entre as duas curvas que diz se o plano anda.
  const alvoPlano = el('#i-plano-serie');
  if (alvoPlano) {
    barrasDoObjetivo(alvoPlano, plano.composicao, (ponto, oQue) => {
      // O ponto de um mês com plano abre a META; a barra e os demais pontos
      // abrem os lançamentos.
      if (oQue === 'meta' && plano.composicao.marcos.has(ponto.comp)) {
        abrirMetasDoMes(ponto.rot, plano.composicao.marcos.get(ponto.comp));
        return;
      }
      // Mês projetado não tem lançamento próprio: o que o compõe é o mês de
      // referência, repetido. Abrir a lista do mês futuro devolveria vazio, e
      // um detalhamento vazio faz duvidar do número em vez de esclarecê-lo.
      const comp = ponto.projetado ? plano.referencia : ponto.comp;
      const itens = fixasDaCompetencia(rf, comp);
      abrirRegistros({
        titulo: ponto.projetado
          ? `Custo fixo projetado para ${ponto.rot} — base: ${mesExib(comp)}`
          : `Custo fixo de ${ponto.rot}`,
        tipo: 'indicadores-mes', colunas: COLUNAS_LANCAMENTO_COMPLETO, larga: true,
        // Em ÁRVORE — tipo → empresa → filial → lançamento —, porque quem
        // clicou numa barra empilhada por tipo quer saber de onde vem o peso, e
        // não só quais lançamentos existem. Cada nível ordena por valor.
        arvore: true,
        itens: [...itens].sort((a, b) => cent(b.valor) - cent(a.valor)),
        contagem: null,
        nota: ponto.projetado
          ? `${inteiro(itens.length)} lançamento(s) de ${mesExib(comp)}, que é a base da projeção. `
            + 'Os meses futuros repetem a composição do último mês realizado; eles não têm lançamento próprio.'
          : `${inteiro(itens.length)} despesa(s) fixa(s), somando ${brl(ponto.total)}.`,
      });
    });
  }
  // OBJETIVO 02 — a linha do tempo da adequação. Barra empilhada porque os dois
  // estados são partições da MESMA despesa: a altura é quanto há de
  // compartilhado no mês, e a divisão interna é o andamento. Duas linhas
  // soltas fariam procurar uma relação entre elas que é, na verdade, uma soma.
  const alvoAdequacao = el('#i-adequacao');
  if (alvoAdequacao) {
    barras(alvoAdequacao,
      adequacao.serie.map((p) => ({
        rot: p.rot, comp: p.comp, projetado: p.projetado,
        v: { pendente: p.compartilhado, regular: p.regularizado },
      })),
      [{ k: 'pendente', nome: 'Ainda compartilhado', cor: COR_PENDENTE },
        { k: 'regular', nome: 'Já regularizado', cor: COR_REGULARIZADO }],
      'empilhado', brl, curto,
      (ponto) => {
        const doMes = adequacao.registros.filter((l) => l.competencia === ponto.comp);
        abrirRegistros({
          titulo: `Despesas compartilhadas de ${ponto.rot}`,
          tipo: 'indicadores-mes', colunas: COLUNAS_LANCAMENTO_COMPLETO, larga: true, arvore: true,
          itens: [...doMes].sort((a, b) => cent(b.valor) - cent(a.valor)),
          contagem: null,
          nota: `${inteiro(doMes.length)} despesa(s) fixa(s) compartilhada(s), somando `
            + `${brl(reais(somaC(doMes.map((l) => l.valor))))}. `
            + `${inteiro(doMes.filter(jaRegularizada).length)} já com marco de adequação alcançado.`,
        });
      });
  }
  // FAROL 1 — uma barra empilhada por grupo, dividida entre despesa e
  // investimento. Empilhada porque as duas somam o custo do mês: lado a lado
  // fariam procurar uma comparação entre elas, quando o que há é uma soma.
  for (const [id, g] of [['fixos', farol.fixos], ['variaveis', farol.variaveis]]) {
    const alvo = el(`#i-farol-${id}`);
    if (!alvo) continue;
    barras(alvo,
      g.serie.map((p) => ({ rot: p.rot, comp: p.comp, v: { despesa: p.despesa, investimento: p.investimento } })),
      [{ k: 'despesa', nome: 'Despesa', cor: COR_DESPESA },
        { k: 'investimento', nome: 'Investimento', cor: COR_INVESTIMENTO, hachura: true }],
      'empilhado', brl, curto,
      (ponto) => {
        const doMes = g.itens.filter((l) => l.competencia === ponto.comp);
        abrirRegistros({
          titulo: `${id === 'fixos' ? 'Custos fixos' : 'Custos variáveis'} de ${ponto.rot}`,
          tipo: 'indicadores-mes', colunas: COLUNAS_LANCAMENTO_COMPLETO, larga: true, arvore: true,
          itens: [...doMes].sort((a, b) => cent(b.valor) - cent(a.valor)),
          contagem: null,
          nota: `${inteiro(doMes.length)} lançamento(s), somando ${brl(reais(somaC(doMes.map((l) => l.valor))))}. `
            + `${inteiro(doMes.filter((l) => l.classificacao === 'investimento').length)} classificado(s) como investimento.`,
        });
      });
  }
  // A ação em lote, alcançável dos dois estados do bloco: do vazio, que é onde
  // ela resolve o problema, e do preenchido, para continuar classificando.
  el('#pagina').querySelectorAll('[data-classificar]').forEach((b) => {
    b.onclick = (ev) => {
      // O cartão que abriga este botão É um gatilho de drill-down assim que o
      // indicador tem número. Sem barrar a propagação, um clique abre as DUAS
      // telas empilhadas — a de classificar por baixo da de lançamentos.
      ev.stopPropagation();
      abrirClassificacaoCompartilhada(rf);
    };
  });
  // O termômetro mora dentro do bloco de SLA, que abre fechado: desenhar num
  // elemento escondido é legítimo — o SVG tem `viewBox`, e aparece pronto
  // quando o bloco abre.
  const alvoTermometro = el('#i-termometro');
  if (alvoTermometro) termometro(alvoTermometro, sla.total ? sla.pct : 0, sla.meta, 'Atendidos dentro do SLA');

  // ----------------------------------------------------------- ligações
  for (const bloco of BLOCOS_IND) {
    const r = recorteDoBloco(bloco);
    const mudar = (campo, valor) => { r[campo] = valor; render(); };
    el(`#i-${bloco}-de`).addEventListener('change', (ev) => mudar('de', mesInterno(ev.target.value) || ''));
    el(`#i-${bloco}-ate`).addEventListener('change', (ev) => mudar('ate', mesInterno(ev.target.value) || ''));
    seletorMulti(el(`[data-sel="i-${bloco}-filial"]`), {
      id: `i-${bloco}-filial`, rotulo: 'Filial',
      itens: [{ valor: '(empresa)', rotulo: 'Sem filial (nível empresa)' },
        ...filiaisDoEscopo().map((f) => ({ valor: f.nome, rotulo: f.nome }))],
      selecionados: r.filiais,
      aoMudar: (novo) => { r.filiais = novo; render(); },
    });
  }
  // Voltar ao PADRÃO, não ao vazio: no Financeiro o padrão é uma janela
  // (primeira competência → último mês fechado), e esvaziá-la traria de volta
  // os meses futuros que o padrão existe para deixar de fora.
  el('#pagina').querySelectorAll('[data-limpar]').forEach((b) => b.onclick = () => {
    E.filtrosInd[b.dataset.limpar] = recorteInicial(b.dataset.limpar);
    render();
  });
  // O switch recalcula o BLOCO inteiro: indicadores, série e tabela. Filtrar só
  // o gráfico deixaria o KPI dizendo uma coisa e a curva outra.
  const rec = el('#i-rec');
  if (rec) rec.addEventListener('change', () => { rf.somenteReconhecidas = rec.value === 'rec'; render(); });

  // ----------------------------------------------------- detalhamento
  const linhasPendentes = () => naoReconhecidos;
  const lancamentosDoPlano = () => plano.registros;

  // O mapa é por CHAVE, e não por posição: a ordem dos blocos mudou nesta
  // entrega e vai mudar de novo, e um mapa posicional ligaria em silêncio o
  // tooltip de um indicador ao detalhamento de outro.
  ligarKpis({
    'plano-reducao': {
      dica: 'As despesas FIXAS (mensais) escolhidas para cair, com o custo mensal de hoje e o alvo '
        + 'mensal cadastrado. O percentual de redução é (atual − alvo) / atual, com os dois lados '
        + 'medidos por mês. A janela é a da meta cadastrada, e não a do filtro de período do bloco. '
        + 'Clique para ver os lançamentos que compõem o valor atual.',
      abrir: plano.itens.length
        ? () => abrirRegistros({
            titulo: 'Objetivo 01 — despesas fixas do plano', tipo: 'indicadores-mes',
            colunas: COLUNAS_LANCAMENTO_COMPLETO, larga: true, arvore: true,
            itens: lancamentosDoPlano(), contagem: null,
            nota: `Custo mensal atual ${brl(plano.totalAtual)}, alvo ${brl(plano.totalAlvo)} — `
              + `${pctTxt(plano.pctReducao)} de redução, medidos em `
              + `${plano.referencia ? mesExib(plano.referencia) : 'nenhum mês'}. `
              + 'A lista traz as despesas fixas de toda a vigência da meta, que é o que a linha do tempo mostra.',
          })
        : null,
    },
    rateio: {
      dica: 'A despesa FIXA que uma unidade paga e o grupo consome, e o andamento da adequação: '
        + 'quanto dela já tem marco de regularização alcançado. Os dois percentuais têm bases '
        + 'diferentes — um sobre o compartilhado, outro sobre o custo fixo do mês. '
        + 'Clique para ver os lançamentos compartilhados.',
      abrir: adequacao.lancamentos
        ? () => abrirRegistros({
            titulo: 'Despesas fixas compartilhadas do recorte', tipo: 'indicadores-mes',
            colunas: COLUNAS_LANCAMENTO_COMPLETO, larga: true, arvore: true,
            itens: adequacao.registros,
            contagem: null,
            nota: `${inteiro(adequacao.registros.length)} lançamento(s) fixo(s) compartilhado(s) na janela. `
              + `Em ${mesExib(adequacao.referencia)}: ${brl(adequacao.compartilhado)} ainda compartilhados e `
              + `${brl(adequacao.regularizado)} já regularizados.`,
          })
        : null,
    },
    'custo-recorrente': {
      dica: 'Variação do custo RECORRENTE entre o primeiro e o último mês do recorte. '
        + 'Só a despesa de natureza fixa entra: uma compra pontual num mês e nenhuma no seguinte '
        + 'produziria uma "redução" que é só o fim da compra. Clique para ver as despesas fixas.',
      abrir: () => abrirRegistros({
        titulo: 'Custo recorrente — despesas fixas do recorte', tipo: 'indicadores-mes',
        colunas: COLUNAS_LANCAMENTO_COMPLETO, larga: true, arvore: true,
        itens: fixosDoRecorte(rf), contagem: null,
        nota: 'A variação compara o primeiro e o último mês; a lista traz as despesas que formam a série.',
      }),
    },
    'por-reconhecer': {
      dica: 'Soma e contagem das despesas que ninguém reconheceu ainda, no recorte do bloco. '
        + 'Clique para ver os lançamentos e reconhecer em lote.',
      abrir: () => abrirDetalhe({
        titulo: 'Despesas por reconhecer', tipo: 'indicadores',
        itens: linhasPendentes(), esperado: pendente.valor,
      }),
    },
    'sla-conformidade': {
      dica: `Atendidos dentro do prazo sobre o total de atendimentos do recorte, contra a meta de ${sla.meta}%. `
        + 'É a mesma conta das telas de SLA. Clique para ver os chamados, com prazo e situação.',
      abrir: () => abrirRegistros({
        titulo: 'Atendidos dentro do SLA — chamados do recorte', tipo: 'indicadores',
        colunas: COLUNAS_TICKET, itens: ticketsDoRecorte(rs), contagem: null,
        nota: `${inteiro(sla.dentro)} de ${inteiro(sla.total)} atendimentos dentro do prazo `
          + `(${sla.total ? sla.pct.toLocaleString('pt-BR') : '0'}%), contra a meta de ${sla.meta}%.`,
      }),
    },
    'sla-chamados': {
      dica: 'Total de atendimentos no recorte, somando o chamado vindo de helpdesk e o registro '
        + 'agregado do mês. Clique para ver os registros; a tela Chamados é onde se mexe neles.',
      abrir: () => abrirRegistros({
        titulo: 'Chamados no recorte', tipo: 'indicadores',
        colunas: COLUNAS_TICKET, itens: ticketsDoRecorte(rs), contagem: null,
        nota: 'Um registro agregado do mês pode valer por vários atendimentos — por isso a contagem '
          + 'de linhas nem sempre é o total de chamados.',
      }),
    },
    'projetos-prazo': {
      dica: 'Entregues dentro do mês planejado sobre o total ENTREGUE — tarefa ainda em aberto não '
        + 'está fora do prazo enquanto o mês planejado não passa. Clique para ver as entregas.',
      abrir: () => abrirRegistros({
        titulo: 'Tarefas entregues no recorte', tipo: 'indicadores',
        colunas: COLUNAS_TAREFA, itens: tarefasDoRecorte(rp, 'entregues'), contagem: proj.entregues,
        nota: `${inteiro(proj.noPrazo)} dentro do mês planejado.`,
      }),
    },
    'projetos-pendentes': {
      dica: 'Tarefas ainda pendentes ou em andamento cuja entrega estava planejada para o recorte. '
        + 'Clique para ver quais são; o cronograma está na tela Projetos.',
      abrir: () => abrirRegistros({
        titulo: 'Tarefas pendentes no recorte', tipo: 'indicadores',
        colunas: COLUNAS_TAREFA, itens: tarefasDoRecorte(rp, 'pendentes'), contagem: proj.pendentes,
        nota: proj.atrasadas ? `${inteiro(proj.atrasadas)} com o mês planejado já vencido.` : '',
      }),
    },
  });
  ligarArvoresDeUnidade();
  ligarDicasDaTela();
  el('#pagina').querySelectorAll('tr[data-centro]').forEach((tr) => {
    tr.style.cursor = 'pointer';
    tr.onclick = () => abrirDetalhe({
      titulo: 'Por reconhecer — ' + tr.dataset.centro, tipo: 'indicadores',
      itens: linhasPendentes().filter((l) => (l.tipo || '(sem centro de custo)') === tr.dataset.centro),
      esperado: null,
    });
  });
  // Cada item do plano abre os lançamentos que compõem o valor ATUAL dele.
  el('#pagina').querySelectorAll('tr[data-plano]').forEach((tr) => {
    const item = plano.itens.find((i) => i.nome === tr.dataset.plano);
    if (!item || !item.registros.length) return;
    tr.style.cursor = 'pointer';
    tr.onclick = (ev) => {
      ev.stopPropagation();
      abrirRegistros({
        titulo: 'Plano de redução — ' + item.nome, tipo: 'indicadores-mes',
        colunas: COLUNAS_LANCAMENTO_COMPLETO, larga: true, arvore: true,
        itens: item.registros, contagem: null,
        nota: `Atual ${brl(item.atual)} · alvo ${brl(item.alvo)} · ${pctTxt(item.pctReducao)} de redução.`,
      });
    };
  });
}

// --------------------------------------------------- quebra por matriz e filial
//
// O indicador continua CONSOLIDADO — é o pedido: um número só. O que muda é
// que ele passa a saber DE QUEM é cada pedaço, em dois lugares: na faixa de
// cores logo abaixo do número, e na sanfona que abre a hierarquia matriz →
// filial. Os dois saem do MESMO laço que o cálculo já percorre; nada é
// consultado de novo, e por isso a soma da quebra é o número do card.

/** Agrupa registros em matriz → filial, somando o que `medir` devolver. */
function quebrarPorUnidade(registros, medir) {
  const matrizes = new Map();
  for (const r of registros) {
    const chave = r.empresa;
    if (!matrizes.has(chave)) {
      matrizes.set(chave, { empresa: chave, nome: String(nomeEmpresa(chave)), cor: corDaMatriz(chave), valor: 0, filiais: new Map() });
    }
    const m = matrizes.get(chave);
    const valor = medir(r);
    m.valor += valor;
    const nomeFilial = r.filial || 'Sem filial (nível empresa)';
    const f = m.filiais.get(nomeFilial) || { nome: nomeFilial, valor: 0, registros: [] };
    f.valor += valor;
    f.registros.push(r);
    m.filiais.set(nomeFilial, f);
  }
  return [...matrizes.values()]
    .map((m) => ({ ...m, filiais: [...m.filiais.values()].sort((a, b) => b.valor - a.valor) }))
    .sort((a, b) => b.valor - a.valor);
}

/** As fatias da faixa: nome, cor, peso e o valor já formatado para o balão. */
const fatiasDe = (quebra, formatar) =>
  quebra.map((m) => ({ nome: m.nome, cor: m.cor, valor: m.valor, texto: formatar(m.valor) }));

/**
 * Onde os registros de cada folha ficam entre a pintura e o clique.
 *
 * Não cabem no HTML: são objetos, e serializá-los num `data-` faria o bloco
 * pesar megabytes por algo que quase ninguém abre. O mapa é reconstruído a
 * cada `render()`, junto com a tela que o consome.
 */
const ARVORE_REGISTROS = new Map();

/**
 * A barra de representatividade: o peso de um nó dentro do pai.
 *
 * O percentual vai ESCRITO ao lado, e a barra é redundância visual — quem não
 * distingue a cor lê o número, e quem lê rápido vê a proporção. A cor é a da
 * empresa; no que é compartilhado, o tom escurecido dela.
 */
function barraDeRepresentatividadeHtml(pctValor, cor, dica, detalhe) {
  const largura = Math.max(0, Math.min(100, Number(pctValor) || 0));
  // Dois canais para a mesma explicação: o `title` nativo é o que o leitor de
  // tela encontra; o balão é o que a pessoa vê, com atraso e sem cortar na
  // borda. O balão sai de `data-dica`, que `ligarDicasDaTela` lê depois.
  const balao = detalhe
    ? ` data-dica="${esc(JSON.stringify(detalhe))}"`
    : '';
  return `<span class="barra-rep"${dica ? ` title="${esc(dica)}"` : ''}${balao}>`
    + `<span aria-hidden="true"><i style="width:${largura}%;background:${cor}"></i></span>`
    + `<b>${pctTxt(pctValor)}</b></span>`;
}

/**
 * Liga o balão flutuante a tudo que declarou `data-dica` na tela.
 *
 * O detalhe granular fica FORA da visão principal e aparece no hover — é o
 * pedido. Quem navega por teclado alcança o mesmo balão pelo foco, que
 * `ligarDica` cuida.
 */
function ligarDicasDaTela(raiz) {
  const area = raiz || el('#pagina');
  if (!area) return;
  for (const no of area.querySelectorAll('[data-dica]')) {
    // O nível 3 nasce depois da pintura, e esta função roda de novo para
    // alcançá-lo. A marca evita pendurar o segundo par de ouvintes no mesmo nó.
    if (no.dataset.dicaLigada) continue;
    let d = null;
    try { d = JSON.parse(no.dataset.dica); } catch (e) { d = null; }
    if (!d) continue;
    no.dataset.dicaLigada = '1';
    ligarDica(no, () => d);
  }
}

/**
 * A árvore de um indicador: empresa (nível 1) → filial (nível 2) → lançamentos
 * (nível 3), com o MESMO formato nos três níveis.
 *
 * Antes eram dois níveis numa tabela plana, com um botão só por cartão: dava
 * para ver as filiais, não para abrir uma delas nem para comparar o peso de
 * cada uma. Agora cada nó tem o seu controle, e cada linha tem a sua barra.
 *
 * O nível 3 é montado SÓ no primeiro clique da filial (`data-carregado`). Um
 * recorte largo tem milhares de lançamentos, e montá-los na pintura do bloco
 * custaria caro por algo que quase ninguém abre.
 *
 * Fica num botão PRÓPRIO, e não no corpo do card: o corpo já abre o
 * detalhamento, e dois gestos no mesmo alvo brigariam.
 */
function arvoreDeUnidadesHtml(id, quebra, formatar, extra) {
  if (!quebra.length) return '';
  const total = quebra.reduce((s, m) => s + m.valor, 0);
  // Cada pintura refaz o mapa desta árvore: um resto da pintura anterior
  // entregaria ao clique registros de um recorte que não está mais na tela.
  for (const chave of [...ARVORE_REGISTROS.keys()]) {
    if (chave.startsWith(id + ':')) ARVORE_REGISTROS.delete(chave);
  }
  const linhas = quebra.map((m, i) => {
    const chaveEmpresa = `${id}:e${i}`;
    const filiais = m.filiais.map((f, j) => {
      const chaveFilial = `${id}:e${i}:f${j}`;
      // Só o nível de despesa tem lançamento por trás; a quebra de SLA e a de
      // tarefas não carregam registros, e prometer um terceiro nível que não
      // existe seria pior do que não oferecer.
      const temItens = Array.isArray(f.registros) && f.registros.length > 0;
      if (temItens) ARVORE_REGISTROS.set(chaveFilial, { registros: f.registros, cor: m.cor, nome: f.nome });
      return `<tr class="nivel-2" data-no="${esc(chaveFilial)}" data-pai="${esc(chaveEmpresa)}" hidden>
        <td>${temItens
          ? `<button type="button" class="arv-abrir" aria-expanded="false" data-abrir-no="${esc(chaveFilial)}"
               aria-label="Abrir os lançamentos de ${esc(f.nome)}"><span aria-hidden="true">+</span></button>`
          : '<span class="arv-vazio" aria-hidden="true"></span>'}${esc(f.nome)}</td>
        <td class="num">${formatar(f.valor)}</td>
        <td>${barraDeRepresentatividadeHtml(pct(f.valor, m.valor), m.cor,
          `${f.nome}: ${formatar(f.valor)} · ${pctTxt(pct(f.valor, m.valor))} de ${m.nome}`,
          { titulo: f.nome, linhas: [
            { nome: 'Valor', valor: String(formatar(f.valor)) },
            { nome: 'Peso em ' + m.nome, valor: pctTxt(pct(f.valor, m.valor)), cor: m.cor },
            { nome: 'Empresa', valor: m.nome },
          ] })}</td>
        <td>${extra ? extra.filial(f, m) : ''}</td>
      </tr>`;
    }).join('');
    return `<tr class="nivel-1" data-no="${esc(chaveEmpresa)}">
        <td><button type="button" class="arv-abrir" aria-expanded="false" data-abrir-no="${esc(chaveEmpresa)}"
              aria-label="Abrir as filiais de ${esc(m.nome)}"><span aria-hidden="true">+</span></button>
          <i class="ponto-matriz" style="background:${m.cor}" aria-hidden="true"></i>${esc(m.nome)}</td>
        <td class="num">${formatar(m.valor)}</td>
        <td>${barraDeRepresentatividadeHtml(pct(m.valor, total), m.cor,
          `${m.nome}: ${formatar(m.valor)} · ${pctTxt(pct(m.valor, total))} do recorte`,
          { titulo: m.nome, linhas: [
            { nome: 'Valor', valor: String(formatar(m.valor)) },
            { nome: 'Peso no recorte', valor: pctTxt(pct(m.valor, total)), cor: m.cor },
            { nome: 'Filiais', valor: inteiro(m.filiais.length) },
          ] })}</td>
        <td>${extra ? extra.matriz(m) : ''}</td>
      </tr>
      ${m.filiais.length === 0
        ? `<tr class="nivel-2 vazia" data-pai="${esc(chaveEmpresa)}" hidden><td colspan="4" class="vazio-no">Esta empresa não tem filial no recorte.</td></tr>`
        : filiais}`;
  }).join('');

  return `<div class="kpi-unidades" data-arvore="${esc(id)}">
    <button type="button" class="bt" aria-expanded="false" data-abrir-unidades>+ por unidade</button>
    <div class="kpi-corpo" hidden><table class="arvore-unidades">
      <thead><tr><th>Empresa / filial</th><th class="num">${esc(extra ? extra.coluna : 'Valor')}</th>
        <th>Representatividade</th><th>${esc(extra ? extra.colunaExtra : '')}</th></tr></thead>
      <tbody>${linhas}</tbody></table></div></div>`;
}

/** Compatibilidade: as telas que ainda pedem a sanfona recebem a árvore. */
function sanfonaHtml(id, quebra, formatar, extra) {
  return arvoreDeUnidadesHtml(id, quebra, formatar, extra);
}

/**
 * A quebra do SLA por unidade.
 *
 * Aqui o valor não é uma soma qualquer: é a conformidade. Cada filial recebe
 * DENTRO ou FORA da meta, e a ordenação é por volume de chamados fora — quem
 * mais puxa o resultado geral para baixo aparece primeiro, que é a pergunta
 * que o gestor traz para esta tela.
 */
function quebraDeSla(registros, meta = META_SLA) {
  const matrizes = new Map();
  const acumular = (alvo, s) => {
    alvo.total += Number(s.total) || 0;
    alvo.dentro += Number(s.dentro) || 0;
  };
  const fechar = (x) => {
    x.fora = x.total - x.dentro;
    x.pct = x.total ? Math.round((x.dentro / x.total) * 1000) / 10 : 0;
    x.atinge = x.total > 0 && x.pct >= meta;
    // `valor` é o que a faixa pesa e a coluna mostra: no SLA é o VOLUME de
    // atendimento. Sem ele, a linha de filial sairia zerada enquanto o rótulo
    // ao lado dizia mil chamados fora — dois números discordando na mesma linha.
    x.valor = x.total;
    return x;
  };
  for (const s of registros) {
    if (!matrizes.has(s.empresa)) {
      matrizes.set(s.empresa, {
        empresa: s.empresa, nome: String(nomeEmpresa(s.empresa)), cor: corDaMatriz(s.empresa),
        total: 0, dentro: 0, filiais: new Map(),
      });
    }
    const m = matrizes.get(s.empresa);
    acumular(m, s);
    const nomeFilial = s.filial || 'Sem filial (nível empresa)';
    const f = m.filiais.get(nomeFilial) || { nome: nomeFilial, total: 0, dentro: 0 };
    acumular(f, s);
    m.filiais.set(nomeFilial, f);
  }
  return [...matrizes.values()]
    .map((m) => fechar({ ...m, filiais: [...m.filiais.values()].map(fechar).sort((a, b) => b.fora - a.fora) }))
    .sort((a, b) => b.fora - a.fora);
}

/** Dentro ou fora da meta, com o percentual — o canal que não é só a cor. */
function rotuloConformidade(x) {
  if (!x.total) return '<span class="tag">sem chamado</span>';
  return x.atinge
    ? `<span class="dentro">✓ ${x.pct.toLocaleString('pt-BR')}% · dentro</span>`
    : `<span class="fora">✗ ${x.pct.toLocaleString('pt-BR')}% · fora (${inteiro(x.fora)} chamado(s))</span>`;
}

/**
 * Liga as árvores da tela: o botão do cartão e a expansão de cada nó.
 *
 * Três estados, todos na mesma loja de `blocosAbertos()` — a convenção do
 * projeto é guardar a EXCEÇÃO, e um nó novo nasce fechado sem precisar ser
 * cadastrado em lugar nenhum.
 */
function ligarArvoresDeUnidade() {
  el('#pagina').querySelectorAll('[data-arvore]').forEach((caixa) => {
    const bt = caixa.querySelector('[data-abrir-unidades]');
    const corpo = caixa.querySelector('.kpi-corpo');
    const chave = 'sanfona:' + caixa.dataset.arvore;
    const aplicar = (aberto) => {
      bt.setAttribute('aria-expanded', String(aberto));
      bt.textContent = (aberto ? '− ' : '+ ') + 'por unidade';
      corpo.hidden = !aberto;
    };
    aplicar(blocosAbertos().has(chave));
    bt.onclick = (ev) => {
      // O card é gatilho de drill-down: sem parar aqui, abrir a árvore
      // abriria o modal junto.
      ev.stopPropagation();
      const atuais = blocosAbertos();
      const vai = !atuais.has(chave);
      if (vai) atuais.add(chave); else atuais.delete(chave);
      gravarBlocosAbertos(atuais);
      aplicar(vai);
    };

    const tabela = caixa.querySelector('table');
    if (!tabela) return;

    const aplicarNo = (no, aberto) => {
      const gatilho = tabela.querySelector(`[data-abrir-no="${CSS.escape(no)}"]`);
      if (gatilho) {
        gatilho.setAttribute('aria-expanded', String(aberto));
        gatilho.firstElementChild.textContent = aberto ? '−' : '+';
      }
      for (const filho of tabela.querySelectorAll(`[data-pai="${CSS.escape(no)}"]`)) {
        filho.hidden = !aberto;
        // Fechar o pai fecha o que estava aberto abaixo dele: deixar netos
        // visíveis sob um pai fechado seria uma árvore mentindo sobre si.
        if (!aberto && filho.dataset.no) aplicarNo(filho.dataset.no, false);
      }
    };

    for (const gatilho of tabela.querySelectorAll('[data-abrir-no]')) {
      const no = gatilho.dataset.abrirNo;
      const linha = tabela.querySelector(`tr[data-no="${CSS.escape(no)}"]`);
      const chaveNo = 'arvore:' + no;
      gatilho.onclick = (ev) => {
        ev.stopPropagation();
        const atuais = blocosAbertos();
        const vai = !atuais.has(chaveNo);
        if (vai) {
          atuais.add(chaveNo);
          // Carga sob demanda: o nível 3 só existe depois do primeiro clique.
          if (linha && linha.classList.contains('nivel-2') && !linha.dataset.carregado) {
            montarNivelDeLancamentos(tabela, linha, no);
            linha.dataset.carregado = '1';
          }
        } else {
          atuais.delete(chaveNo);
        }
        gravarBlocosAbertos(atuais);
        aplicarNo(no, vai);
      };
      // Restaura o que estava aberto na visita anterior, de cima para baixo —
      // um filho só aparece se o pai também estiver aberto.
      if (blocosAbertos().has(chaveNo)) {
        if (linha && linha.classList.contains('nivel-2') && !linha.dataset.carregado) {
          montarNivelDeLancamentos(tabela, linha, no);
          linha.dataset.carregado = '1';
        }
        if (!linha || !linha.hidden) aplicarNo(no, true);
      }
    }
  });
}

/**
 * Monta o nível 3 — os lançamentos de uma filial — logo abaixo da linha dela.
 *
 * Os registros já vieram no nó (`quebrarPorUnidade` os carrega no mesmo laço
 * do cálculo), então nada é reconsultado: é isso que garante que a soma dos
 * filhos seja o número do pai.
 */
function montarNivelDeLancamentos(tabela, linha, no) {
  const dados = ARVORE_REGISTROS.get(no);
  if (!dados || !dados.registros.length) return;
  const totalFilial = dados.registros.reduce((s, l) => s + cent(l.valor), 0);
  const html = [...dados.registros]
    .sort((a, b) => cent(b.valor) - cent(a.valor))
    .slice(0, 200)
    .map((l) => {
      const c = cent(l.valor);
      const compartilhada = consumoDe(l) === 'compartilhado';
      const cor = compartilhada ? corCompartilhada(l.empresa) : dados.cor;
      const rotulo = l.descricao || l.tipo;
      return `<tr class="nivel-3" data-pai="${esc(no)}" hidden>
        <td><span class="arv-vazio" aria-hidden="true"></span><span class="arv-vazio" aria-hidden="true"></span>${esc(rotulo)}
          <span class="arv-comp">${esc(mesExib(l.competencia))}</span></td>
        <td class="num">${brl(l.valor)}</td>
        <td>${barraDeRepresentatividadeHtml(pct(c, totalFilial), cor,
          `${rotulo}: ${brl(l.valor)} · ${pctTxt(pct(c, totalFilial))} de ${dados.nome} · ${mesExib(l.competencia)}`
          + (compartilhada ? ' · compartilhada com o grupo' : ''),
          { titulo: rotulo, linhas: [
            { nome: 'Valor', valor: brl(l.valor) },
            { nome: 'Peso em ' + dados.nome, valor: pctTxt(pct(c, totalFilial)), cor },
            { nome: 'Competência', valor: mesExib(l.competencia) },
            { nome: 'Tipo de despesa', valor: String(l.tipo || '—') },
            ...(l.fornecedor ? [{ nome: 'Fornecedor', valor: String(l.fornecedor) }] : []),
            ...(l.origemCusto ? [{ nome: 'Origem do custo', valor: String(l.origemCusto) }] : []),
            ...(l.destinoPagamento ? [{ nome: 'Destino', valor: String(l.destinoPagamento) }] : []),
            { nome: 'Consumo', valor: compartilhada ? resumoConsumo(l) : '100% da filial' },
          ] })}</td>
        <td>${compartilhada ? etiquetaConsumoHtml(l) : ''}</td>
      </tr>`;
    })
    .join('');
  linha.insertAdjacentHTML('afterend', html);
  // As linhas que acabaram de nascer também têm balão: sem esta segunda
  // passada, o nível 3 seria o único lugar da árvore sem detalhe no hover.
  ligarDicasDaTela(linha.closest('table'));
  if (dados.registros.length > 200) {
    linha.insertAdjacentHTML(
      'afterend',
      `<tr class="nivel-3" data-pai="${esc(no)}" hidden><td colspan="4" class="vazio-no">`
        + `Exibindo os 200 maiores de ${inteiro(dados.registros.length)}. Estreite o recorte para ver o resto.</td></tr>`,
    );
  }
}

/** Compatibilidade: o nome antigo continua valendo para quem o chama. */
function ligarSanfonasDeUnidade() {
  ligarArvoresDeUnidade();
}

/**
 * Os REGISTROS de cada indicador, com o mesmo recorte do bloco.
 *
 * Nenhum deles consulta nada: reaproveitam exatamente os laços que o cálculo do
 * bloco já percorre, e é isso que garante que a lista e o número digam a mesma
 * coisa. Se viessem de outra fonte, poderiam divergir — e o gestor não teria
 * como saber qual dos dois está certo.
 */
function fixosDoRecorte(r) {
  return Loja.todosDoEscopo().filter((l) =>
    l.natureza === 'fixa' && passaNoFiltro(E.cenariosSel, l.cenario) &&
    naFilialDoBloco(l.filial, r) && naJanela(l.competencia, r) &&
    (!r.somenteReconhecidas || reconhecidoDe(l)));
}

function ticketsDoRecorte(r) {
  const saida = [];
  for (const e of escopoEmpresas()) {
    for (const s of (E.sla.get(e) || [])) {
      if (!naFilialDoBloco(s.filial, r)) continue;
      if (!naJanela(s.competencia, r)) continue;
      saida.push({ ...s, empresa: e });
    }
  }
  return saida.sort((a, b) => String(b.competencia).localeCompare(String(a.competencia)));
}

/** `quais`: 'entregues' (com fim real) ou 'pendentes' (sem, e não cancelada). */
function tarefasDoRecorte(r, quais) {
  const saida = [];
  for (const e of escopoEmpresas()) {
    for (const p of (E.projetos.get(e) || [])) {
      if (!naFilialDoBloco(p.filial, r)) continue;
      for (const t of (p.tarefas || [])) {
        if (!naJanela(t.fimPlanejado, r)) continue;
        const cancelada = String(t.status || '').toLowerCase().startsWith('cancel');
        if (cancelada) continue;
        const entregue = !!t.fimReal;
        if ((quais === 'entregues') !== entregue) continue;
        saida.push({ ...t, projeto: p.nome, filial: p.filial, empresa: e });
      }
    }
  }
  return saida;
}

/**
 * Tela flutuante com os registros que compõem um indicador.
 *
 * Irmã de `abrirDetalhe`, e não a mesma função: aquela é de LANÇAMENTO e leva a
 * ação de reconhecer em lote, que não faz sentido sobre um chamado ou uma
 * tarefa. Aqui a conferência é por CONTAGEM, porque o número no card pode ser um
 * percentual — e somar percentuais não significa nada.
 */
function abrirRegistros({ titulo, tipo, colunas, itens, contagem, nota, larga, arvore, prefixo }) {
  const confere = contagem === null || contagem === undefined || contagem === itens.length;
  abrirModal({
    titulo, tipo,
    // A ficha completa nasce larga, e a tabela vale a soma das colunas em vez
    // de 100% da caixa: sem isso, doze colunas se espremem e o texto de cada
    // uma quebra em torre.
    larguraPadrao: larga ? Math.min(1180, Math.max(window.innerWidth - 40, 680)) : null,
    corpo: `
      <div class="msg${confere ? '' : ' erro'}">
        <strong>${inteiro(itens.length)} registro(s).</strong>
        ${contagem === null || contagem === undefined ? ''
          : confere ? ' Confere com o indicador.' : ` Diverge: o indicador conta ${inteiro(contagem)}.`}
        ${nota ? ' ' + nota : ''}
      </div>
      ${arvore ? arvoreDoDetalhamentoHtml(itens, prefixo)
        : itens.length === 0 ? '<p class="vazio">Nenhum registro neste recorte.</p>' : `
      <div class="rol" style="margin-top:10px"><table${larga ? ' class="larga"' : ''}>
        <thead><tr>${colunas.map((c) => `<th${c.n ? ' class="n"' : ''}>${esc(c.rotulo)}</th>`).join('')}</tr></thead>
        <tbody>${itens.slice(0, 400).map((it) => `<tr>${colunas
          .map((c) => `<td${c.n ? ' class="n"' : c.texto ? ' class="texto"' : ''}>${c.valor(it)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${itens.length > 400 ? `<p class="nota" style="margin-top:8px">Exibindo os 400 primeiros de ${inteiro(itens.length)}.</p>` : ''}`}`,
    acoes: '<button type="button" class="bt" data-c>Fechar</button>',
    aoMontar({ raiz, fechar }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      if (arvore) ligarArvoreDoDetalhamento(raiz);
    },
  });
}

/** As colunas de cada tipo de registro, num lugar só. */
const COLUNAS_TICKET = [
  { rotulo: 'Competência', valor: (s) => mesExib(s.competencia) },
  { rotulo: 'Unidade', valor: (s) => esc(nomeEmpresa(s.empresa)) },
  { rotulo: 'Filial', valor: (s) => esc(s.filial || 'empresa') },
  { rotulo: 'Fila', valor: (s) => esc(s.fila || '—') },
  { rotulo: 'Chamado', valor: (s) => esc(s.numero || s.ticketId || '—') },
  { rotulo: 'Assunto', valor: (s) => esc(s.assunto || '') },
  // No artifact, o "nível" do chamado É a prioridade: a integração grava
  // `priority` do helpdesk neste campo (app-js15.js).
  { rotulo: 'Prioridade', valor: (s) => esc(s.nivel || '—') },
  { rotulo: 'Status', valor: (s) => esc(s.status || '—') },
  { rotulo: 'Prazo', valor: (s) => esc(s.prazoEm ? String(s.prazoEm).slice(0, 10) : '—') },
  { rotulo: 'SLA', valor: (s) => {
      const t = Number(s.total) || 0, d = Number(s.dentro) || 0;
      if (!t) return '—';
      return d >= t ? '<span class="tag bom">dentro</span>'
        : d === 0 ? '<span class="tag crit">fora</span>'
        : `<span class="tag alerta">${inteiro(d)} de ${inteiro(t)}</span>`;
    } },
];

const COLUNAS_TAREFA = [
  { rotulo: 'Projeto', valor: (t) => esc(t.projeto || '') },
  { rotulo: 'Tarefa', valor: (t) => esc(t.nome || '') },
  { rotulo: 'Unidade', valor: (t) => esc(nomeEmpresa(t.empresa)) },
  { rotulo: 'Filial', valor: (t) => esc(t.filial || 'empresa') },
  { rotulo: 'Planejado', valor: (t) => esc(t.fimPlanejado ? mesExib(t.fimPlanejado) : '—') },
  { rotulo: 'Entregue', valor: (t) => esc(t.fimReal ? mesExib(t.fimReal) : '—') },
  { rotulo: 'Situação', valor: (t) => {
      if (!t.fimReal) return '<span class="tag">pendente</span>';
      return t.fimReal <= t.fimPlanejado
        ? '<span class="tag bom">no prazo</span>' : '<span class="tag crit">fora do prazo</span>';
    } },
  { rotulo: 'Status', valor: (t) => esc(STATUS_PROJ[t.status] || t.status || '') },
];

const COLUNAS_LANCAMENTO_SIMPLES = [
  { rotulo: 'Competência', valor: (l) => mesExib(l.competencia) },
  { rotulo: 'Unidade', valor: (l) => esc(nomeEmpresa(l.empresa)) },
  { rotulo: 'Filial', valor: (l) => esc(l.filial || 'empresa') },
  { rotulo: 'Centro de custo', valor: (l) => esc(l.tipo || '') },
  { rotulo: 'Descrição', valor: (l) => esc(l.descricao || '') },
  { rotulo: 'Valor', n: true, valor: (l) => brl(l.valor) },
];

/**
 * A ficha COMPLETA do lançamento, para quando o clique num gráfico é o pedido
 * de "quero ver tudo o que há sobre estas despesas".
 *
 * Existe ao lado da versão curta, e não no lugar dela: a lista curta serve às
 * telas em que o detalhamento é um aparte, e doze colunas ali empurrariam a
 * leitura para a rolagem horizontal.
 */
const COLUNAS_LANCAMENTO_COMPLETO = [
  { rotulo: 'Competência', valor: (l) => mesExib(l.competencia) },
  { rotulo: 'Unidade', valor: (l) => esc(nomeEmpresa(l.empresa)) },
  { rotulo: 'Filial', valor: (l) => esc(l.filial || 'empresa') },
  { rotulo: 'Tipo de despesa', valor: (l) => esc(l.tipo || '—') },
  { rotulo: 'Descrição', texto: true, valor: (l) => esc(l.descricao || '—') },
  { rotulo: 'Fornecedor', texto: true, valor: (l) => esc(l.fornecedor || '—') },
  { rotulo: 'Natureza', valor: (l) => esc(NATUREZAS[l.natureza] || l.natureza || '—') },
  { rotulo: 'Classificação', valor: (l) => (l.classificacao === 'investimento' ? 'Investimento' : 'Despesa') },
  { rotulo: 'Consumo', valor: (l) => esc(resumoConsumo(l) || 'própria') },
  { rotulo: 'Origem', valor: (l) => esc((ORIGENS[origemDe(l)] || {}).curto || '—') },
  { rotulo: 'Reconhecido', valor: (l) => (reconhecidoDe(l) ? 'Sim' : 'Não') },
  { rotulo: 'Valor', n: true, valor: (l) => brl(l.valor) },
];

/**
 * Detalhamento dos lançamentos de um indicador, com a ação de reconhecer em
 * lote: quem abriu "o que falta reconhecer" veio para resolver, e mandá-lo
 * clicar um a um na tela de Lançamentos seria devolver o problema.
 */
/**
 * Classificar despesas compartilhadas em lote.
 *
 * O que se classifica é o CONTRATO, não o mês: a lista mostra uma linha por
 * série de despesa fixa (tipo · fornecedor · quem paga), com quantos meses ela
 * tem e quanto custa por mês. Listar 1.457 lançamentos faria escolher doze
 * vezes a mesma coisa e errar em alguma delas.
 */
function abrirClassificacaoCompartilhada(r) {
  const base = Loja.todosDoEscopo().filter((l) =>
    l.natureza === 'fixa' && passaNoFiltro(E.cenariosSel, l.cenario) && naFilialDoBloco(l.filial, r));
  // A identidade do contrato é o `grupo` — é a série que o próprio sistema
  // criou ao lançar a recorrência, e é ela que a propagação alcança. Agrupar por
  // tipo + unidade juntaria FALEMAIS e BRISANET numa linha só "Telefonia/Internet",
  // e classificar uma arrastaria a outra. Sem grupo, cai no que descreve a
  // despesa.
  const chaveDe = (l) => (l.grupo
    ? 'g\u0001' + l.grupo
    : ['x', l.tipo || '', l.descricao || '', l.empresa, l.filial || ''].join('\u0001'));
  const contratos = new Map();
  for (const l of base) {
    const k = chaveDe(l);
    const c = contratos.get(k) || {
      chave: k, tipo: l.tipo,
      // O favorecido dos lançamentos de planilha está dentro da DESCRIÇÃO, e
      // não no campo próprio: é ela que identifica o contrato para quem lê.
      nome: l.descricao || l.fornecedor || l.tipo || '(sem descrição)',
      empresa: l.empresa,
      nomeEmpresa: String(nomeEmpresa(l.empresa)), cor: corDaMatriz(l.empresa),
      filial: l.filial || 'Sem filial (nível empresa)', itens: [],
    };
    c.itens.push(l);
    contratos.set(k, c);
  }
  const lista = [...contratos.values()].map((c) => {
    const comps = ordenado([...new Set(c.itens.map((l) => l.competencia))]);
    const ultimo = comps[comps.length - 1];
    const doUltimo = c.itens.filter((l) => l.competencia === ultimo);
    return {
      ...c, meses: comps.length,
      // O período distingue duas séries do MESMO fornecedor na mesma unidade,
      // que a base tem: sem ele, as duas linhas parecem a mesma repetida e
      // ninguém sabe qual marcar.
      periodo: comps.length
        ? (comps[0] === ultimo ? mesExib(ultimo) : `${mesExib(comps[0])} a ${mesExib(ultimo)}`)
        : '',
      porMes: reais(doUltimo.reduce((s, l) => s + cent(l.valor), 0)),
      compartilhada: c.itens.some((l) => consumoDe(l) === 'compartilhado'),
      marco: regularizadaEmDe(c.itens.find((l) => regularizadaEmDe(l)) || {}),
    };
  }).sort((a, b) => b.porMes - a.porMes);

  const filiais = filiaisDoEscopo().map((f) => f.nome);
  abrirModal({
    titulo: 'Classificar despesas compartilhadas',
    tipo: 'classificar-consumo',
    larguraPadrao: Math.min(1100, Math.max(window.innerWidth - 40, 680)),
    corpo: `
      <div class="msg">
        <strong>Uma linha por contrato de despesa fixa</strong>, e não por lançamento: a classificação
        vale para a série inteira, porque ser compartilhada é um fato do contrato e não de um mês.
        Marque os que uma filial paga e o grupo consome.
      </div>
      <div class="grade g2">
        <div class="campo"><label for="cc-todas">Quem consome</label>
          <select id="cc-todas">
            <option value="todas">Todas as filiais do grupo</option>
            <option value="escolher">Escolher filiais</option>
            <option value="integral">Voltar para 100% da filial que paga</option>
          </select></div>
        <div class="campo"><label for="cc-reg">Regularizada em (MM/AAAA)</label>
          <input id="cc-reg" placeholder="em branco = ainda compartilhada"></div>
      </div>
      <div class="campo" id="cc-filiais-campo" hidden>
        <label>Filiais beneficiadas</label>
        <div class="multi-caixas" role="group" aria-label="Filiais beneficiadas">
          ${filiais.map((n) => `<label><input type="checkbox" data-cc-filial="${esc(n)}"> ${esc(n)}</label>`).join('')}
        </div>
      </div>
      <div class="campo"><label for="cc-just">Justificativa</label>
        <input id="cc-just" placeholder="obrigatória para competências passadas ou fechadas"></div>
      <!-- A busca não é conveniência: são ${inteiro(lista.length)} contratos, e
           rolar até achar um seria pior do que editar lançamento por lançamento. -->
      <div class="campo"><label for="cc-busca">Buscar</label>
        <input id="cc-busca" placeholder="descrição, tipo de despesa, empresa ou filial"></div>
      <div class="rol" style="max-height:340px"><table>
        <thead><tr><th style="width:28px"></th><th>Contrato / descrição</th><th>Tipo</th>
          <th>Quem paga</th><th class="n">Meses</th><th class="n">Por mês</th><th>Hoje</th></tr></thead>
        <tbody>${lista.map((c, i) => `<tr data-cc-linha="${i}"
          data-busca="${esc(`${c.nome} ${c.tipo || ''} ${c.nomeEmpresa} ${c.filial}`.toLowerCase())}">
          <td><input type="checkbox" data-cc="${i}"${c.compartilhada ? ' checked' : ''}
            aria-label="Selecionar ${esc(c.nome)}"></td>
          <td class="texto">${esc(c.nome)}<div class="arv-comp">${esc(c.periodo)}</div></td>
          <td>${esc(c.tipo || '—')}</td>
          <td><i class="ponto-matriz" style="background:${c.cor}" aria-hidden="true"></i>${esc(c.nomeEmpresa)}
            <div class="arv-comp">${esc(c.filial)}</div></td>
          <td class="n">${inteiro(c.meses)}</td>
          <td class="n">${brl(c.porMes)}</td>
          <td>${c.compartilhada
            ? `<span class="tag compartilhada" style="--cor:${corCompartilhada(c.empresa)}"><i></i>compartilhada${
                c.marco ? ' · ' + mesExib(c.marco) : ''}</span>`
            : '<span style="color:var(--tinta3)">100% da filial</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`,
    acoes: `<button type="button" class="bt" data-todos>Marcar os visíveis</button>
      <button type="button" class="bt pri" data-aplicar>Aplicar aos marcados</button>
      <button type="button" class="bt" data-c>Fechar</button>`,
    aoMontar({ raiz, fechar, erro }) {
      const caixas = [...raiz.querySelectorAll('input[data-cc]')];
      const quem = raiz.querySelector('#cc-todas');
      const campoFiliais = raiz.querySelector('#cc-filiais-campo');
      const campoReg = raiz.querySelector('#cc-reg');
      const alternar = () => {
        campoFiliais.hidden = quem.value !== 'escolher';
        // Voltar para integral apaga o compartilhamento: um marco de adequação
        // ali não descreveria nada, então o campo sai de cena junto.
        campoReg.closest('.campo').hidden = quem.value === 'integral';
      };
      quem.addEventListener('change', alternar);
      alternar();

      const linhas = [...raiz.querySelectorAll('[data-cc-linha]')];
      const visiveis = () => linhas.filter((tr) => !tr.hidden);
      raiz.querySelector('#cc-busca').addEventListener('input', (ev) => {
        const termo = ev.target.value.trim().toLowerCase();
        for (const tr of linhas) tr.hidden = !!termo && !tr.dataset.busca.includes(termo);
      });
      // "Marcar todos" sobre mil e duzentos contratos seria um clique capaz de
      // reclassificar a base inteira sem ninguém ver o que entrou. A ação vale
      // para o que está À VISTA, que é o recorte que a pessoa acabou de montar.
      raiz.querySelector('[data-todos]').onclick = () => {
        const alvo = visiveis().map((tr) => tr.querySelector('input[data-cc]'));
        const ligar = !alvo.every((c) => c.checked);
        alvo.forEach((c) => { c.checked = ligar; });
      };
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-aplicar]').onclick = async () => {
        const alvos = caixas.filter((c) => c.checked).map((c) => lista[Number(c.dataset.cc)]);
        if (!alvos.length) return erro('Marque ao menos um contrato.');
        const integral = quem.value === 'integral';
        const escolhidas = [...raiz.querySelectorAll('[data-cc-filial]:checked')].map((c) => c.dataset.ccFilial);
        if (quem.value === 'escolher' && !escolhidas.length) {
          return erro('Marque ao menos uma filial beneficiada, ou escolha "todas as filiais do grupo".');
        }
        const regBruto = campoReg.value.trim();
        const regularizadaEm = !integral && regBruto ? mesInterno(regBruto) : null;
        if (!integral && regBruto && !regularizadaEm) {
          return erro('Regularizada em: use MM/AAAA, ou deixe em branco se ainda não houve.');
        }
        try {
          // Um alvo de cada série basta: o gravador propaga para os irmãos.
          const conta = await classificarCompartilhadasEmLote(
            alvos.map((c) => c.itens[0]),
            {
              tipoConsumo: integral ? 'integral' : 'compartilhado',
              beneficiaTodas: quem.value === 'todas',
              beneficiadas: quem.value === 'todas' ? filiais : escolhidas,
              regularizadaEm,
            },
            raiz.querySelector('#cc-just').value.trim());
          // O retorno da ação é o próprio bloco repintado: ele sai do estado
          // vazio e passa a mostrar os números. Um aviso por cima disso seria
          // dizer duas vezes a mesma coisa.
          void conta;
          fechar();
        } catch (e) {
          erro(e.message || String(e));
        }
      };
    },
  });
}

function abrirDetalhe({ titulo, tipo, itens, esperado }) {
  const soma = reais(somaC(itens.map((l) => l.valor)));
  const confere = esperado === null || Math.abs(soma - esperado) < 0.01;
  abrirModal({
    titulo, tipo,
    // A MESMA árvore do detalhamento da barra — tipo → empresa → filial →
    // lançamento. Esta tela tinha uma tabela plana própria, e duas telas que
    // listam a mesma coisa de dois jeitos obrigam quem usa a reaprender a
    // leitura a cada clique. A caixa de seleção do lote entra no nível 4, que é
    // onde o lançamento está.
    larguraPadrao: Math.min(1180, Math.max(window.innerWidth - 40, 680)),
    corpo: `
      <div class="msg${confere ? '' : ' erro'}">
        <strong>${inteiro(itens.length)} lançamento(s) · ${brl(soma)}.</strong>
        ${esperado === null ? '' : confere ? ' Confere com o indicador.' : ` Diverge: o indicador mostra ${brl(esperado)}.`}
        Abra um tipo de despesa para chegar aos lançamentos e marcá-los.
      </div>
      ${arvoreDoDetalhamentoHtml(itens, (l) => `<input type="checkbox" data-sel-lanc="${esc(l.id)}"
        data-comp="${esc(l.competencia)}" data-emp="${esc(l.empresa)}"${reconhecidoDe(l) ? ' disabled' : ''}
        aria-label="Selecionar ${esc(l.descricao || l.tipo)}">`)}`,
    acoes: `<button type="button" class="bt" data-todos>Marcar todos</button>
      <button type="button" class="bt pri" data-reconhecer disabled>Reconhecer selecionados</button>
      <button type="button" class="bt" data-c>Fechar</button>`,
    aoMontar({ raiz, fechar }) {
      const caixas = [...raiz.querySelectorAll('input[data-sel-lanc]:not([disabled])')];
      const bt = raiz.querySelector('[data-reconhecer]');
      const contar = () => {
        const n = caixas.filter((c) => c.checked).length;
        bt.disabled = n === 0;
        bt.textContent = n ? `Reconhecer ${inteiro(n)} selecionado(s)` : 'Reconhecer selecionados';
      };
      caixas.forEach((c) => c.addEventListener('change', contar));
      raiz.querySelector('[data-todos]').onclick = () => {
        const ligar = !caixas.every((c) => c.checked);
        caixas.forEach((c) => { c.checked = ligar; });
        contar();
      };
      raiz.querySelector('[data-c]').onclick = fechar;
      ligarArvoreDoDetalhamento(raiz);
      // Marcar a caixa não pode abrir ou fechar o nó em que ela mora.
      caixas.forEach((c) => c.addEventListener('click', (ev) => ev.stopPropagation()));
      bt.onclick = async () => {
        bt.disabled = true;
        const alvos = caixas.filter((c) => c.checked).map((c) =>
          itens.find((l) => l.id === c.dataset.selLanc && l.competencia === c.dataset.comp));
        await alternarReconhecimento(alvos, true);
        fechar();
      };
      contar();
    },
  });
}
