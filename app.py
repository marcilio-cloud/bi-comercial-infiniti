"""BI Comercial Infiniti: painel original com dados vivos do Google Sheets.
Publicação: substitua app.py no repositório bi-comercial-infiniti.
"""
import json
import re
from datetime import datetime
from pathlib import Path

import requests
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Infiniti Transportes | BI Comercial", layout="wide", initial_sidebar_state="collapsed")
ADMINS = {"marcilio@infinititransportes.com.br", "joapedro.miranda@infinititransportes.com.br"}
VIEWERS = {"marcos@infinititransportes.com.br", "reginaldo@infinititransportes.com.br", "jonathas@infinititransportes.com.br", "priscila@infinititransportes.com.br", "financeiro@infinititransportes.com.br", "comercial@infinititransportes.com.br", "sanches@infinititransportes.com.br"}
SHEET_ID = "1fsBrGHHZO-_5TPOy1us3QLGcLAsJU-00Cbn45hJQakY"

try:
    logged_in = st.user.is_logged_in
except Exception:
    st.error("Configure a seção [auth] nos Secrets do Streamlit.")
    st.stop()
if not logged_in:
    st.title("BI Comercial Infiniti")
    if st.button("Entrar com Google", type="primary"):
        st.login()
    st.stop()
email = str(st.user.get("email", "")).lower().strip()
if st.user.get("email_verified") is not True or email not in ADMINS | VIEWERS:
    st.error("Conta não autorizada.")
    if st.button("Sair"):
        st.logout()
    st.stop()

# OAuth de leitura independente do login OIDC, igual à arquitetura do BI Frota.
def oauth_config():
    try:
        return st.secrets["google_sheets"]["oauth"]
    except (KeyError, FileNotFoundError):
        st.error("Falta [google_sheets.oauth] nos Secrets (client_id, client_secret, refresh_token).")
        st.stop()

@st.cache_data(ttl=300, show_spinner=False)
def carregar_planilha(client_id, client_secret, refresh_token, spreadsheet_id):
    token_response = requests.post("https://oauth2.googleapis.com/token", data={
        "client_id": client_id, "client_secret": client_secret,
        "refresh_token": refresh_token, "grant_type": "refresh_token",
    }, timeout=35)
    token_response.raise_for_status()
    token = token_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    base = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
    meta = requests.get(base, params={"fields": "sheets(properties(title,gridProperties))"}, headers=headers, timeout=35)
    meta.raise_for_status()
    sheets = meta.json()["sheets"]
    values = None
    selected_name = None
    for item in sheets:
        title = item["properties"]["title"]
        # Ler cada aba até identificar os cabeçalhos da base comercial.
        if values is not None:
            break
        head = requests.get(base + "/values/" + requests.utils.quote(f"'{title}'!A1:AZ3", safe=""), headers=headers, timeout=35)
        head.raise_for_status()
        preview = head.json().get("values", [])
        if not any("nr_ctrc" in row and "dt_emissao" in row for row in preview):
            continue
        full = requests.get(base + "/values/" + requests.utils.quote(f"'{title}'", safe=""),
                            params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "FORMATTED_STRING"},
                            headers=headers, timeout=120)
        full.raise_for_status()
        values = full.json().get("values", [])
        selected_name = title
    if not values:
        raise ValueError("Nenhuma aba com cabeçalhos nr_ctrc e dt_emissao foi encontrada.")
    header_index = next(i for i, row in enumerate(values[:3]) if "nr_ctrc" in row and "dt_emissao" in row)
    headers_row = [str(x).strip() for x in values[header_index]]
    records = []
    numeric_cols = {"vl_peso", "vl_frete_empresa", "vl_frete_motorista", "Resultado", "Margem"}
    for row in values[header_index + 1:]:
        if not any(str(v).strip() for v in row):
            continue
        item = {k: (row[i] if i < len(row) else "") for i, k in enumerate(headers_row) if k}
        for key in numeric_cols:
            if key in item:
                v = item[key]
                if isinstance(v, str):
                    v = v.strip().replace("R$", "").replace("%", "").replace(" ", "")
                    if "," in v:
                        v = v.replace(".", "").replace(",", ".")
                    try:
                        v = float(v)
                        if key == "Margem" and "%" in str(item[key]):
                            v /= 100
                    except ValueError:
                        v = 0
                item[key] = v if isinstance(v, (int, float)) else 0
        if "dt_emissao" in item:
            raw = str(item["dt_emissao"])
            for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%y %H:%M", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%Y-%m-%d"):
                try:
                    item["dt_emissao"] = datetime.strptime(raw, fmt).strftime("%Y-%m-%d %H:%M:%S")
                    break
                except ValueError:
                    pass
        records.append(item)
    def ler_aba(nome):
        url = base + "/values/" + requests.utils.quote(f"'{nome}'!A1:P50", safe="")
        response = requests.get(url, params={"valueRenderOption": "UNFORMATTED_VALUE"}, headers=headers, timeout=35)
        response.raise_for_status()
        return response.json().get("values", [])

    def numero(v):
        if isinstance(v, (int, float)):
            return float(v)
        v = str(v or "").replace("R$", "").replace("%", "").strip()
        if "," in v:
            v = v.replace(".", "").replace(",", ".")
        try:
            return float(v)
        except ValueError:
            return 0.0

    def tabela_metas(rows, inicio, fim):
        saida = {}
        for row in rows[inicio - 1:fim]:
            nome = str(row[1] if len(row) > 1 else "").strip()
            if not nome or nome.casefold() in ("total", "unidade"):
                continue
            saida[nome] = {str(m): numero(row[m + 1] if len(row) > m + 1 else 0) for m in range(1, 13)}
        return saida

    abas = {item["properties"]["title"].strip().casefold(): item["properties"]["title"] for item in sheets}
    for obrigatoria in ("dados meta", "dados meta filiais"):
        if obrigatoria not in abas:
            raise ValueError(f"A aba obrigatória '{obrigatoria}' não foi encontrada. Metas não foram atualizadas.")
    metas = ler_aba(abas["dados meta"])
    filiais = ler_aba(abas["dados meta filiais"])
    return records, selected_name, {
        "corretores": tabela_metas(metas, 4, 10),
        "margens_corretores": tabela_metas(metas, 16, 22),
        "filiais": tabela_metas(filiais, 4, 9),
        "volumes_filiais": tabela_metas(filiais, 14, 19),
        "tickets_filiais": tabela_metas(filiais, 24, 29),
        "margens_filiais": tabela_metas(filiais, 35, 40),
    }

