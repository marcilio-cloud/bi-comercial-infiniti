"""Infiniti Comercial | Homologação segura da leitura privada do Google Drive.

Antes de implantar: configurar autenticação OIDC no Streamlit Secrets.
"""
import io
import logging

import pandas as pd
import streamlit as st

st.set_page_config(page_title="Infiniti | Comercial - Homologação", layout="wide")

ADMINS = frozenset({
    "marcilio@infinititransportes.com.br",
    "joaopedro.miranda@infinititransportes.com.br",
})
VIEWERS = frozenset({
    "marcos@infinititransportes.com.br",
    "reginaldo@infinititransportes.com.br",
    "jonathas@infinititransportes.com.br",
    "priscila@infinititransportes.com.br",
    "financeiro@infinititransportes.com.br",
    "comercial@infinititransportes.com.br",
    "sanches@infinititransportes.com.br",
})
ALLOWED = ADMINS | VIEWERS

st.title("INFINITI TRANSPORTES | Comercial")
st.warning("HOMOLOGAÇÃO: diagnóstico da fonte. Ainda não é o BI comercial final.")

# Fail closed: não inicializar consultas nem exibir dados antes da autenticação.
try:
    authenticated = bool(st.user.is_logged_in)
except Exception:
    st.error("Autenticação Google ainda não configurada. Configure [auth] nos Secrets antes de publicar.")
    st.stop()

if not authenticated:
    st.info("Acesse com sua conta Google corporativa autorizada.")
    if st.button("Entrar com Google", type="primary"):
        st.login()
    st.stop()

email = str(st.user.get("email", "") or "").strip().lower()
email_verified = st.user.get("email_verified", False)
if email_verified is not True or email not in ALLOWED:
    st.error("Conta Google não autorizada. Entre com um dos e-mails corporativos habilitados.")
    if st.button("Sair"):
        st.logout()
    st.stop()

role = "Administrador / Suporte" if email in ADMINS else "Visualização"
st.caption(f"Acesso autorizado: {email} | Perfil: {role}")
if st.button("Sair da conta"):
    st.logout()

@st.cache_data(ttl=120, show_spinner=False)
def obter_base(file_id: str, credentials_json: str):
    import json
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload

    creds = json.loads(credentials_json)
    credentials = service_account.Credentials.from_service_account_info(
        creds, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    meta = service.files().get(
        fileId=file_id,
        fields="id,name,mimeType,modifiedTime,size",
        supportsAllDrives=True,
    ).execute()
    if meta.get("mimeType") != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        raise ValueError("A fonte configurada não é um arquivo Excel .xlsx.")
    stream = io.BytesIO()
    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    downloader = MediaIoBaseDownload(stream, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return stream.getvalue(), meta

config = st.secrets.get("drive", {})
file_id = config.get("file_id", "")
creds = st.secrets.get("gcp_service_account", {})
if not file_id or not creds:
    st.info("A conexão com o Google Drive ainda não está configurada nos Secrets.")
    st.stop()

if st.button("Verificar atualização agora"):
    obter_base.clear()

try:
    import json
    with st.spinner("Consultando arquivo no Google Drive..."):
        data, meta = obter_base(file_id, json.dumps(dict(creds), sort_keys=True))
        book = pd.ExcelFile(io.BytesIO(data), engine="openpyxl")
except Exception:
    logging.exception("Falha interna ao consultar o Drive")
    st.error("Não foi possível consultar a base. Solicite ao administrador que verifique os registros do aplicativo.")
    st.stop()

st.success("Arquivo acessado pelo Google Drive com credenciais de leitura.")
a, b, c = st.columns(3)
a.metric("Arquivo", meta.get("name", "—"))
b.metric("Última modificação no Drive", meta.get("modifiedTime", "—"))
c.metric("Abas encontradas", len(book.sheet_names))
st.caption("Cache de até 120 segundos. Confirme que o arquivo do Drive é a fonte oficial atualizada.")

aba = st.selectbox("Aba para conferência", book.sheet_names)
try:
    df = pd.read_excel(io.BytesIO(data), sheet_name=aba, header=None, engine="openpyxl")
    x, y = st.columns(2)
    x.metric("Linhas físicas lidas", len(df))
    y.metric("Colunas físicas lidas", len(df.columns))
    st.dataframe(df.head(25), hide_index=True, use_container_width=True)
    if aba == "Setembro":
        head = pd.read_excel(io.BytesIO(data), sheet_name=aba, nrows=21, header=None, engine="openpyxl")
        found = None
        for i, row in head.iterrows():
            if any(str(v).strip() == "nr_ctrc" for v in row.values):
                found = i
                break
        if found is None:
            st.error("Cabeçalho nr_ctrc não encontrado nas 21 primeiras linhas.")
        else:
            cols = [str(x).strip() for x in head.iloc[found].tolist()]
            required = ["nr_ctrc", "dt_emissao", "nm_agencia", "nm_pessoa_usuario", "nm_pessoa_pagador", "vl_peso", "vl_frete_empresa", "vl_frete_motorista", "Resultado", "Margem", "nm_corretor"]
            missing = [x for x in required if x not in cols]
            if missing:
                st.error("Campos ausentes: " + ", ".join(missing))
            else:
                st.success("Os 11 campos exigidos pelo gerador V9.10 foram encontrados.")
except Exception:
    logging.exception("Falha interna na leitura da planilha")
    st.error("Não foi possível analisar a aba selecionada.")

st.caption("Próxima fase: reproduzir cálculos e filtros e auditar contra o BI vigente.")
