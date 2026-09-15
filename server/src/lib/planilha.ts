import ExcelJS from 'exceljs';

export interface Aba {
  nome: string;
  colunas: string[];
  linhas: Array<Record<string, unknown>>;
}

// --------------------------------------------------------------------- CSV

/** Detecta o separador dominante no cabeçalho (`;` é o padrão do Excel pt-BR). */
function detectarSeparador(primeiraLinha: string): string {
  const candidatos = [';', ',', '\t'];
  let melhor = ';';
  let maior = -1;
  for (const c of candidatos) {
    const n = primeiraLinha.split(c).length;
    if (n > maior) {
      maior = n;
      melhor = c;
    }
  }
  return melhor;
}

export function lerCsv(conteudo: string): Array<Record<string, string>> {
  const texto = conteudo.replace(/^﻿/, '');
  const separador = detectarSeparador(texto.split(/\r?\n/, 1)[0] ?? '');

  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (entreAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        campo += ch;
      }
      continue;
    }
    if (ch === '"') {
      entreAspas = true;
    } else if (ch === separador) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n') {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else if (ch !== '\r') {
      campo += ch;
    }
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  const cabecalho = (linhas.shift() ?? []).map((c) => c.trim());
  return linhas
    .filter((l) => l.some((c) => c.trim() !== ''))
    .map((l) => Object.fromEntries(cabecalho.map((coluna, i) => [coluna, restaurarFormula((l[i] ?? '').trim())])));
}

/**
 * Neutraliza fórmula em célula de CSV.
 *
 * Excel e LibreOffice interpretam um valor iniciado por `=`, `+`, `-`, `@`,
 * tabulação ou CR como fórmula. Como descrições, observações e nomes vêm do
 * usuário e voltam na exportação, um valor como `=WEBSERVICE(...)` executaria
 * na máquina de quem abrir a planilha. O apóstrofo à frente força o texto.
 */
function neutralizarFormula(texto: string): string {
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

/**
 * Inverso de `neutralizarFormula`, aplicado na leitura para que exportar e
 * reimportar devolva exatamente o valor original.
 */
function restaurarFormula(texto: string): string {
  return /^'[=+\-@\t\r]/.test(texto) ? texto.slice(1) : texto;
}

export function escreverCsv(colunas: string[], linhas: Array<Record<string, unknown>>): string {
  const escapar = (v: unknown) => {
    const texto = neutralizarFormula(v === null || v === undefined ? '' : String(v));
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const corpo = linhas.map((l) => colunas.map((c) => escapar(l[c])).join(';'));
  return '﻿' + [colunas.join(';'), ...corpo].join('\r\n') + '\r\n';
}

// -------------------------------------------------------------------- XLSX

export async function lerXlsx(buffer: Buffer): Promise<Aba[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const abas: Aba[] = [];
  wb.eachSheet((ws) => {
    const cabecalho: string[] = [];
    const linhaCabecalho = ws.getRow(1);
    linhaCabecalho.eachCell({ includeEmpty: false }, (cell, col) => {
      cabecalho[col - 1] = String(cell.value ?? '').trim();
    });
    const linhas: Array<Record<string, unknown>> = [];
    ws.eachRow({ includeEmpty: false }, (row, numero) => {
      if (numero === 1) return;
      const registro: Record<string, unknown> = {};
      let vazia = true;
      cabecalho.forEach((coluna, i) => {
        if (!coluna) return;
        const cell = row.getCell(i + 1);
        let valor = cell.value;
        if (valor && typeof valor === 'object' && 'result' in valor) valor = (valor as { result: unknown }).result as never;
        if (valor && typeof valor === 'object' && 'text' in valor) valor = (valor as { text: string }).text as never;
        if (valor instanceof Date) {
          valor = `${String(valor.getMonth() + 1).padStart(2, '0')}/${valor.getFullYear()}` as never;
        }
        const texto = restaurarFormula(valor === null || valor === undefined ? '' : String(valor).trim());
        if (texto !== '') vazia = false;
        registro[coluna] = texto;
      });
      if (!vazia) linhas.push(registro);
    });
    abas.push({ nome: ws.name, colunas: cabecalho.filter(Boolean), linhas });
  });
  return abas;
}

export async function escreverXlsx(abas: Aba[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GSTI.IARX';
  wb.created = new Date();
  for (const aba of abas) {
    const ws = wb.addWorksheet(aba.nome);
    ws.columns = aba.colunas.map((c) => ({ header: c, key: c, width: Math.min(Math.max(c.length + 4, 14), 40) }));
    for (const linha of aba.linhas) {
      ws.addRow(
        Object.fromEntries(
          Object.entries(linha).map(([k, v]) => [k, typeof v === 'string' ? neutralizarFormula(v) : v]),
        ),
      );
    }
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF5' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (aba.colunas.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: aba.colunas.length } };
    }
  }
  const dados = await wb.xlsx.writeBuffer();
  return Buffer.from(dados);
}