st.markdown("<style>header[data-testid='stHeader']{background:#0c1520} .block-container{padding:0!important;max-width:100%!important} div[data-testid='stToolbar']{display:none}</style>", unsafe_allow_html=True)
config = oauth_config()
try:
    with st.spinner("Carregando CT-es da base oficial..."):
        data, sheet_name, metas = carregar_planilha(str(config["client_id"]), str(config["client_secret"]), str(config["refresh_token"]), SHEET_ID)
except Exception as exc:
    st.error(f"Não foi possível ler a base do Google Sheets: {exc}")
    st.stop()

# HTML original intacto: substituir somente o array DATA embutido.
html = (Path(__file__).parent / "BI_Comercial_Infiniti.html").read_text(encoding="utf-8")
start = html.index("const DATA=") + len("const DATA=")
_, size = json.JSONDecoder().raw_decode(html[start:])
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html = html[:start] + payload + html[start + size:]

# Atualiza os alvos dentro de EXTRA, mantendo os demais campos do dashboard.
extra_start = html.index("EXTRA=") + len("EXTRA=")
extra, extra_len = json.JSONDecoder().raw_decode(html[extra_start:])

def normalizar(nome):
    import unicodedata
    return " ".join("".join(c for c in unicodedata.normalize("NFKD", str(nome)) if not unicodedata.combining(c)).upper().split())

def atualizar(lista, valores, campo="metasMensais", chave="nome"):
    mapa = {normalizar(k): v for k, v in valores.items()}
    for alvo in lista:
        nome = normalizar(alvo.get(chave, ""))
        # A planilha contém CATUABA para MARCOS; correspondência conhecida do relatório.
        if nome == "MARCOS" and nome not in mapa:
            nome = "CATUABA"
        if nome in mapa:
            alvo[campo] = mapa[nome]

atualizar(extra.get("metasCorretores", []), metas["corretores"])
atualizar(extra.get("metasFiliais", []), metas["filiais"], chave="unidade")
# Margens e volumes são mantidos em campos separados para não sobrescrever metas de faturamento.
for key, fonte in (("margensCorretores", "margens_corretores"),
                   ("volumesFiliais", "volumes_filiais"),
                   ("ticketsFiliais", "tickets_filiais"),
                   ("margensFiliais", "margens_filiais")):
    extra[key] = metas[fonte]

# Validar correspondência antes de exibir o painel; não publicar silenciosamente metas antigas.
if not any(t.get("metasMensais", {}).get("10", 0) for t in extra.get("metasCorretores", [])):
    st.error("Não foi possível conciliar as metas comerciais de outubro com a planilha.")
    st.stop()
extra_json = json.dumps(extra, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html = html[:extra_start] + extra_json + html[extra_start + extra_len:]
# O HTML roda no iframe, com as mesmas regras e exportação do painel validado.
components.html(html, height=2700, scrolling=True)
