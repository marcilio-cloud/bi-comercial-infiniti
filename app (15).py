"""Infiniti Comercial | Fase 2: homologação de leitura privada do Drive."""
import io
from datetime import datetime, timezone
import pandas as pd
import streamlit as st

st.set_page_config(page_title="Infiniti | Comercial - Homologação", layout="wide")
st.title("INFINITI TRANSPORTES | Comercial")
st.warning("HOMOLOGAÇÃO: diagnóstico da fonte, não é o BI comercial final. Não publicar sem controle de acesso.")

@st.cache_data(ttl=120, show_spinner=False)
def obter_base(file_id: str, creds: dict):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    credentials = service_account.Credentials.from_service_account_info(
        creds, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    meta = service.files().get(fileId=file_id, fields="id,name,mimeType,modifiedTime,size", supportsAllDrives=True).execute()
    if meta.get("mimeType") != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        raise ValueError("A fonte precisa ser um arquivo .xlsx. Conversão para Google Sheets requer outra implementação.")
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
    st.info("Conexão privada ainda não configurada. Adicione file_id e gcp_service_account nos secrets da hospedagem.")
    st.stop()

if st.button("Verificar atualização agora"):
    obter_base.clear()

try:
    with st.spinner("Consultando arquivo no Google Drive..."):
        data, meta = obter_base(file_id, dict(creds))
        book = pd.ExcelFile(io.BytesIO(data), engine="openpyxl")
except Exception as exc:
    st.error(f"Falha ao consultar a base privada: {type(exc).__name__}: {exc}")
    st.stop()

st.success("Arquivo acessado pelo Google Drive com credenciais de leitura.")
a, b, c = st.columns(3)
a.metric("Arquivo", meta.get("name", "—"))
b.metric("Última modificação no Drive", meta.get("modifiedTime", "—"))
c.metric("Abas encontradas", len(book.sheet_names))
st.caption("Leitura em cache por até 120 segundos; o botão acima força nova consulta. O Drive deve ser a fonte única oficial.")

aba = st.selectbox("Aba para conferência", book.sheet_names)
try:
    df = pd.read_excel(io.BytesIO(data), sheet_name=aba, header=None, engine="openpyxl")
    x, y = st.columns(2)
    x.metric("Linhas físicas lidas", len(df))
    y.metric("Colunas físicas lidas", len(df.columns))
    st.dataframe(df.head(25), hide_index=True, use_container_width=True)
    if aba == "Setembro":
        # Diagnóstico de campos; NÃO calcula KPIs financeiros nesta fase.
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
except Exception as exc:
    st.error(f"Erro de leitura: {exc}")
st.caption("Próxima fase: reproduzir cálculos e filtros, auditar contra o HTML vigente e implementar autenticação Google antes de publicar.")
