// ===========================================================================
// MOTOR DE HORAS ÚTEIS — o relógio do SLA.
//
// Prazo de SLA não corre em horas de relógio: corre dentro do expediente. Um
// chamado aberto na sexta às 17h30 com 4 horas de prazo não vence às 21h30 de
// sexta — ele vence na segunda de manhã, porque ninguém trabalhou no meio.
// Medir em horas corridas reprova a equipe pelo fim de semana.
//
// A janela é a do contrato:
//   segunda a quinta  08:00–18:00   (10 h)
//   sexta             08:00–17:00   ( 9 h)
//   sábado, domingo e FERIADO       ( 0 h)
//
// O motor é puro: recebe as pontas e o calendário, devolve horas. Nenhuma
// leitura de estado global — é o que torna possível testá-lo com um caso de
// cada vez, e é onde o cálculo tem de estar certo antes de aparecer em
// qualquer tela.
// ===========================================================================

/** A janela de expediente de cada dia da semana, em horas decimais. */
const EXPEDIENTE = [
  null,                    // domingo
  { de: 8, ate: 18 },      // segunda
  { de: 8, ate: 18 },      // terça
  { de: 8, ate: 18 },      // quarta
  { de: 8, ate: 18 },      // quinta
  { de: 8, ate: 17 },      // sexta
  null,                    // sábado
];

/**
 * A data como AAAA-MM-DD no fuso LOCAL.
 *
 * `toISOString().slice(0,10)` daria o dia em UTC, e no Brasil (UTC−3) um
 * chamado aberto às 22h de segunda viraria terça — deslocando o expediente
 * inteiro de um dia.
 */
function diaLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** O conjunto de feriados do cliente, como AAAA-MM-DD. */
function feriadosDoCliente(cliente = E.clienteSel) {
  return new Set((E.feriados || [])
    .filter((f) => f.cliente === cliente && f.ativo !== false)
    .map((f) => String(f.data || '').slice(0, 10))
    .filter(Boolean));
}

/** A janela útil de um dia: `null` em fim de semana e feriado. */
function janelaDoDia(d, feriados) {
  if (feriados && feriados.has(diaLocal(d))) return null;
  return EXPEDIENTE[d.getDay()];
}

/** A hora decimal do instante dentro do dia: 17:30 → 17,5. */
const horaDecimal = (d) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

/** O mesmo dia, à hora decimal pedida. */
function noDiaAs(d, hora) {
  const x = new Date(d);
  x.setHours(Math.floor(hora), Math.round((hora % 1) * 60), 0, 0);
  return x;
}

/**
 * As HORAS ÚTEIS entre dois instantes.
 *
 * Tempo fora do expediente não conta; fim de semana e feriado não contam. Se
 * o chamado foi aberto fora do expediente, o relógio só começa no próximo
 * horário útil — o que significa que abrir às 22h de terça e às 8h de quarta
 * dá o mesmo consumo, que é o que o contrato promete.
 *
 * Fim antes do início devolve 0, e não um número negativo: uma data invertida
 * é erro de dado, e um consumo negativo se espalharia como "dentro do prazo".
 */
