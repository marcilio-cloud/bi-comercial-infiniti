"""Instalador conservador: injeta 4 módulos sem mudar HTML/tema/filtros originais.

Execute a partir da pasta do repositório BI Comercial Infiniti que contém app.py.
Cria backup de app.py antes de escrever. Segurança: falha se estrutura divergir.
"""
from pathlib import Path
import re
import shutil
import hashlib

root = Path(__file__).resolve().parent
app = root / 'app.py'
addon = root / 'indicadores_operacionais_infiniti.js'
backup = root / 'app.py.antes_dos_4_indicadores.bak'

if not app.is_file():
    raise SystemExit('ERRO: app.py não encontrado nesta pasta. Nada foi alterado.')
if not addon.is_file():
    raise SystemExit('ERRO: indicadores_operacionais_infiniti.js não encontrado nesta pasta. Nada foi alterado.')

original = app.read_text(encoding='utf-8')
if 'indicadores_operacionais_infiniti.js' in original:
    print('O app.py já contém uma integração desse módulo. Nenhuma alteração feita.')
    print('Para atualizar apenas o tema, substitua somente indicadores_operacionais_infiniti.js.')
    raise SystemExit(0)

numeric = re.search(r'numeric_cols\s*=\s*\{([^}]*)\}', original)
if not numeric:
    raise SystemExit('ERRO: conjunto numeric_cols do app.py não encontrado. Nada foi alterado.')
if 'from pathlib import Path' not in original:
    raise SystemExit('ERRO: import Path não localizado em app.py. Nada foi alterado.')
if 'html = html[:start] + payload + html[start + size:]' not in original:
    raise SystemExit('ERRO: montagem de DATA do BI oficial não reconhecida. Nada foi alterado.')

# NÃO substitui nem muda a chamada atual components.html, inclusive height e scrolling.
pattern = r'^(?P<indent>[ \t]*)components\.html\(html,\s*height\s*=\s*\d+,\s*scrolling\s*=\s*True\)\s*$'
matches = list(re.finditer(pattern, original, flags=re.M))
if len(matches) != 1:
    raise SystemExit(f'ERRO: encontrada(s) {len(matches)} chamada(s) components.html. Nada foi alterado.')

new = original
if '"vl_nota_fiscal"' not in numeric.group(1) and "'vl_nota_fiscal'" not in numeric.group(1):
    new = new[:numeric.start(1)] + '"vl_nota_fiscal", ' + new[numeric.start(1):]

# Procura novamente após alterar numeric_cols (posição das linhas deslocada).
match = re.search(pattern, new, flags=re.M)
indent = match.group('indent')
insertion = (
    indent + '# Complemento aditivo: 4 indicadores, usando o HTML e filtros originais.\n'
    + indent + 'addon_js = (Path(__file__).parent / "indicadores_operacionais_infiniti.js").read_text(encoding="utf-8")\n'
    + indent + 'if "</body>" not in html:\n'
    + indent + '    raise ValueError("Fechamento </body> não encontrado no BI HTML oficial")\n'
    + indent + 'html_inicio, html_final = html.rsplit("</body>", 1)\n'
    + indent + 'html = html_inicio + "<script>\\n" + addon_js + "\\n</script>\\n</body>" + html_final\n'
)
new = new[:match.start()] + insertion + new[match.start():]
compile(new, str(app), 'exec')
if not backup.exists():
    shutil.copy2(app, backup)
app.write_text(new, encoding='utf-8')
print('OK: quatro indicadores adicionados ao app.py, preservando os demais recursos.')
print('Backup:', backup.name)
print('Chamada original do Streamlit mantida: ', match.group(0).strip())
print('SHA256 app.py original:', hashlib.sha256(original.encode()).hexdigest()[:16])
print('SHA256 app.py atualizado:', hashlib.sha256(new.encode()).hexdigest()[:16])
print('BI_Comercial_Infiniti.html e planilha NÃO alterados.')
