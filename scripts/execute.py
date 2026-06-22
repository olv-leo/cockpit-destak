#!/usr/bin/env python3
"""
Destak Data Processing Script
Valida planilhas de manejo do rebanho e atualiza banco de dados e Google Sheets.
Porta do notebook Colab para execução via GitHub Actions.
"""

import re
import json
import os
import sys
import logging
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from unidecode import unidecode
from sqlalchemy import create_engine
from psycopg2.extras import DictCursor
import psycopg2
from gspread_dataframe import set_with_dataframe
import gspread

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger(__name__)


# ─── Credenciais ───────────────────────────────────────────────────────────────

SERVICE_ACCOUNT_JSON = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
client = gspread.service_account_from_dict(SERVICE_ACCOUNT_JSON)

POSTGRES_HOST     = os.environ['POSTGRES_HOST']
POSTGRES_DB       = os.environ['POSTGRES_DB']
POSTGRES_USER     = os.environ['POSTGRES_USER']
POSTGRES_PASSWORD = os.environ['POSTGRES_PASSWORD']
POSTGRES_URL      = (
    f'postgresql+psycopg2://{POSTGRES_USER}:{POSTGRES_PASSWORD}'
    f'@{POSTGRES_HOST}:5432/{POSTGRES_DB}?sslmode=require'
)


# ─── Constantes ────────────────────────────────────────────────────────────────

ID_PLANILHA_MANEJOS_ORIGINAL = os.environ['SHEETS_ID_ORIGINAL']
ID_PLANILHA_MANEJOS_TRATADA  = os.environ['SHEETS_ID_TRATADA']
PLANILHAS_MANEJO = ['pesagens', 'desmamas', 'iatfs', 'vendas', 'mortes', 'compras',
                    'transferencias', 'nascimentos', 'estoque']
COLUNAS_ERROS   = ['data', 'cod_animal', 'cod_animal_original', 'base_erro', 'motivo_erro']
FAZENDAS        = ['AURORA', 'DESTAK', 'MORADA NOVA', 'PARAISO', 'PONTE NOVA', 'SANTA BARBARA']
COLUNAS_ENTRADAS = ['data', 'cod_animal', 'planilha']
PLANILHAS_ENTRADAS = ['compras', 'nascimentos']
PLANILHAS_SAIDAS   = ['mortes', 'vendas']

pd.options.mode.chained_assignment = None


# ─── Ajustes de planilha ───────────────────────────────────────────────────────

def remove_leading_zeros(cod: str) -> str:
    cod = re.sub(r'[/-]', '', cod)
    cod = re.sub(r'(?<!\d)0+(?=\d)', '', cod)
    return cod


def ajustar_cod_animal(planilha: pd.DataFrame) -> pd.DataFrame:
    planilha = planilha.fillna('')
    planilha = planilha[planilha['cod_animal'] != '']
    planilha['cod_animal'] = planilha['cod_animal_original'] = planilha['cod_animal'].astype(str)
    planilha['cod_animal'] = planilha['cod_animal'].str.upper().apply(remove_leading_zeros)
    planilha = planilha[planilha['cod_animal'] != 'SN']
    return planilha


def ajustar_df(df: pd.DataFrame) -> pd.DataFrame:
    for col in ['dg_checagem', 'dg_inicial']:
        df[col] = df[col].str.replace(r'.*PRENHA.*', 'PRENHA', regex=True)
        df[col] = df[col].str.replace(r'.*VAZIA.*', 'VAZIA', regex=True)
    return df


# ─── Checks ────────────────────────────────────────────────────────────────────

def check_fazenda_preenchida(nome_planilha: str, df_dados: pd.DataFrame) -> pd.DataFrame:
    if nome_planilha in ('desmamas', 'transferencias'):
        df2 = df_dados.copy()
        df_dados['fazenda'] = df_dados['fazenda_origem']
        df2['fazenda'] = df_dados['fazenda_destino']
        df_dados = pd.concat([df_dados, df2])

    df_dados['fazenda_ajustada'] = (
        df_dados['fazenda'].str.upper().apply(unidecode).str.strip()
        .str.replace(r'\s+', ' ', regex=True)
    )
    df_dados['fazenda'] = df_dados['fazenda_ajustada']
    df_inv = df_dados[~df_dados['fazenda_ajustada'].isin(FAZENDAS)].copy()
    df_inv['base_erro'] = nome_planilha
    df_inv['motivo_erro'] = df_inv.apply(
        lambda r: f"Erro no lançamento da fazenda. Valor preenchido: {r['fazenda']}" if r['fazenda'] != ''
                  else "Erro no lançamento da fazenda. Valor preenchido: (Em branco)", axis=1)
    if nome_planilha in ('desmamas', 'transferencias'):
        df_dados.drop(columns=['fazenda'], errors='ignore', inplace=True)
    return df_inv[COLUNAS_ERROS]


