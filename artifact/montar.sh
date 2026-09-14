#!/bin/sh
# Monta sistema.html. Ordem importa: app-js7 traz o IIFE de inicialização e
# precisa ser o último, senão os const dos módulos seguintes ficam em TDZ.
set -e
cd "$(dirname "$0")"
{
  cat app-head.html
  cat app-body.html
  echo '<script>'
  cat app-js1.js app-js12.js app-js2.js app-js3.js app-js4.js app-js5.js app-js6.js app-js8.js app-js9.js app-js10.js app-js11.js app-js13.js app-js14.js app-js15.js app-js16.js app-js17.js app-js7.js
  echo '</script>'
} > sistema.html
node -e '
  const fs=require("fs"),h=fs.readFileSync("sistema.html","utf8");
  // lastIndexOf: o cabeçalho tem um <script> próprio (o tema), e o bloco a
  // conferir é o último do arquivo.
  const js=h.slice(h.lastIndexOf("<script>")+8, h.lastIndexOf("</script>"));
  fs.writeFileSync("_chk.js", js);'
node --check _chk.js && rm -f _chk.js
wc -c sistema.html
