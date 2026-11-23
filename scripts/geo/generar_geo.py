#!/usr/bin/env python3
"""
Genera los datos de ubicación de Arequipa que usa Mesagri (paquete compartido):

  packages/shared/src/geo/ccpp.json     centros poblados (INEI) con coordenadas
  packages/shared/src/geo/limites.json  límites simplificados de los 109 distritos
  (y muestra las filas de DISTRICTS para packages/shared/src/ubigeo.ts)

Fuentes (datos abiertos del INEI, publicados en GitHub):
  - Distritos, capitales y coordenadas: jmcastagnetto/ubigeo-peru-aumentado (ubigeo_distrito.csv)
  - Centros poblados: jmcastagnetto/ubigeo (data/ubigeo_ccpp.rda)
  - Límites distritales simplificados: juaneladio/peru-geojson (peru_distrital_simple.geojson)

Uso (descarga primero los tres archivos en una carpeta):
  pip install pyreadr
  python3 -I scripts/geo/generar_geo.py <carpeta_descargas> <raiz_del_repo>
"""
import csv, json, math, re, sys, unicodedata

src_dir, repo = sys.argv[1], sys.argv[2]

# --- nombres oficiales (con tildes) de los 109 distritos y sus provincias ---
PROV = {
    '0401': ('AREQUIPA', 'Arequipa'), '0402': ('CAMANA', 'Camaná'), '0403': ('CARAVELI', 'Caravelí'),
    '0404': ('CASTILLA', 'Castilla'), '0405': ('CAYLLOMA', 'Caylloma'), '0406': ('CONDESUYOS', 'Condesuyos'),
    '0407': ('ISLAY', 'Islay'), '0408': ('LA_UNION', 'La Unión'),
}
NAMES = {
 '040101': 'Arequipa (Cercado)', '040102': 'Alto Selva Alegre', '040103': 'Cayma', '040104': 'Cerro Colorado', '040105': 'Characato',
 '040106': 'Chiguata', '040107': 'Jacobo Hunter', '040108': 'La Joya', '040109': 'Mariano Melgar', '040110': 'Miraflores',
 '040111': 'Mollebaya', '040112': 'Paucarpata', '040113': 'Pocsi', '040114': 'Polobaya', '040115': 'Quequeña', '040116': 'Sabandía',
 '040117': 'Sachaca', '040118': 'San Juan de Siguas', '040119': 'San Juan de Tarucani', '040120': 'Santa Isabel de Siguas',
 '040121': 'Santa Rita de Siguas', '040122': 'Socabaya', '040123': 'Tiabaya', '040124': 'Uchumayo', '040125': 'Vítor',
 '040126': 'Yanahuara', '040127': 'Yarabamba', '040128': 'Yura', '040129': 'José Luis Bustamante y Rivero',
 '040201': 'Camaná', '040202': 'José María Quimper', '040203': 'Mariano Nicolás Valcárcel', '040204': 'Mariscal Cáceres',
 '040205': 'Nicolás de Piérola', '040206': 'Ocoña', '040207': 'Quilca', '040208': 'Samuel Pastor',
 '040301': 'Caravelí', '040302': 'Acarí', '040303': 'Atico', '040304': 'Atiquipa', '040305': 'Bella Unión', '040306': 'Cahuacho',
 '040307': 'Chala', '040308': 'Chaparra', '040309': 'Huanuhuanu', '040310': 'Jaqui', '040311': 'Lomas', '040312': 'Quicacha', '040313': 'Yauca',
 '040401': 'Aplao', '040402': 'Andagua', '040403': 'Ayo', '040404': 'Chachas', '040405': 'Chilcaymarca', '040406': 'Choco',
 '040407': 'Huancarqui', '040408': 'Machaguay', '040409': 'Orcopampa', '040410': 'Pampacolca', '040411': 'Tipán', '040412': 'Uñón',
 '040413': 'Uraca', '040414': 'Viraco',
 '040501': 'Chivay', '040502': 'Achoma', '040503': 'Cabanaconde', '040504': 'Callalli', '040505': 'Caylloma', '040506': 'Coporaque',
 '040507': 'Huambo', '040508': 'Huanca', '040509': 'Ichupampa', '040510': 'Lari', '040511': 'Lluta', '040512': 'Maca', '040513': 'Madrigal',
 '040514': 'San Antonio de Chuca', '040515': 'Sibayo', '040516': 'Tapay', '040517': 'Tisco', '040518': 'Tuti', '040519': 'Yanque', '040520': 'Majes',
 '040601': 'Chuquibamba', '040602': 'Andaray', '040603': 'Cayarani', '040604': 'Chichas', '040605': 'Iray', '040606': 'Río Grande',
 '040607': 'Salamanca', '040608': 'Yanaquihua',
 '040701': 'Mollendo', '040702': 'Cocachacra', '040703': 'Deán Valdivia', '040704': 'Islay', '040705': 'Mejía', '040706': 'Punta de Bombón',
 '040801': 'Cotahuasi', '040802': 'Alca', '040803': 'Charcana', '040804': 'Huaynacotas', '040805': 'Pampamarca', '040806': 'Puyca',
 '040807': 'Quechualla', '040808': 'Sayla', '040809': 'Tauria', '040810': 'Tomepampa', '040811': 'Toro',
}
# distritos de la ciudad de Arequipa (reparto urbano)
CITY = {'040101', '040102', '040103', '040104', '040107', '040109', '040110', '040112', '040117', '040122', '040126', '040129'}
# posiciones del mapa esquemático ya usadas por la app (se conservan)
SKETCH = {
 '040101': (75, 63), '040102': (77, 60), '040103': (73, 59), '040104': (70, 59), '040109': (78, 63), '040110': (77, 62),
 '040112': (78, 65), '040117': (72, 64), '040122': (76, 67), '040126': (73, 62), '040129': (76, 65),
 '040201': (16, 82), '040202': (18, 80), '040203': (12, 74), '040205': (19, 78), '040208': (17, 84),
 '040501': (60, 18), '040502': (56, 20), '040503': (44, 22), '040506': (59, 15), '040519': (57, 19), '040520': (40, 56),
}