function horasUteis(inicioISO, fimISO, feriados) {
  const ini = new Date(inicioISO);
  const fim = new Date(fimISO);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) return null;
  if (fim <= ini) return 0;

  const dias = feriados || feriadosDoCliente();
  let total = 0;
  const cursor = new Date(ini);
  cursor.setHours(0, 0, 0, 0);
  // Um teto de dias para a varredura nunca virar laço infinito se as pontas
  // vierem absurdamente distantes por erro de dado.
  const LIMITE = 3660;
  for (let i = 0; i < LIMITE; i += 1) {
    if (cursor > fim) break;
    const janela = janelaDoDia(cursor, dias);
    if (janela) {
      const abre = noDiaAs(cursor, janela.de);
      const fecha = noDiaAs(cursor, janela.ate);
      const de = ini > abre ? ini : abre;
      const ate = fim < fecha ? fim : fecha;
      if (ate > de) total += (ate - de) / 3600000;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * O instante em que vencem N horas úteis a partir de um início.
 *
 * É o inverso de `horasUteis`, e é o que a tela mostra como "prazo": uma data
 * e hora concretas, não um saldo. Abrir fora do expediente empurra o começo
 * para o próximo horário útil.
 */
function prazoEmHorasUteis(inicioISO, horas, feriados) {
  const ini = new Date(inicioISO);
  if (Number.isNaN(ini.getTime()) || !Number.isFinite(horas) || horas < 0) return null;
  const dias = feriados || feriadosDoCliente();
  let restante = horas;
  const cursor = new Date(ini);
  const LIMITE = 3660;
  for (let i = 0; i < LIMITE; i += 1) {
    const janela = janelaDoDia(cursor, dias);
    if (janela) {
      const abre = noDiaAs(cursor, janela.de);
      const fecha = noDiaAs(cursor, janela.ate);
      const de = cursor > abre ? cursor : abre;
      if (fecha > de) {
        const disponivel = (fecha - de) / 3600000;
        if (restante <= disponivel) {
          return new Date(de.getTime() + restante * 3600000).toISOString();
        }
        restante -= disponivel;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return null;
}

/**
 * O semáforo da conformidade, como o contrato define.
 *
 *   ≥ 90%  excelente    · 70–89%  atenção    · < 70%  crítico
 *
 * A faixa do meio existe porque "abaixo da meta" não distingue 89% de 40%, e
 * as duas situações pedem reações diferentes.
 */
const FAIXAS_CONFORMIDADE = [
  { min: 90, nome: 'Excelente', curto: 'excelente', cor: 'var(--bomtxt)', simbolo: '✓' },
  { min: 70, nome: 'Bom (atenção necessária)', curto: 'atenção', cor: 'var(--alerta)', simbolo: '!' },
  { min: 0, nome: 'Crítico (requer ação imediata)', curto: 'crítico', cor: 'var(--crit)', simbolo: '✗' },
];
const faixaDaConformidade = (p) => (p === null || p === undefined
  ? { nome: 'Sem base para dizer', curto: 'sem base', cor: 'var(--tinta3)', simbolo: '·' }
  : FAIXAS_CONFORMIDADE.find((f) => p >= f.min) || FAIXAS_CONFORMIDADE[2]);

/** O selo do semáforo, com símbolo e palavra — a cor nunca é o único canal. */
const seloConformidadeHtml = (p) => {
  const f = faixaDaConformidade(p);
  return `<span class="tag" style="color:${f.cor};border-color:${f.cor}"
    title="${esc(f.nome)}">${f.simbolo} ${p === null || p === undefined ? '—' : pctTxt(p)}
    · ${esc(f.curto)}</span>`;
};

// ------------------------------------------------------ cadastro de feriados
/**
 * Os feriados são do CLIENTE, e não da unidade.
 *
 * Feriado municipal de uma filial não tira o expediente da matriz em outro
 * estado — mas o cadastro por unidade multiplicaria por dezessete uma lista
 * que é quase sempre a mesma. A lista é do contratante, e quem precisar de
 * um feriado local o inclui com a descrição dizendo de onde é.
 */
const feriadosDoClienteAtivo = () => (E.feriados || [])
  .filter((f) => f.cliente === E.clienteSel)
  .sort((a, b) => String(a.data).localeCompare(String(b.data)));

function viewFeriados() {
  const lista = feriadosDoClienteAtivo();
  const hoje = new Date().toISOString().slice(0, 10);
  const futuros = lista.filter((f) => f.data >= hoje);
  el('#pagina').innerHTML = `
    <div class="msg"><strong>O relógio do SLA não corre em horas de relógio: corre dentro do
      expediente.</strong> Segunda a quinta das <strong>08:00 às 18:00</strong>, sexta das
      <strong>08:00 às 17:00</strong>. Fim de semana e os feriados desta lista não contam —
      um chamado aberto na sexta às 17h30 com 4 horas de prazo vence na segunda de manhã, e
      medi-lo em horas corridas reprovaria a equipe pelo fim de semana.</div>

    <section class="bloco" data-dobra-padrao="aberto" style="margin-top:16px">
      <header><h2>Feriados</h2>
        <span class="nota">${inteiro(lista.length)} cadastrado(s) · ${
          inteiro(futuros.length)} ainda por vir</span>
        <button class="bt pri peq" id="fer-novo" style="margin-left:auto">Novo feriado</button></header>
      ${!lista.length
        ? '<p class="vazio">Nenhum feriado cadastrado — só fins de semana saem do cálculo.</p>'
        : `<div class="rol"><table>
          <thead><tr><th>Data</th><th>Dia</th><th>Descrição</th><th>Situação</th><th></th></tr></thead>
          <tbody>${lista.map((f, i) => `<tr${f.data < hoje ? ' style="color:var(--tinta3)"' : ''}>
            <td><strong>${esc(diaExib(f.data))}</strong></td>
            <td>${esc(nomeDoDia(f.data))}</td>
            <td>${esc(f.descricao || '—')}</td>
            <td>${f.ativo === false
              ? '<span class="tag">Desconsiderado</span>'
              : '<span class="tag bom">Conta como feriado</span>'}</td>
            <td style="white-space:nowrap">
              <button class="bt fant peq" data-fer-ed="${i}">Editar</button>
              <button class="bt fant peq" data-fer-alt="${i}">${
                f.ativo === false ? 'Reativar' : 'Desconsiderar'}</button></td>
          </tr>`).join('')}</tbody></table></div>`}
      <p class="nota" style="margin-top:10px">Um feriado <strong>desconsiderado</strong> continua
        na lista mas volta a contar como dia útil — é como se corrige um cadastro errado sem
        apagar o registro de que ele existiu.</p>
    </section>`;

  el('#fer-novo').onclick = () => formFeriado(null);
  el('#pagina').querySelectorAll('[data-fer-ed]').forEach((b) => {
    b.onclick = () => formFeriado(lista[Number(b.dataset.ferEd)]);
  });
  el('#pagina').querySelectorAll('[data-fer-alt]').forEach((b) => {
    b.onclick = () => alternarFeriado(lista[Number(b.dataset.ferAlt)]);
  });
  dobrarBlocos();
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** O dia da semana de uma data ISO, lido no fuso local. */
function nomeDoDia(iso) {
  const [a, m, d] = String(iso || '').split('-').map(Number);
  if (!a || !m || !d) return '—';
  const dia = new Date(a, m - 1, d).getDay();
  // Dizer que o feriado cai num sábado importa: ele não tira nenhuma hora
  // útil, e sem isso alguém o cadastra esperando um efeito que não vem.
  return DIAS_SEMANA[dia] + (EXPEDIENTE[dia] ? '' : ' — já não é dia útil');
}

function formFeriado(existente) {
  const v = existente || { data: '', descricao: '' };
  abrirModal({
    titulo: existente ? 'Editar feriado' : 'Novo feriado',
    corpo: `
      <div class="grade g2">
        <div class="campo"><label for="fe-data">Data</label>
          <input id="fe-data" name="data" inputmode="numeric" placeholder="DD/MM/AAAA"
            value="${esc(v.data ? diaExib(v.data) : '')}"></div>
        <div class="campo"><label for="fe-desc">Descrição</label>
          <input id="fe-desc" name="descricao" value="${esc(v.descricao || '')}"
            placeholder="Ex.: Nossa Senhora da Conceição — municipal de JP"></div>
      </div>`,
    acoes: '<button type="button" class="bt" data-c>Cancelar</button>'
      + '<button type="button" class="bt pri" data-s>Salvar</button>',
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const data = dataInterna(campo('data').value);
          if (!data) throw new Error('Informe a data no formato DD/MM/AAAA.');
          const descricao = campo('descricao').value.trim();
          if (!descricao) throw new Error('Informe a descrição do feriado — sem ela, ninguém sabe '
            + 'depois por que aquele dia saiu do cálculo.');
          const base = E.feriados || [];
          const repetido = base.find((f) => f.cliente === E.clienteSel && f.data === data
            && f !== existente);
          if (repetido) {
            throw new Error(`Já existe um feriado nesse dia: "${repetido.descricao}". `
              + 'Edite o que existe em vez de cadastrar um segundo.');
          }
          const lista = existente
            ? base.map((f) => (f === existente ? { ...f, data, descricao } : f))
            : [...base, { cliente: E.clienteSel, data, descricao, ativo: true }];
          await Loja.gravarCatalogo('feriados', lista);
          await Loja.auditar({ acao: existente ? 'atualizar' : 'criar', entidade: 'feriado',
            depois: { data, descricao } });
          fechar(); render();
        } catch (e) {
          erro(e && e.message ? e.message : String(e));
          ev.target.disabled = false;
        }
      };
    },
  });
}

async function alternarFeriado(f) {
  const lista = (E.feriados || []).map((x) => (x === f ? { ...x, ativo: x.ativo === false } : x));
  await Loja.gravarCatalogo('feriados', lista);
  await Loja.auditar({ entidade: 'feriado', acao: 'atualizar', id: f.data,
    descricao: `${diaExib(f.data)} — ${f.ativo === false ? 'volta a contar' : 'desconsiderado'}` });
  render();
}

/** DD/MM/AAAA → AAAA-MM-DD. Devolve '' quando não é data. */
function dataInterna(texto) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(texto || '').trim());
  if (!m) return '';
  const [, d, mes, a] = m;
  const iso = `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // Uma data como 31/02 passa pela expressão e não existe no calendário.
  const teste = new Date(Number(a), Number(mes) - 1, Number(d));
  return teste.getMonth() === Number(mes) - 1 && teste.getDate() === Number(d) ? iso : '';
}

// ======================================================= criticidade padrão
//
// O chamado importado chega SEM criticidade. A extração traz `nivel` — a
// classificação do próprio helpdesk, "N1", "Implementacao" —, que não é
// prioridade; e o acordo de SLA é por (tópico, prioridade). Sem prioridade não
// há acordo que alcance o chamado, e ele fica fora do cálculo sem que ninguém
// perceba: some da conta em vez de aparecer como problema.
//
// A saída é uma criticidade PADRÃO por cliente, e ela é opcional de propósito.
// Sem padrão cadastrado nada muda — inventar "Média" para todo mundo criaria
// julgamento de SLA em cima de uma classificação que ninguém fez, e um
// percentual assim é pior do que a ausência dele.

/** Como o chamado ganhou a criticidade que tem. */
const ORIGEM_CRITICIDADE = {
  importada: 'veio classificada na origem',
  padrao: 'padrão do cadastro de SLAs',
  manual: 'definida à mão nesta tela',
};
const ORIGEM_CURTA = { importada: 'da origem', padrao: 'padrão', manual: 'à mão' };

/** A criticidade padrão deste cliente, ou `null` quando não há uma. */
const criticidadePadrao = (cliente = E.clienteSel) => {
  const mapa = (E.config && E.config.criticidadePadrao) || {};
  const v = mapa[cliente];
  return PRIORIDADES_SLA.includes(v) ? v : null;
};

async function gravarCriticidadePadrao(valor, cliente = E.clienteSel) {
  const mapa = { ...((E.config && E.config.criticidadePadrao) || {}) };
  if (valor) mapa[cliente] = valor; else delete mapa[cliente];
  await Loja.gravarConfiguracao({ criticidadePadrao: mapa });
  await Loja.auditar({ acao: 'atualizar', entidade: 'criticidade_padrao',
    depois: { criticidade: valor ? ROTULO_PRIORIDADE_SLA[valor] : null } }, null);
}

/**
 * A criticidade e o prazo de um chamado que acaba de entrar.
 *
 * Duas coisas acontecem aqui, e a ordem importa: primeiro o chamado ganha
 * criticidade (a da origem, ou a padrão), e só então o acordo é consultado —
 * o acordo é POR criticidade, e medir antes de classificar não acharia acordo
 * nenhum.
 *
 * `medirPeloAcordo` devolve `null` quando não há acordo vigente, e aí o prazo
 * que a origem informou fica exatamente como estava. Quem não cadastrou acordo
 * não vê nada mudar.
 */
function classificarChamado(empresa, reg) {
  const r = { ...reg };
  if (r.prioridade) {
    r.prioridadeOrigem = r.prioridadeOrigem || 'importada';
  } else {
    const padrao = criticidadePadrao();
    if (!padrao) return r;               // sem padrão: o chamado segue sem criticidade
    r.prioridade = padrao;
    r.prioridadeOrigem = 'padrao';
  }
  const medida = medirPeloAcordo(empresa, r);
  return medida ? { ...r, ...medida } : r;
}

/** Data e hora do prazo, no formato do resto do sistema. */
const prazoEmTexto = (iso) => (iso
  ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : null);

/**
 * A situação do chamado contra o prazo: dentro, estourado, ou sem prazo.
 *
 * O chamado ABERTO é medido contra AGORA, e não contra a data da extração: um
 * chamado parado há três semanas está estourado hoje, e dizer que ele está
 * dentro porque a planilha é de ontem esconderia exatamente o caso que mais
 * importa.
 */
function situacaoDoPrazo(r) {
  if (!r || !r.prazoEm) return { tem: false, texto: 'sem prazo definido', classe: '' };
  const referencia = r.fechadoEm || new Date().toISOString();
  const dentro = referencia <= r.prazoEm;
  return {
    tem: true, dentro,
    texto: dentro
      ? (r.fechadoEm ? 'resolvido dentro do prazo' : 'dentro do prazo')
      : (r.fechadoEm ? 'resolvido fora do prazo' : 'prazo estourado'),
    classe: dentro ? 'bom' : 'crit',
    prazo: prazoEmTexto(r.prazoEm),
    fonte: r.prazoDoAcordo ? 'acordo cadastrado' : 'informado pelo helpdesk',
  };
}

// ------------------------------------- reprocessar o que já está importado
/**
 * O que a carga de retaguarda faria — sem gravar.
 *
 * Só alcança o chamado INDIVIDUAL (`total === 1`) e sem criticidade: o
 * registro agregado do mês não tem abertura nem prioridade, e arbitrar uma
 * seria inventar dado.
 */
function avaliarCriticidadePadrao(empresa, competencia) {
  const padrao = criticidadePadrao();
  const resumo = { avaliados: 0, classificados: 0, jaTinham: 0, agregados: 0,
    ganharamPrazo: 0, virouFora: 0 };
  const mudancas = [];
  if (!padrao) return { resumo, mudancas, padrao };
  for (const r of registrosDoMes(empresa, competencia)) {
    if (Number(r.total) !== 1) { resumo.agregados += 1; continue; }
    resumo.avaliados += 1;
    if (r.prioridade) { resumo.jaTinham += 1; continue; }
    const novo = classificarChamado(empresa, r);
    if (novo.prioridade !== padrao) continue;
    resumo.classificados += 1;
    if (novo.prazoEm && novo.prazoEm !== r.prazoEm) resumo.ganharamPrazo += 1;
    if (Number(novo.dentro) === 0 && Number(r.dentro) === 1) resumo.virouFora += 1;
    mudancas.push({ id: r.id, novo });
  }
  return { resumo, mudancas, padrao };
}

/** As competências em que ainda há chamado individual sem criticidade. */
function competenciasSemCriticidade(empresa) {
  const conta = new Map();
  for (const r of (E.sla.get(empresa) || [])) {
    if (Number(r.total) !== 1 || r.prioridade || !r.competencia) continue;
    conta.set(r.competencia, (conta.get(r.competencia) || 0) + 1);
  }
  return [...conta.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
}

function resumoCriticidadeHtml(linhas, aplicado, recusadas = []) {
  const total = (c) => linhas.reduce((s, l) => s + l.resumo[c], 0);
  const itens = [
    ['Chamados individuais avaliados', total('avaliados')],
    [aplicado ? 'Classificados pelo padrão' : 'Seriam classificados', total('classificados')],
    ['Ganharam prazo do acordo', total('ganharamPrazo')],
    ['Passaram a contar fora do prazo', total('virouFora')],
    ['Já tinham criticidade (intocados)', total('jaTinham')],
    ['Registros agregados (fora da conta)', total('agregados')],
  ];
  return `<div class="msg ${aplicado ? 'ok' : ''}">
    <strong>${aplicado ? 'Criticidade padrão aplicada.' : 'Prévia — nada foi gravado.'}</strong>
    <dl class="ficha" style="margin-top:6px">${itens
      .map(([r, v]) => `<dt>${esc(r)}</dt><dd>${inteiro(v)}</dd>`).join('')}</dl>
    ${recusadas.length ? `<p class="nota" style="margin-top:8px">Não alcançou
      ${esc(recusadas.map((x) => mesExib(x.comp)).join(', '))}: ${esc(recusadas[0].motivo)}</p>` : ''}
    ${aplicado ? '' : '<p class="nota" style="margin-top:8px">Classificar muda o prazo e pode '
      + 'mudar o dentro/fora de chamado já contado — o percentual do mês se move.</p>'}</div>`;
}

/** O bloco do cadastro de SLAs que define a criticidade padrão e reprocessa. */
function blocoCriticidadePadraoHtml(emp) {
  const padrao = criticidadePadrao();
  const pendentes = competenciasSemCriticidade(emp);
  const semCritico = pendentes.reduce((s, [, n]) => s + n, 0);
  return `
    <section class="bloco">
      <header><h2>Criticidade padrão dos chamados importados</h2>
        <span class="nota">vale para o cliente inteiro</span></header>
      <p class="nota">A extração do helpdesk traz <strong>nível</strong> (N1, N2, Implementação),
        que não é criticidade. Sem criticidade, nenhum acordo alcança o chamado e ele some da conta
        de conformidade em vez de aparecer como problema. Defina aqui com que criticidade entra o
        chamado que chega sem uma.</p>
      <div class="grade g2" style="margin-top:10px">
        <div class="campo"><label for="cp-pad">Criticidade padrão</label>
          <select id="cp-pad">
            <option value="">Nenhuma — o chamado entra sem criticidade</option>
            ${PRIORIDADES_SLA.map((p) => `<option value="${esc(p)}"${p === padrao ? ' selected' : ''}
              >${esc(ROTULO_PRIORIDADE_SLA[p])}</option>`).join('')}
          </select></div>
        <div class="campo" style="justify-content:flex-end">
          <button class="bt pri" id="cp-salvar">Salvar a criticidade padrão</button></div>
      </div>
      <div id="cp-salvo" style="margin-top:10px"></div>

      <h3 class="titulo-mini" style="margin-top:18px">Chamados já importados sem criticidade</h3>
      ${!semCritico
        ? '<p class="nota">Nenhum chamado individual desta unidade está sem criticidade.</p>'
        : `<p class="nota"><strong>${inteiro(semCritico)} chamado(s)</strong> em
            ${inteiro(pendentes.length)} competência(s): ${esc(pendentes
              .map(([c, n]) => `${mesExib(c)} (${n})`).join(' · '))}.
            A carga aplica a criticidade padrão a todos eles e refaz o prazo pelo acordo. Mês
            encerrado é recusado, e mês passado exige justificativa — os recusados são nomeados
            no resultado.</p>
          <div class="campo" style="max-width:420px;margin-top:10px">
            <label for="cp-just">Justificativa</label>
            <input id="cp-just" placeholder="obrigatória em mês já encerrado"></div>
          <div class="acoes" style="justify-content:flex-start;margin-top:10px">
            <button class="bt" id="cp-previa">Ver o que mudaria</button>
            <button class="bt pri" id="cp-aplicar"${padrao ? '' : ' disabled'}>Aplicar a todas</button>
          </div>
          ${padrao ? '' : '<p class="nota" style="margin-top:8px;color:var(--alerta)">'
            + 'Defina a criticidade padrão acima para poder aplicar.</p>'}`}
      <div id="cp-resultado" style="margin-top:12px"></div>
    </section>`;
}

function ligarCriticidadePadrao(emp) {
  const pagina = el('#pagina');
  const salvo = pagina.querySelector('#cp-salvo');
  const saida = pagina.querySelector('#cp-resultado');

  pagina.querySelector('#cp-salvar')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      await gravarCriticidadePadrao(pagina.querySelector('#cp-pad').value || null);
      // O `render()` refaz a tela com o valor novo; a mensagem sobreviveria a
      // ele por acaso, então é escrita depois e na tela nova.
      await render();
      const caixa = el('#pagina').querySelector('#cp-salvo');
      if (caixa) caixa.innerHTML = '<div class="msg ok">Criticidade padrão salva. Ela vale para '
        + 'os chamados que entrarem daqui em diante; para os já importados, use a carga abaixo.</div>';
    } catch (e) {
      salvo.innerHTML = `<div class="msg erro">${esc(e.message)}</div>`;
      ev.target.disabled = false;
    }
  });

  const varrer = () => competenciasSemCriticidade(emp)
    .map(([comp]) => ({ comp, ...avaliarCriticidadePadrao(emp, comp) }));

  pagina.querySelector('#cp-previa')?.addEventListener('click', () => {
    if (!criticidadePadrao()) {
      saida.innerHTML = '<div class="msg alerta">Sem criticidade padrão definida não há o que '
        + 'aplicar: escolha uma acima e salve.</div>';
      return;
    }
    saida.innerHTML = resumoCriticidadeHtml(varrer(), false);
  });

  pagina.querySelector('#cp-aplicar')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const just = pagina.querySelector('#cp-just')?.value || '';
    const feitas = [];
    const recusadas = [];
    try {
      // Tudo é LIDO antes de qualquer escrita, e não mês a mês: `gravarSlaMes`
      // invalida o cache de chamados da unidade, e `registrosDoMes` lendo do
      // cache já invalidado devolveria lista vazia — a gravação do segundo mês
      // apagaria os chamados dele. Ler primeiro torna o laço independente da
      // ordem das escritas.
      const planos = [];
      for (const bloco of varrer()) {
        // O porteiro de escrita é POR competência: um mês encerrado no meio do
        // caminho não pode abortar a carga inteira, nem passar despercebido.
        try { checarCompetencia(bloco.comp, just, emp); }
        catch (e) { recusadas.push({ comp: bloco.comp, motivo: e.message }); continue; }
        const porId = new Map(bloco.mudancas.map((m) => [String(m.id), m.novo]));
        planos.push({ bloco, itens: registrosDoMes(emp, bloco.comp)
          .map((r) => semCompetencia(porId.get(String(r.id)) || r)) });
      }
      for (const { bloco, itens } of planos) {
        if (bloco.mudancas.length) await Loja.gravarSlaMes(emp, bloco.comp, itens);
        feitas.push(bloco);
      }
      await Loja.slaDa(emp);
      const total = feitas.reduce((s, b) => s + b.resumo.classificados, 0);
      await Loja.auditar({ acao: 'classificar_padrao', entidade: 'ticket_sla',
        justificativa: just || null,
        depois: { criticidade: ROTULO_PRIORIDADE_SLA[criticidadePadrao()], classificados: total,
          competencias: feitas.map((b) => mesExib(b.comp)).join(', ') || 'nenhuma',
          recusadas: recusadas.map((r) => mesExib(r.comp)).join(', ') || 'nenhuma' } }, emp);
      const html = resumoCriticidadeHtml(feitas, true, recusadas);
      await render();
      const caixa = el('#pagina').querySelector('#cp-resultado');
      if (caixa) caixa.innerHTML = html;
    } catch (e) {
      saida.innerHTML = `<div class="msg erro">${esc(e.message)}</div>`;
      ev.target.disabled = false;
    }
  });
}
