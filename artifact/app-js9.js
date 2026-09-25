// ===========================================================================
// Codec de planilha: CSV e XLSX, sem biblioteca externa.
//
// Escrever xlsx é montar um zip de partes OOXML; como o conteúdo é pequeno,
// as entradas vão "stored" (sem compressão) — o Excel aceita e o código fica
// verificável. Ler usa DecompressionStream('deflate-raw'), que o navegador já
// traz, porque arquivos vindos do Excel chegam comprimidos.
// ===========================================================================

// ------------------------------------------------------------------- CSV
/** `;` é o separador que o Excel pt-BR espera; a detecção olha o cabeçalho. */
function detectarSeparador(primeira) {
  let melhor = ';', maior = -1;
  for (const c of [';', ',', '\t']) { const n = primeira.split(c).length; if (n > maior) { maior = n; melhor = c; } }
  return melhor;
}

/**
 * Excel executa célula iniciada por `=`, `+`, `-`, `@`, tab ou CR. Como
 * descrição e observação vêm do usuário e voltam na exportação, o apóstrofo
 * à frente força texto. `restaurarFormula` desfaz na leitura, para que
 * exportar e reimportar devolva o valor original.
 */
const neutralizarFormula = (t) => /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
const restaurarFormula = (t) => /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t;

function lerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const sep = detectarSeparador(t.split(/\r?\n/, 1)[0] || '');
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') { if (t[i+1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
      continue;
    }
    if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (ch !== '\r') campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  const cab = (linhas.shift() || []).map((c) => c.trim());
  return {
    colunas: cab,
    linhas: linhas.filter((l) => l.some((c) => c.trim() !== ''))
      .map((l) => Object.fromEntries(cab.map((c, i) => [c, restaurarFormula((l[i] || '').trim())]))),
  };
}

function escreverCsv(colunas, linhas) {
  const cel = (v) => {
    const t = neutralizarFormula(v === null || v === undefined ? '' : String(v));
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return '﻿' + [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => cel(l[c])).join(';'))].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------- ZIP
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const utf8 = (s) => new TextEncoder().encode(s);

/** Zip com entradas sem compressão — suficiente para os tamanhos aqui. */
function montarZip(arquivos) {
  const partes = [], central = [];
  let deslocamento = 0;
  for (const { nome, dados } of arquivos) {
    const n = utf8(nome), crc = crc32(dados), tam = dados.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x2100, true);
    local.setUint32(14, crc, true); local.setUint32(18, tam, true); local.setUint32(22, tam, true);
    local.setUint16(26, n.length, true); local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), n, dados);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true); dir.setUint16(10, 0, true); dir.setUint16(12, 0, true); dir.setUint16(14, 0x2100, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, tam, true); dir.setUint32(24, tam, true);
    dir.setUint16(28, n.length, true); dir.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(dir.buffer), n);
    deslocamento += 30 + n.length + tam;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, deslocamento, true);
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const total = todas.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let i = 0; for (const p of todas) { saida.set(p, i); i += p.length; }
  return saida;
}

async function abrirZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // O fim do diretório central fica nos últimos 64 KiB; procura de trás para frente.
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('Arquivo .xlsx inválido: diretório do zip não encontrado.');
  const n = dv.getUint16(fim + 10, true);
  let p = dv.getUint32(fim + 16, true);
  const saida = new Map();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Arquivo .xlsx inválido: diretório corrompido.');
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const tamNome = dv.getUint16(p + 28, true);
    const tamExtra = dv.getUint16(p + 30, true);
    const tamCom = dv.getUint16(p + 32, true);
    const desloc = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + tamNome));
    const nomeLocal = dv.getUint16(desloc + 26, true);
    const extraLocal = dv.getUint16(desloc + 28, true);
    const inicio = desloc + 30 + nomeLocal + extraLocal;
    const bruto = bytes.subarray(inicio, inicio + tamComp);
    saida.set(nome, metodo === 0 ? bruto : await inflar(bruto));
    p += 46 + tamNome + tamExtra + tamCom;
  }
  return saida;
}

async function inflar(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Este navegador não descomprime .xlsx. Salve a planilha como CSV e importe o CSV.');
  }
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