# --- nombres en mayúsculas → «Título» con tildes frecuentes ---
LOWER = {'de', 'del', 'y', 'e', 'en', 'a'}
ARTICLE = {'el', 'la', 'los', 'las'}  # en minúscula solo después de «de», «en» o «a» (Señor de los Milagros, Irrigación El Cóndor)
ROMAN = {'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'}
ACCENT = {w.upper().translate(str.maketrans('ÁÉÍÓÚ', 'AEIOU')): w for w in '''
José María Río Estación Irrigación Paraíso Ángeles Jesús Concepción Asunción Bolívar Camaná Caravelí Vítor Sabandía Piérola
Valcárcel Cáceres Acarí Tipán Uñón Deán Mejía Bombón Martín Agustín Sebastián Cristóbal Andrés Tomás Lucía Bárbara Mónica Inés
Ramón León Román Joaquín Belén Jerusalén Edén Unión Ascensión Encarnación Purísima Corazón Santísima Perú América Álamo Álamos
Árbol Túnel Panteón Cañón Cóndor García Rodríguez González Pérez Martínez López Sánchez Díaz Hernández Álvarez Gómez Núñez
Jiménez Fernández Ramírez Vásquez Méndez Suárez Chávez Benítez Alegría Espíritu Misión Población Asociación Urbanización
Agrícola Caserío Kilómetro Número Fátima Verónica Bajío Océano Pacífico Socabón Jardín Limón Maíz Balcón Mesón Callejón Portón
Córdova Lázaro Nicolás Matías Elías Rocío Huamán Ocoña Quequeña Chiguata Tiabaya Atico Atiquipa Machaguay Viraco Andagua
Cotahuasi Orcopampa Cabanaconde Chivay Paucarpata Yanahuara Sachaca Uchumayo Mollendo Cocachacra Ilo Tacna Puno Cusco
Huayllacucho Rosario Pacífico Ángel Rafaél Ícaro Óvalo Ébano Héroes Mártires Glorias Patrón Señor Niño Virgen Milagros
Alberto Víctor Héctor Félix Andrés Ángela Sofía Raúl Saúl Darío Mario Julián Adrián Damián Fabián Germán Hernán Simón
Gastón Cayetano Ayacucho Junín Apurímac Huánuco Áncash Ica Moquegua Callao Lima Pisco Nazca Chincha Majes Sihuas Siguas
Ocoña Yauca Chaparra Jaqui Acarí Cháparra Cerrillos Pucará Huaraconde Huacán Quiñón Tambillo Pampacolca Chuquibamba
Castañón Sucúmbe Chachacomo Chacarilla Cruz Ñaña Peña Campiña Montaña Cabaña Cañaveral Calvario Fundición Molino
Mínas Minería Pesquería Educación Ganadería Agricultura Cooperativa Comunidad Fundición Pabellón Galpón Tablón Rincón
Rinconada Canchón Mojón Peñón Tunél Totoral Sauce Huerta Jardines Vía Estación Línea Ferrocarril Plazuela Centro'''.split()}
ACCENT.pop('MINAS', None); ACCENT.pop('TUNEL', None)  # sin tilde
ACCENT['TUNEL'] = 'Túnel'; ACCENT['RAFAEL'] = 'Rafael'; ACCENT['ROSARIO'] = 'Rosario'; ACCENT['CRUZ'] = 'Cruz'; ACCENT['CENTRO'] = 'Centro'
ACCENT['CHAPARRA'] = 'Chaparra'

