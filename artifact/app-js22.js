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