// ------------------------------------------------------------------ XLSX
const escX = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]))
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
/** A1, B1 … AA1: coluna em base 26 sem zero. */
function refCelula(col, linha) {
  let s = '', n = col + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s + linha;
}

function folhaXml(colunas, linhas) {
  const celula = (c, l, valor) => {
    const ref = refCelula(c, l);
    if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}"><v>${valor}</v></c>`;
    const t = neutralizarFormula(valor === null || valor === undefined ? '' : String(valor));
    return t === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escX(t)}</t></is></c>`;
  };
  const cabecalho = `<row r="1">${colunas.map((c, i) => celula(i, 1, c)).join('')}</row>`;
  const corpo = linhas.map((reg, j) =>
    `<row r="${j + 2}">${colunas.map((c, i) => celula(i, j + 2, reg[c])).join('')}</row>`).join('');
  const larguras = colunas.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(c.length + 4, 14), 40)}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${larguras}</cols><sheetData>${cabecalho}${corpo}</sheetData></worksheet>`;
}

/** abas: [{nome, colunas, linhas}] */
function escreverXlsx(abas) {
  const arq = [];
  const tipos = abas.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  arq.push({ nome: '[Content_Types].xml', dados: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${tipos}</Types>`) });
  arq.push({ nome: '_rels/.rels', dados: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`) });
  arq.push({ nome: 'xl/workbook.xml', dados: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${abas.map((a, i) => `<sheet name="${escX(a.nome)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}
</sheets></workbook>`) });
  arq.push({ nome: 'xl/_rels/workbook.xml.rels', dados: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${abas.map((_, i) => `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}
</Relationships>`) });
  abas.forEach((a, i) => arq.push({ nome: `xl/worksheets/sheet${i+1}.xml`, dados: utf8(folhaXml(a.colunas, a.linhas)) }));
  return montarZip(arq);
}

/** Extrai o texto de uma célula, resolvendo string compartilhada e inline. */
function textoCelula(xml, compartilhadas) {
  const tipo = /\st="([^"]+)"/.exec(xml);
  const t = tipo ? tipo[1] : 'n';
  if (t === 'inlineStr') {
    const partes = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    return desescapar(partes.join(''));
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(xml);
  if (!v) return '';
  if (t === 's') return compartilhadas[+v[1]] ?? '';
  return desescapar(v[1]);
}
const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const colunaDe = (ref) => { const m = /^([A-Z]+)/.exec(ref); if (!m) return 0;
  let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

async function lerXlsx(bytes) {
  const partes = await abrirZip(bytes);
  const texto = (n) => partes.has(n) ? new TextDecoder().decode(partes.get(n)) : '';

  const compartilhadas = [...texto('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));

  const rels = new Map([...texto('xl/_rels/workbook.xml.rels')
    .matchAll(/<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?xl\//, '')]));
  const folhas = [...texto('xl/workbook.xml').matchAll(/<sheet\s[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/g)]
    .map((m) => ({ nome: desescapar(m[1]), caminho: 'xl/' + (rels.get(m[2]) || '') }));
  if (!folhas.length) {
    for (const n of partes.keys()) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) folhas.push({ nome: n, caminho: n });
  }

  return folhas.map(({ nome, caminho }) => {
    const xml = texto(caminho);
    const linhasXml = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((m) => m[1]);
    const grade = linhasXml.map((conteudo) => {
      const celulas = [];
      for (const m of conteudo.matchAll(/<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(m[1]);
        celulas[ref ? colunaDe(ref[1]) : celulas.length] = textoCelula(m[1] + '>' + (m[3] || ''), compartilhadas);
      }
      return celulas;
    });
    const cab = (grade.shift() || []).map((c) => String(c ?? '').trim());
    return {
      nome,
      colunas: cab.filter(Boolean),
      linhas: grade.filter((l) => l.some((c) => String(c ?? '').trim() !== ''))
        .map((l) => Object.fromEntries(cab.map((c, i) => c ? [c, restaurarFormula(String(l[i] ?? '').trim())] : null).filter(Boolean))),
    };
  });
}