def title(s: str) -> str:
    s = re.sub(r'\s+', ' ', s.strip())
    out = []
    tokens = re.split(r'(\s+|[-/(),.])', s)
    first = True
    prev = ''
    for t in tokens:
        if not t or re.fullmatch(r'\s+|[-/(),.]', t):
            out.append(t); continue
        u = t.upper()
        if u in ROMAN and not first:
            w = u
        elif u in ACCENT:
            w = ACCENT[u]
        elif u.lower() in LOWER and not first:
            w = u.lower()
        elif u.lower() in ARTICLE and not first and prev in ('de', 'en', 'a'):
            w = u.lower()
        elif re.fullmatch(r'\d+[A-Z]?', u):
            w = u
        else:
            w = u[0] + u[1:].lower()
        out.append(w); first = False; prev = w
    r = ''.join(out)
    r = re.sub(r'\(\s*', '(', r); r = re.sub(r'\s*\)', ')', r)
    return r

# --- distritos: capital y coordenadas ---
dist = {}
for r in csv.DictReader(open(src_dir + '/ubigeo_distrito.csv', encoding='utf-8')):
    if not r['inei'].startswith('04'): continue
    dist[r['inei']] = dict(capital=title(r['capital']), lat=round(float(r['latitude']), 5), lng=round(float(r['longitude']), 5),
                           alt=int(float(r['altitude'] or 0)), area=float(r['superficie'] or 0))
assert set(dist) == set(NAMES), set(dist) ^ set(NAMES)
# capitales con nombre conocido distinto del que trae el archivo
CAPITAL_FIX = {'040104': 'La Libertad', '040129': 'Ciudad Satélite', '040520': 'El Pedregal', '040704': 'Matarani', '040703': 'La Curva',
               '040606': 'Iquipi', '040413': 'Corire', '040101': 'Arequipa', '040102': 'Selva Alegre'}
for k, v in CAPITAL_FIX.items(): dist[k]['capital'] = v

# --- límites ---
g = json.load(open(src_dir + '/peru_distrital_simple.geojson', encoding='utf-8'))
lim = {}
for f in g['features']:
    code = str(f['properties']['IDDIST'])
    if not code.startswith('04'): continue
    geom = f['geometry']
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    lim[code] = [[[[round(x, 4), round(y, 4)] for x, y in ring] for ring in poly] for poly in polys]
assert set(lim) == set(NAMES), set(lim) ^ set(NAMES)

def in_ring(x, y, ring):
    ins = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            ins = not ins
        j = i
    return ins

def in_district(x, y, code):
    for poly in lim[code]:
        if in_ring(x, y, poly[0]) and not any(in_ring(x, y, h) for h in poly[1:]):
            return True
    return False

def locate(x, y):
    return [c for c in lim if in_district(x, y, c)]

bad_cap = [(c, NAMES[c], locate(d['lng'], d['lat'])) for c, d in dist.items() if not in_district(d['lng'], d['lat'], c)]
print(f'capitales fuera de su polígono: {len(bad_cap)}', file=sys.stderr)
for b in bad_cap: print('  ', b, file=sys.stderr)