def check_cod_animal_duplicados(nome_planilha: str, df_dados: pd.DataFrame) -> pd.DataFrame:
    df_dup = df_dados[df_dados.duplicated(subset=['cod_animal'], keep=False)].copy()
    df_dup['base_erro'] = nome_planilha
    df_dup['motivo_erro'] = f"Código do animal duplicado na base {nome_planilha}"
    return df_dup[COLUNAS_ERROS]


def check_cod_data_duplicados(nome_planilha: str, df_dados: pd.DataFrame) -> pd.DataFrame:
    df_dup = df_dados[df_dados.duplicated(subset=['cod_animal', 'data'], keep=False)].copy()
    df_dup['base_erro'] = nome_planilha
    df_dup['motivo_erro'] = f"Código do animal duplicado na mesma data na base {nome_planilha}"
    return df_dup[COLUNAS_ERROS]


def check_data_preenchida(nome_planilha: str, df_dados: pd.DataFrame, col_data='data') -> pd.DataFrame:
    df_sem = df_dados[df_dados[col_data] == ''].copy()
    df_sem['base_erro'] = nome_planilha
    df_sem['motivo_erro'] = "Registro sem data."
    return df_sem[COLUNAS_ERROS]


def check_formato_data(nome_planilha, df_dados, col_data='data', col_cod='cod_animal', retornar_df_filtrado=False):
    df = df_dados.copy()
    if col_data not in df.columns:
        df[col_data] = ''
    df['data'] = df[col_data]

    s = df[col_data].astype(str).str.strip()
    mask_prech = (s != '') & (df[col_data].notna())
    dt = pd.to_datetime(df.loc[mask_prech, col_data], format='%d/%m/%Y', errors='coerce')
    idx_inv = dt[dt.isna()].index

    df_err = df.loc[idx_inv].copy()
    df_err['base_erro'] = nome_planilha
    if col_cod == 'cod_animal':
        df_err['motivo_erro'] = df_err.apply(
            lambda r: f"Data com formato incorreto. Valor preenchido: {r.get(col_data, '')}. Ajustar para 'DD/MM/AAAA'", axis=1)
    else:
        df_err['cod_animal'] = 'NA'
        df_err['motivo_erro'] = df_err.apply(
            lambda r: f"Data com formato incorreto. Valor preenchido: {r.get(col_data, '')}. Registro: {r.get(col_cod, '')}", axis=1)

    for col in COLUNAS_ERROS:
        if col not in df_err.columns:
            df_err[col] = ''

    df_erros = df_err.reindex(columns=COLUNAS_ERROS)
    if retornar_df_filtrado:
        return df_erros, df.drop(index=idx_inv).copy()
    return df_erros


def check_datas_fora_intervalo(nome_planilha: str, df_dados: pd.DataFrame) -> pd.DataFrame:
    df = df_dados[df_dados['data'] != ''].copy()
    df['data_conv'] = pd.to_datetime(df['data'], format='%d/%m/%Y', errors='coerce')
    df = df[~df['data_conv'].isna()]

    minima = datetime(2023, 1, 1)
    atual  = datetime.now()

    df_ant = df[df['data_conv'] < minima].copy()
    df_ant['base_erro']   = nome_planilha
    df_ant['motivo_erro'] = df_ant.apply(lambda r: f"Data anterior a 2023. Valor: {r['data']}.", axis=1)

    df_fut = df[df['data_conv'] > atual].copy()
    df_fut['base_erro']   = nome_planilha
    df_fut['motivo_erro'] = df_fut.apply(
        lambda r: f"Data maior que hoje ({atual.strftime('%d/%m/%Y')}). Valor: {r['data']}.", axis=1)

    return pd.concat([df_ant[COLUNAS_ERROS], df_fut[COLUNAS_ERROS]], ignore_index=True)


def check_peso_inteiro(nome_planilha: str, df_dados: pd.DataFrame) -> pd.DataFrame:
    df = df_dados[df_dados['peso'] != ''].copy()
    def is_int(s):
        try: int(s); return True
        except ValueError: return False
    df_err = df[~df['peso'].apply(is_int)].copy()
    df_err['base_erro']   = nome_planilha
    df_err['motivo_erro'] = df_err.apply(lambda r: f"Valor não inteiro em 'peso'. Valor: {r['peso']}.", axis=1)
    return df_err[COLUNAS_ERROS]