# --- centros poblados ---
import pyreadr
df = pyreadr.read_r(src_dir + '/ubigeo_ccpp.rda')['ubigeo_ccpp']
aq = df[df['inei_district'].astype(str).str.startswith('04')]
rows = []
miss = 0
for _, r in aq.iterrows():
    code = str(r['inei_ccpp']); dcode = code[:6]
    lat, lng = round(float(r['latitude']), 5), round(float(r['longitude']), 5)
    if dcode not in NAMES: continue
    if not in_district(lng, lat, dcode): miss += 1
    name = title(str(r['ccpp']))
    m = re.fullmatch(r'([A-E])-?(\d+)', name)
    if m and dcode == '040520': name = f'Sección {m.group(1)}{m.group(2)} (Pampa de Majes)'
    rows.append([code, name, lat, lng, 'U' if str(r['type']) == 'Urban' else 'R'])
rows.sort(key=lambda x: x[0])
print(f'centros poblados: {len(rows)} · fuera del polígono de su distrito: {miss} ({miss * 100 / len(rows):.1f} %)', file=sys.stderr)

out = repo + '/packages/shared/src/geo/'
import os
os.makedirs(out, exist_ok=True)
json.dump({'v': 1, 'fuente': 'INEI, centros poblados (vía jmcastagnetto/ubigeo)', 'cols': ['codigo', 'nombre', 'lat', 'lng', 'tipo'], 'filas': rows},
          open(out + 'ccpp.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump({'v': 1, 'fuente': 'INEI, límites distritales simplificados (vía juaneladio/peru-geojson); [lng, lat]', 'distritos': lim},
          open(out + 'limites.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# --- mapa esquemático: ajuste afín (lng, lat) → (x, y) con los 22 distritos que ya tenían posición ---
import numpy as np
A = np.array([[dist[c]['lng'], dist[c]['lat'], 1] for c in SKETCH])
B = np.array([SKETCH[c] for c in SKETCH], dtype=float)
M, *_ = np.linalg.lstsq(A, B, rcond=None)
err = np.abs(A @ M - B).mean(axis=0)
print(f'ajuste del mapa esquemático: error medio x={err[0]:.1f} y={err[1]:.1f}', file=sys.stderr)
def sketch(c):
    if c in SKETCH: return SKETCH[c]
    x, y = np.array([dist[c]['lng'], dist[c]['lat'], 1]) @ M
    return (int(round(min(96, max(4, x)))), int(round(min(96, max(4, y)))))

def box(c, m=0.02):
    xs = [pt[0] for poly in lim[c] for ring in poly for pt in ring]; ys = [pt[1] for poly in lim[c] for ring in poly for pt in ring]
    d = dist[c]; xs.append(d['lng']); ys.append(d['lat'])
    return [round(min(xs) - m, 3), round(min(ys) - m, 3), round(max(xs) + m, 3), round(max(ys) + m, 3)]

lines = []
for c in sorted(NAMES):
    p = PROV[c[:4]][0]; d = dist[c]; x, y = sketch(c)
    city = ', city: true' if c in CITY else ''
    lines.append(f"  {{ code: '{c}', name: '{NAMES[c]}', province: '{p}', capital: '{d['capital']}', lat: {d['lat']}, lng: {d['lng']}, alt: {d['alt']}, box: {box(c)}, geo: {{ x: {x}, y: {y} }}{city} }},")
print('\n'.join(lines))
caps = {'0401': '040101', '0402': '040201', '0403': '040301', '0404': '040401', '0405': '040501', '0406': '040601', '0407': '040701', '0408': '040801'}
for pc, (k, n) in PROV.items():
    x, y = sketch(caps[pc]) if k not in ('AREQUIPA', 'CAMANA', 'CAYLLOMA') else {'AREQUIPA': (74, 62), 'CAMANA': (16, 82), 'CAYLLOMA': (58, 18)}[k]
    print(f"  {k}: {{ name: '{n}', capital: '{caps[pc]}', geo: {{ x: {x}, y: {y} }} }},", file=sys.stderr)