def check_ecc_float(nome_planilha: str, df_dados: pd.DataFrame) -> pd.DataFrame:
    df = df_dados[df_dados['ecc'] != ''].copy()
    def is_float(x):
        try: float(str(x).replace(',', '.')); return True
        except ValueError: return False
    df_err = df[~df['ecc'].apply(is_float)].copy()
    df_err['base_erro']   = nome_planilha
    df_err['motivo_erro'] = df_err.apply(lambda r: f"Valor não numérico em 'ecc'. Valor: {r['ecc']}.", axis=1)
    return df_err[COLUNAS_ERROS]


def check_sexo_values(nome_planilha: str, df_dados: pd.DataFrame) -> pd.DataFrame:
    df = df_dados[df_dados['sexo'].notna() & (df_dados['sexo'] != '')].copy()
    df_err = df[~df['sexo'].apply(lambda x: x.startswith('M') or x.startswith('F'))].copy()
    df_err['base_erro']   = nome_planilha
    df_err['motivo_erro'] = df_err.apply(lambda r: f"Valor inválido em 'sexo'. Valor: {r['sexo']}.", axis=1)
    return df_err[COLUNAS_ERROS]


def filtra_prenhez_iatf_duplicada(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    chec = out['dg_checagem'].astype('string').str.strip()
    ini  = out['dg_inicial'].astype('string').str.strip()
    chec_valido = chec.notna() & (chec != '') & (chec.str.len() >= 4)
    out['_dg'] = chec.where(chec_valido, ini).str.upper()
    out['data'] = pd.to_datetime(out['data'], errors='coerce')

    prenha = out[(out['_dg'] == 'PRENHA') & out['data'].notna()].sort_values(['cod_animal', 'data'])
    mask = pd.Series(False, index=out.index)
    janela = np.timedelta64(45, 'D')

    for _, g in prenha.groupby('cod_animal', sort=False):
        dates = g['data'].to_numpy(dtype='datetime64[ns]')
        idx   = g.index.to_numpy()
        if len(dates) < 2:
            continue
        ok = (dates[1:] - dates[:-1]) <= janela
        for i in np.where(ok)[0]:
            mask.loc[idx[i]] = True
            mask.loc[idx[i + 1]] = True

    res = out[mask].copy()
    res.drop(columns=['_dg'], inplace=True, errors='ignore')
    res['base_erro']   = 'iatfs'
    res['motivo_erro'] = res.apply(
        lambda r: f"Prenhez IATF duplicada. Animal {r['cod_animal']} apareceu como Prenha 2x em < 45d.", axis=1)
    return res[COLUNAS_ERROS]


# ─── Entradas / Saídas ─────────────────────────────────────────────────────────

def get_entradas_validas(planilhas_originais, df_erros):
    result = pd.DataFrame()
    for nome, df in planilhas_originais.items():
        if nome not in PLANILHAS_ENTRADAS:
            continue
        df2 = df.copy()
        df2['planilha'] = nome
        df2['chave'] = df2['data'].fillna('(Em branco)').astype(str) + df2['cod_animal'].astype(str)
        erros_nome = df_erros[df_erros['base_erro'] == nome].copy()
        erros_nome['chave'] = erros_nome['data'].fillna('(Em branco)').astype(str) + erros_nome['cod_animal'].astype(str)
        validas = df2[~df2['chave'].isin(erros_nome['chave'])][COLUNAS_ENTRADAS]
        result = pd.concat([result, validas])
    return result


def get_saidas_validas(planilhas_originais, df_erros):
    result = pd.DataFrame()
    for nome, df in planilhas_originais.items():
        if nome not in PLANILHAS_SAIDAS:
            continue
        df2 = df.copy()
        df2['planilha'] = nome
        df2['chave'] = df2['data'].fillna('(Em branco)').astype(str) + df2['cod_animal'].astype(str)
        erros_nome = df_erros[df_erros['base_erro'] == nome].copy()
        erros_nome['chave'] = erros_nome['data'].fillna('(Em branco)').astype(str) + erros_nome['cod_animal'].astype(str)
        validas = df2[~df2['chave'].isin(erros_nome['chave'])][COLUNAS_ENTRADAS]
        result = pd.concat([result, validas])
    return result


# ─── Processamento para salvar ─────────────────────────────────────────────────

def process_compras(df):
    df = df[['data','cod_animal','peso','categoria','fazenda','lote','obs','cod_animal_original']].assign(
        status='ATIVO', fonte='COMPRAS', nome_planilha='compras')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_nascimentos(df):
    df = df[['data','cod_animal','peso','fazenda','obs','cod_animal_original']].assign(
        status='ATIVO', categoria='BEZERRO', fonte='NASCIMENTOS', lote=None, nome_planilha='nascimentos')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_pesagens(df):
    df = df[['data','cod_animal','peso','categoria','fazenda','lote','obs','cod_animal_original']].assign(
        status='ATIVO', fonte='PESAGENS', nome_planilha='pesagens')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_mortes(df):
    df = df[['data','cod_animal','categoria','fazenda','obs','cod_animal_original']].assign(
        peso=None, status='MORTO', fonte='MORTES', lote=None, nome_planilha='mortes')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_desmamas(df):
    df = df[['data','cod_animal','peso','categoria','fazenda_origem','lote','obs','cod_animal_original']]\
        .rename(columns={'fazenda_origem':'fazenda'})\
        .assign(status='ATIVO', fonte='DESMAMAS', nome_planilha='desmamas')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_desmamas_transferencias(df):
    df = df[['data','cod_animal','peso','categoria','fazenda_destino','lote','obs','cod_animal_original']]\
        .rename(columns={'fazenda_destino':'fazenda'})\
        .assign(status='ATIVO', fonte='TRANSFERENCIAS', nome_planilha='desmamas')
    df['data'] = df['data'] + timedelta(days=1)
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_vendas(df):
    df = df[['data','cod_animal','peso','categoria','fazenda','obs','cod_animal_original']].assign(
        status='VENDIDO', fonte='VENDAS', lote=None, nome_planilha='vendas')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_iatfs(df):
    df = df[['data','cod_animal','peso','categoria','fazenda','lote','obs','cod_animal_original']].assign(
        status='ATIVO', fonte='IATFS', nome_planilha='iatfs')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def process_transferencias(df):
    df = df[['data','cod_animal','peso','categoria','fazenda_destino','obs']]\
        .rename(columns={'fazenda_destino':'fazenda'})\
        .assign(status='ATIVO', fonte='TRANSFERENCIAS', lote=None, nome_planilha='transferencias')
    df['fazenda'] = df['fazenda'].str.strip().str.replace(r'\s+', ' ', regex=True)
    return df

def unir_dataframes(dfs):
    return pd.concat([
        process_compras(dfs['compras']),
        process_nascimentos(dfs['nascimentos']),
        process_pesagens(dfs['pesagens']),
        process_mortes(dfs['mortes']),
        process_desmamas(dfs['desmamas']),
        process_transferencias(dfs['transferencias']),
        process_desmamas_transferencias(dfs['desmamas']),
        process_vendas(dfs['vendas']),
        process_iatfs(dfs['iatfs']),
    ], ignore_index=True)


# ─── Salvar ────────────────────────────────────────────────────────────────────

def salvar_sheets(spreadsheet_tratada, nome: str, dados: pd.DataFrame):
    sheet = spreadsheet_tratada.worksheet(nome)
    sheet.clear()
    set_with_dataframe(sheet, dados)
    log.info(f"✅ Sheets → {nome} ({len(dados)} linhas)")

def salvar_bd(nome: str, dados: pd.DataFrame):
    engine = create_engine(POSTGRES_URL)
    dados.to_sql(nome, engine, if_exists='replace', index=True, index_label=dados.index.name)
    engine.dispose()
    log.info(f"✅ PostgreSQL → {nome} ({len(dados)} linhas)")


# ─── Custos estoque (FIFO) ─────────────────────────────────────────────────────

def get_allocations_and_entries_df():
    conn = psycopg2.connect(
        host=POSTGRES_HOST, database=POSTGRES_DB, user=POSTGRES_USER, password=POSTGRES_PASSWORD)
    cursor = conn.cursor(cursor_factory=DictCursor)

    cursor.execute("""
        SELECT cod_produto, data_lancamento, qtde_unit, valor_unitario
        FROM estoque WHERE fazenda = 'ESTOQUE' AND classif_mov = 'ENTRADA'
        ORDER BY cod_produto, data_lancamento;
    """)
    entradas_rows = cursor.fetchall()

    cursor.execute("""
        SELECT cod_produto, data_lancamento, fazenda, qtde_unit
        FROM estoque WHERE fazenda <> 'ESTOQUE' AND classif_mov = 'SAÍDA'
        ORDER BY cod_produto, data_lancamento;
    """)
    saidas_rows = cursor.fetchall()

    for r in entradas_rows:
        r['data_lancamento'] = pd.to_datetime(r['data_lancamento'], dayfirst=True, errors='coerce')
    for r in saidas_rows:
        r['data_lancamento'] = pd.to_datetime(r['data_lancamento'], dayfirst=True, errors='coerce')

    entradas_by_prod = {}
    for r in entradas_rows:
        entradas_by_prod.setdefault(r['cod_produto'], []).append({
            'data_lancamento': r['data_lancamento'],
            'qtde_unit': r['qtde_unit'],
            'valor_unitario': r['valor_unitario'],
            'remaining': r['qtde_unit'],
        })

    saidas_by_prod = {}
    for r in saidas_rows:
        saidas_by_prod.setdefault(r['cod_produto'], []).append({
            'data_lancamento': r['data_lancamento'],
            'fazenda': r['fazenda'],
            'qtde_unit': r['qtde_unit'],
        })

    allocations = []
    for cod_prod, saidas in saidas_by_prod.items():
        saidas.sort(key=lambda x: x['data_lancamento'])
        entradas = sorted(entradas_by_prod.get(cod_prod, []), key=lambda x: x['data_lancamento'])
        for saida in saidas:
            rem = saida['qtde_unit']
            details = []
            for e in entradas:
                if e['data_lancamento'] <= saida['data_lancamento'] and e['remaining'] > 0:
                    qty = min(e['remaining'], rem)
                    if qty > 0:
                        details.append({
                            'cod_produto': cod_prod,
                            'fazenda': saida['fazenda'],
                            'saida_data': saida['data_lancamento'],
                            'entrada_data': e['data_lancamento'],
                            'qtde_alocada': qty,
                            'custo_parcial': qty * e['valor_unitario'],
                        })
                        e['remaining'] -= qty
                        rem -= qty
                    if rem <= 0:
                        break
            if rem > 0:
                details.append({
                    'cod_produto': cod_prod, 'fazenda': saida['fazenda'],
                    'saida_data': saida['data_lancamento'], 'entrada_data': None,
                    'qtde_alocada': rem, 'custo_parcial': 0,
                })
            allocations.extend(details)

    allocations.sort(key=lambda x: (x['cod_produto'], x['saida_data']))

    entradas_summary = []
    for cod_prod, entradas in entradas_by_prod.items():
        for e in entradas:
            qtde_total = e['qtde_unit']
            qtde_final = e['remaining']
            entradas_summary.append({
                'cod_produto': cod_prod,
                'entrada_data': e['data_lancamento'],
                'qtde_unit': qtde_total,
                'valor_unitario': e['valor_unitario'],
                'qtde_consumida': qtde_total - qtde_final,
                'qtde_final': qtde_final,
            })
    entradas_summary.sort(key=lambda x: (x['cod_produto'], x['entrada_data']))

    cursor.close()
    conn.close()
    return pd.DataFrame(allocations), pd.DataFrame(entradas_summary)


# ─── Pipeline principal ────────────────────────────────────────────────────────

def main():
    log.info("🚀 Iniciando pipeline Destak...")

    # 1. Leitura das planilhas originais
    log.info("📥 Lendo planilhas originais do Google Sheets...")
    spreadsheet_original = client.open_by_key(ID_PLANILHA_MANEJOS_ORIGINAL)
    planilhas_originais = {
        nome: spreadsheet_original.worksheet(nome).get_all_records(numericise_ignore=['all'])
        for nome in PLANILHAS_MANEJO
    }
    for nome in PLANILHAS_MANEJO:
        if nome == 'estoque':
            continue
        planilhas_originais[nome] = ajustar_cod_animal(pd.DataFrame(planilhas_originais[nome]))
    planilhas_originais['iatfs'] = ajustar_df(planilhas_originais['iatfs'])
    log.info("✅ Planilhas carregadas")

    # 2. Validações
    log.info("🔍 Executando validações...")
    df_erros = pd.DataFrame()
    planilhas_check_cod_dup = ('desmamas', 'vendas', 'mortes', 'compras', 'nascimentos')

    for nome, df in planilhas_originais.items():
        if nome == 'estoque':
            continue
        log.info(f"  Validando {nome}...")
        for fn in [
            lambda n, d: check_fazenda_preenchida(n, d),
            lambda n, d: check_data_preenchida(n, d),
            lambda n, d: check_formato_data(n, d),
            lambda n, d: check_datas_fora_intervalo(n, d),
            lambda n, d: check_cod_data_duplicados(n, d),
        ]:
            df_erros = pd.concat([df_erros, fn(nome, df)], ignore_index=True)

        if nome != 'mortes':
            df_erros = pd.concat([df_erros, check_peso_inteiro(nome, df)], ignore_index=True)
        if nome == 'iatfs':
            df_erros = pd.concat([df_erros, check_ecc_float(nome, df)], ignore_index=True)
        if nome in planilhas_check_cod_dup:
            df_erros = pd.concat([df_erros, check_cod_animal_duplicados(nome, df)], ignore_index=True)
        if 'sexo' in df.columns:
            df_erros = pd.concat([df_erros, check_sexo_values(nome, df)], ignore_index=True)

    # Check IATF estação
    df_iatfs = planilhas_originais['iatfs']
    df_err_estacao = df_iatfs[~df_iatfs['estacao'].isin(FAZENDAS)].copy()
    df_err_estacao['base_erro'] = 'iatfs'
    df_err_estacao['motivo_erro'] = df_err_estacao.apply(
        lambda r: f"Erro na estação. Valor: {r['estacao']}" if r['estacao'] != ''
                  else "Estação em branco", axis=1)
    df_erros = pd.concat([df_erros, df_err_estacao[COLUNAS_ERROS]], ignore_index=True)

    df_prenhes = filtra_prenhez_iatf_duplicada(df_iatfs)
    df_erros = pd.concat([df_erros, df_prenhes], ignore_index=True)

    # Check entradas / saídas
    entradas = get_entradas_validas(planilhas_originais, df_erros)
    saidas   = get_saidas_validas(planilhas_originais, df_erros)

    entradas['data'] = pd.to_datetime(entradas['data'], format='%d/%m/%Y')
    saidas['data']   = pd.to_datetime(saidas['data'], format='%d/%m/%Y')

    consolid = pd.merge(entradas, saidas, on='cod_animal', suffixes=('_entrada', '_saida'))

    cod_nascidos = entradas[entradas['planilha'] == 'nascimentos']['cod_animal']
    df_desmamas  = planilhas_originais['desmamas']
    desmamas_inv = df_desmamas[~df_desmamas['cod_animal'].isin(cod_nascidos)].copy()
    if len(desmamas_inv) > 0:
        desmamas_inv['base_erro']          = 'desmamas'
        desmamas_inv['motivo_erro']        = 'Animal desmamado sem registro de nascimento.'
        desmamas_inv['cod_animal_original'] = desmamas_inv['cod_animal_original']
        df_erros = pd.concat([df_erros, desmamas_inv[COLUNAS_ERROS]], ignore_index=True)

    reg_inv = consolid[consolid['data_entrada'] >= consolid['data_saida']].copy()
    if len(reg_inv) > 0:
        reg_inv['base_erro']          = reg_inv['planilha_entrada']
        reg_inv['data']               = reg_inv['data_entrada']
        reg_inv['cod_animal_original'] = reg_inv['cod_animal']
        reg_inv['motivo_erro']        = reg_inv.apply(
            lambda r: f"Inconsistência nas datas. Entrada ({r['planilha_entrada']}):{r['data_entrada'].strftime('%d/%m/%Y')} "
                      f"Saída ({r['planilha_saida']}):{r['data_saida'].strftime('%d/%m/%Y')}", axis=1)
        df_erros = pd.concat([df_erros, reg_inv[COLUNAS_ERROS]], ignore_index=True)

    log.info(f"✅ Validações concluídas. Erros encontrados: {len(df_erros)}")

    # 3. Tratar dados para salvar
    log.info("⚙️ Processando dados para salvar...")
    spreadsheet_tratada  = client.open_by_key(ID_PLANILHA_MANEJOS_TRATADA)
    df_erros.sort_values(['base_erro', 'motivo_erro', 'cod_animal'], inplace=True)

    planilhas_validadas = {}
    planilhas_inserir   = planilhas_originais
    cod_possivel_importacao = []

    for nome, df in planilhas_inserir.items():
        if nome == 'estoque':
            continue

        df['data'] = pd.to_datetime(df['data'], format='%d/%m/%Y', errors='coerce')
        df['data'] = df['data'].dt.strftime('%d/%m/%Y').fillna(df['data'])

        erros_nome = df_erros[df_erros['base_erro'] == nome].copy()
        erros_nome['chave'] = erros_nome['data'].fillna('(Em branco)').astype(str) + erros_nome['cod_animal'].astype(str)
        df['chave'] = df['data'].fillna('(Em branco)').astype(str) + df['cod_animal'].astype(str)
        validos = df[~df['chave'].isin(erros_nome['chave'])].drop(columns=['chave'])
        validos = validos[~validos['data'].isna()]

        if nome == 'iatfs':
            validos['custo_iatf'] = validos['custo_iatf'].replace('', np.nan)
            validos['custo_iatf'] = validos['custo_iatf'].str.replace(',', '.', regex=False).astype(float)

        if nome in ('compras', 'nascimentos', 'vendas', 'mortes'):
            validos['data'] = pd.to_datetime(validos['data'], format='%d/%m/%Y')
            validos = validos[~validos['cod_animal'].isin(erros_nome['cod_animal'].tolist())]

        if nome == 'iatfs':
            validos['ecc'] = validos['ecc'].replace('', np.nan).astype(str).str.replace(',', '.').astype(float)

        if nome in ('nascimentos', 'pesagens', 'compras'):
            validos['sexo'] = validos['sexo'].apply(
                lambda x: 'MACHO' if str(x).startswith('M') else 'FÊMEA' if str(x).startswith('F') else x)

        for col_drop in ['planilha', 'fazenda_ajustada']:
            if col_drop in validos.columns:
                validos.drop(columns=[col_drop], inplace=True)

        if 'peso' in validos.columns:
            validos['peso'] = validos['peso'].replace('', np.nan).astype(str).str.replace(',', '.').astype(float)

        if 'fazenda' in validos.columns:
            validos = validos[validos['fazenda'].isin(FAZENDAS)]

        if 'estacao' in validos.columns:
            validos = validos[validos['estacao'].isin(FAZENDAS)]

        validos['data'] = pd.to_datetime(validos['data'], format='%d/%m/%Y')
        planilhas_validadas[nome] = validos

    # Criar df final unificado para check de fazenda
    dataframes = {k: planilhas_validadas[k] for k in [
        'pesagens','desmamas','iatfs','vendas','mortes','compras','transferencias','nascimentos']}
    df_final = unir_dataframes(dataframes)

    df_final['data'] = pd.to_datetime(df_final['data'], format='%d/%m/%Y')
    df_final = df_final.sort_values(['cod_animal', 'data']).reset_index(drop=True)
    df_final['fazenda_check'] = df_final.groupby('cod_animal')['fazenda'].shift(1).fillna(df_final['fazenda'])
    df_final['check'] = (df_final['fazenda'] == df_final['fazenda_check'])

    def update_check(group):
        group = group.sort_values('data')
        check_list, fazenda_check_list = [], []
        current_fazenda = group.iloc[0]['fazenda']
        for _, row in group.iterrows():
            if row['fazenda'] == current_fazenda or row['fonte'] == 'TRANSFERENCIAS':
                check_list.append(True)
                fazenda_check_list.append(row['fazenda'])
                current_fazenda = row['fazenda']
            else:
                check_list.append(False)
                fazenda_check_list.append(current_fazenda)
        group['check'] = check_list
        group['fazenda_check'] = fazenda_check_list
        return group

    gb = df_final.groupby('cod_animal', group_keys=True)
    try:
        df2 = gb.apply(update_check, include_groups=False)
    except TypeError:
        df2 = gb.apply(update_check)
    if 'cod_animal' not in df2.columns:
        df2 = df2.reset_index(level=0)
    df_final = df2.reset_index(drop=True)

    df_err_fazenda = df_final.loc[~df_final['check']].copy()
    df_err_fazenda['base_erro']   = df_err_fazenda['nome_planilha']
    df_err_fazenda['motivo_erro'] = df_err_fazenda.apply(
        lambda r: f"Mudança de fazenda sem transferência. Anterior: {r['fazenda_check']} | Atual: {r['fazenda']}", axis=1)
    df_erros = pd.concat([df_erros, df_err_fazenda[COLUNAS_ERROS]], ignore_index=True)

    # 4. Tratar financeiro
    log.info("💰 Tratando dados financeiros...")
    df_fin = pd.DataFrame(spreadsheet_original.worksheet('financeiro').get_all_records(numericise_ignore=['all']))
    for col in df_fin.columns:
        if 'opcao' in col:
            df_fin.drop(col, axis=1, inplace=True)
    df_fin['valor_pagamento'] = (
        df_fin['valor_pagamento'].replace('', np.nan)
        .astype(str).str.replace('R$','').str.replace('.','').str.replace(',','.').astype(float)
    )
    df_datas_err, df_fin = check_formato_data('financeiro', df_fin, 'data_nota', 'desc_lancamento', True)
    df_erros = pd.concat([df_erros, df_datas_err], ignore_index=True)

    # 5. Tratar estoque
    log.info("📦 Tratando dados de estoque...")
    df_estoque = pd.DataFrame(spreadsheet_original.worksheet('estoque').get_all_records(numericise_ignore=['all']))
    for col in ['qtde_unit', 'valor_total', 'valor_unitario']:
        df_estoque[col] = (
            df_estoque[col].astype(str).str.strip()
            .str.replace('R$','',regex=False).str.replace('.','',regex=False)
            .str.replace(',','.').str.replace(' ','').str.replace('-','')
            .replace('','0').fillna('0').astype(float)
        )
        df_estoque[col] = pd.to_numeric(df_estoque[col], errors='coerce')
    df_estoque['data_lancamento'] = pd.to_datetime(df_estoque['data_lancamento'], format='%d/%m/%Y', errors='coerce')
    df_estoque.loc[df_estoque['classif_mov'] == 'SAÍDA', 'valor_unitario'] = None

    # 6. Salvar tudo
    log.info("💾 Salvando dados no Google Sheets e PostgreSQL...")
    for nome, df in planilhas_inserir.items():
        if nome in ('transferencias', 'estoque'):
            continue
        df['data'] = pd.to_datetime(df['data'], format='%d/%m/%Y', errors='coerce').dt.strftime('%d/%m/%Y').fillna(df['data'])
        erros_nome = df_erros[df_erros['base_erro'] == nome].copy()
        erros_nome['chave'] = erros_nome['data'].fillna('(Em branco)').astype(str) + erros_nome['cod_animal'].astype(str)
        df['chave'] = df['data'].fillna('(Em branco)').astype(str) + df['cod_animal'].astype(str)
        validos = df[~df['chave'].isin(erros_nome['chave'])].drop(columns=['chave'])
        validos = validos[~validos['data'].isna()]

        if nome == 'iatfs':
            validos['custo_iatf'] = validos['custo_iatf'].replace('', np.nan).str.replace(',', '.', regex=False).astype(float)
            validos['ecc'] = validos['ecc'].replace('', np.nan).astype(str).str.replace(',','.').astype(float)
        if nome in ('compras','nascimentos','vendas','mortes'):
            validos['data'] = pd.to_datetime(validos['data'], format='%d/%m/%Y')
            validos = validos[~validos['cod_animal'].isin(erros_nome['cod_animal'].tolist())]
        if nome != 'erros' and 'cod_animal_original' in validos.columns:
            validos = validos.drop(columns=['cod_animal_original'])
        if nome in ('nascimentos','pesagens','compras'):
            validos['sexo'] = validos['sexo'].apply(
                lambda x: 'MACHO' if str(x).startswith('M') else 'FÊMEA' if str(x).startswith('F') else x)
        for col_drop in ['planilha','fazenda_ajustada']:
            if col_drop in validos.columns:
                validos.drop(columns=[col_drop], inplace=True)
        if 'peso' in validos.columns:
            validos['peso'] = validos['peso'].replace('', np.nan).astype(str).str.replace(',','.').astype(float)
        if 'fazenda' in validos.columns:
            validos = validos[validos['fazenda'].isin(FAZENDAS)]
        if 'estacao' in validos.columns:
            validos = validos[validos['estacao'].isin(FAZENDAS)]
        if nome in ('pesagens','iatfs','mortes','vendas'):
            cod_possivel_importacao.extend(validos['cod_animal'].tolist())

        validos['data'] = pd.to_datetime(validos['data'], format='%d/%m/%Y')
        salvar_sheets(spreadsheet_tratada, nome, validos)
        salvar_bd(nome, validos)

    # Transferências
    entradas_val = get_entradas_validas(planilhas_originais, df_erros)
    cod_validos   = entradas_val['cod_animal'].tolist()
    df_transf     = planilhas_inserir['transferencias'].copy()
    transf_inv    = df_transf[~df_transf['cod_animal'].isin(cod_validos) & ~df_transf['cod_animal'].isin(cod_possivel_importacao)].copy()
    if len(transf_inv) > 0:
        transf_inv['base_erro']          = 'transferencias'
        transf_inv['motivo_erro']        = 'Animal com problema no registro de entrada.'
        transf_inv['cod_animal_original'] = 'NA'
        df_erros = pd.concat([df_erros, transf_inv[COLUNAS_ERROS]])

    transf_val = df_transf[df_transf['cod_animal'].isin(cod_validos) | df_transf['cod_animal'].isin(cod_possivel_importacao)].copy()
    transf_val['data'] = pd.to_datetime(transf_val['data'], format='%d/%m/%Y', errors='coerce').dt.strftime('%d/%m/%Y').fillna(transf_val['data'])

    df_erros_final = df_erros.drop(columns=['cod_animal_original'], errors='ignore')
    salvar_sheets(spreadsheet_tratada, 'erros', df_erros_final)
    salvar_bd('erros', df_erros_final)

    salvar_sheets(spreadsheet_tratada, 'transferencias', transf_val)
    salvar_bd('transferencias', transf_val)

    salvar_sheets(spreadsheet_tratada, 'financeiro', df_fin)
    salvar_bd('financeiro', df_fin)

    # Estoque FIFO
    log.info("🧮 Calculando custos de estoque (FIFO)...")
    salvar_sheets(spreadsheet_tratada, 'estoque', df_estoque)
    salvar_bd('estoque', df_estoque)

    df_allocations, df_entradas_fifo = get_allocations_and_entries_df()
    salvar_sheets(spreadsheet_tratada, 'entradas_apos_distribuicao', df_entradas_fifo)
    salvar_bd('entradas_apos_distribuicao', df_entradas_fifo)
    salvar_sheets(spreadsheet_tratada, 'saidas_com_alocacoes', df_allocations)
    salvar_bd('saidas_com_alocacoes', df_allocations)

    log.info(f"🎉 Pipeline concluído! Erros totais encontrados: {len(df_erros)}")


if __name__ == '__main__':
    main()
