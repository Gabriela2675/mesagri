/*
 * Ubigeo de Arequipa (INEI): las 8 provincias y sus 109 distritos, con nombre oficial, capital y
 * coordenadas de la capital. Datos abiertos del INEI (ver scripts/geo/generar_geo.py).
 * box: rectángulo que contiene al distrito (con ~2 km de margen), para comprobar que un punto
 *      está en el distrito sin cargar los límites completos.
 * geo: posición en el mapa esquemático de la app (0–100), no son coordenadas reales.
 */

export type ProvinceCode = 'AREQUIPA' | 'CAMANA' | 'CARAVELI' | 'CASTILLA' | 'CAYLLOMA' | 'CONDESUYOS' | 'ISLAY' | 'LA_UNION';

export interface District {
  code: string;
  name: string;
  province: ProvinceCode;
  /** capital del distrito (centro poblado) */
  capital: string;
  lat: number;
  lng: number;
  /** altitud de la capital (m s. n. m.) */
  alt: number;
  /** [lng mín, lat mín, lng máx, lat máx] */
  box: [number, number, number, number];
  geo: { x: number; y: number };
  /** distrito de la ciudad de Arequipa (reparto urbano) */
  city?: boolean;
}

export const PROVINCES: Record<ProvinceCode, { name: string; capital: string; geo: { x: number; y: number } }> = {
  AREQUIPA: { name: 'Arequipa', capital: '040101', geo: { x: 74, y: 62 } },
  CAMANA: { name: 'Camaná', capital: '040201', geo: { x: 16, y: 82 } },
  CARAVELI: { name: 'Caravelí', capital: '040301', geo: { x: 4, y: 46 } },
  CASTILLA: { name: 'Castilla', capital: '040401', geo: { x: 27, y: 53 } },
  CAYLLOMA: { name: 'Caylloma', capital: '040501', geo: { x: 58, y: 18 } },
  CONDESUYOS: { name: 'Condesuyos', capital: '040601', geo: { x: 18, y: 42 } },
  ISLAY: { name: 'Islay', capital: '040701', geo: { x: 58, y: 96 } },
  LA_UNION: { name: 'La Unión', capital: '040801', geo: { x: 4, y: 10 } },
};
export const PROVINCE_CODES = Object.keys(PROVINCES) as ProvinceCode[];

export const DISTRICTS: District[] = [
  { code: '040101', name: 'Arequipa (Cercado)', province: 'AREQUIPA', capital: 'Arequipa', lat: -16.39333, lng: -71.52889, alt: 2429, box: [-71.587, -16.454, -71.493, -16.354], geo: { x: 75, y: 63 }, city: true },
  { code: '040102', name: 'Alto Selva Alegre', province: 'AREQUIPA', capital: 'Selva Alegre', lat: -16.38, lng: -71.52111, alt: 2510, box: [-71.556, -16.41, -71.391, -16.266], geo: { x: 77, y: 60 }, city: true },
  { code: '040103', name: 'Cayma', province: 'AREQUIPA', capital: 'Cayma', lat: -16.3625, lng: -71.54417, alt: 2531, box: [-71.572, -16.411, -71.319, -16.145], geo: { x: 73, y: 59 }, city: true },
  { code: '040104', name: 'Cerro Colorado', province: 'AREQUIPA', capital: 'La Libertad', lat: -16.37639, lng: -71.56083, alt: 2441, box: [-71.671, -16.428, -71.486, -16.18], geo: { x: 70, y: 59 }, city: true },
  { code: '040105', name: 'Characato', province: 'AREQUIPA', capital: 'Characato', lat: -16.46861, lng: -71.48444, alt: 2506, box: [-71.536, -16.515, -71.219, -16.384], geo: { x: 76, y: 64 } },
  { code: '040106', name: 'Chiguata', province: 'AREQUIPA', capital: 'Chiguata', lat: -16.40361, lng: -71.39167, alt: 3006, box: [-71.471, -16.462, -71.234, -16.276], geo: { x: 80, y: 59 } },
  { code: '040107', name: 'Jacobo Hunter', province: 'AREQUIPA', capital: 'Jacobo Hunter', lat: -16.44139, lng: -71.55861, alt: 2309, box: [-71.596, -16.514, -71.518, -16.402], geo: { x: 73, y: 63 }, city: true },
  { code: '040108', name: 'La Joya', province: 'AREQUIPA', capital: 'La Joya', lat: -16.42306, lng: -71.81833, alt: 1640, box: [-71.937, -16.806, -71.617, -16.378], geo: { x: 61, y: 65 } },
  { code: '040109', name: 'Mariano Melgar', province: 'AREQUIPA', capital: 'Mariano Melgar', lat: -16.40722, lng: -71.50556, alt: 2459, box: [-71.536, -16.43, -71.401, -16.301], geo: { x: 78, y: 63 }, city: true },
  { code: '040110', name: 'Miraflores', province: 'AREQUIPA', capital: 'Miraflores', lat: -16.39472, lng: -71.5225, alt: 2450, box: [-71.549, -16.423, -71.391, -16.276], geo: { x: 77, y: 62 }, city: true },
  { code: '040111', name: 'Mollebaya', province: 'AREQUIPA', capital: 'Mollebaya', lat: -16.48722, lng: -71.46694, alt: 2515, box: [-71.537, -16.551, -71.405, -16.467], geo: { x: 77, y: 65 } },
  { code: '040112', name: 'Paucarpata', province: 'AREQUIPA', capital: 'Paucarpata', lat: -16.43278, lng: -71.50472, alt: 2453, box: [-71.535, -16.469, -71.408, -16.373], geo: { x: 78, y: 65 }, city: true },
  { code: '040113', name: 'Pocsi', province: 'AREQUIPA', capital: 'Pocsi', lat: -16.51778, lng: -71.38972, alt: 3045, box: [-71.468, -16.573, -71.219, -16.411], geo: { x: 81, y: 66 } },
  { code: '040114', name: 'Polobaya', province: 'AREQUIPA', capital: 'Polobaya Grande', lat: -16.56583, lng: -71.36833, alt: 3116, box: [-71.502, -16.784, -71.225, -16.462], geo: { x: 82, y: 68 } },
  { code: '040115', name: 'Quequeña', province: 'AREQUIPA', capital: 'Quequeña', lat: -16.55722, lng: -71.45139, alt: 2561, box: [-71.516, -16.589, -71.371, -16.498], geo: { x: 78, y: 68 } },
  { code: '040116', name: 'Sabandía', province: 'AREQUIPA', capital: 'Sabandía', lat: -16.45694, lng: -71.49472, alt: 2441, box: [-71.536, -16.505, -71.387, -16.4], geo: { x: 76, y: 63 } },
  { code: '040117', name: 'Sachaca', province: 'AREQUIPA', capital: 'Sachaca', lat: -16.42444, lng: -71.56639, alt: 2300, box: [-71.622, -16.468, -71.532, -16.385], geo: { x: 72, y: 64 }, city: true },
  { code: '040118', name: 'San Juan de Siguas', province: 'AREQUIPA', capital: 'San Juan de Siguas', lat: -16.34611, lng: -72.12833, alt: 1281, box: [-72.219, -16.503, -72.108, -16.326], geo: { x: 46, y: 64 } },
  { code: '040119', name: 'San Juan de Tarucani', province: 'AREQUIPA', capital: 'Tarucani', lat: -16.18361, lng: -71.06194, alt: 4217, box: [-71.431, -16.506, -70.793, -15.902], geo: { x: 92, y: 44 } },
  { code: '040120', name: 'Santa Isabel de Siguas', province: 'AREQUIPA', capital: 'Santa Isabel de Siguas', lat: -16.32083, lng: -72.09889, alt: 1390, box: [-72.164, -16.417, -71.937, -16.119], geo: { x: 47, y: 62 } },
  { code: '040121', name: 'Santa Rita de Siguas', province: 'AREQUIPA', capital: 'Santa Rita de Siguas', lat: -16.49361, lng: -72.09472, alt: 1283, box: [-72.303, -16.655, -72.014, -16.357], geo: { x: 49, y: 72 } },
  { code: '040122', name: 'Socabaya', province: 'AREQUIPA', capital: 'Socabaya', lat: -16.4675, lng: -71.52861, alt: 2352, box: [-71.581, -16.522, -71.483, -16.416], geo: { x: 76, y: 67 }, city: true },
  { code: '040123', name: 'Tiabaya', province: 'AREQUIPA', capital: 'Tiabaya', lat: -16.44944, lng: -71.59167, alt: 2218, box: [-71.643, -16.54, -71.554, -16.387], geo: { x: 71, y: 64 } },
  { code: '040124', name: 'Uchumayo', province: 'AREQUIPA', capital: 'Uchumayo', lat: -16.42528, lng: -71.6725, alt: 1976, box: [-71.834, -16.578, -71.576, -16.346], geo: { x: 67, y: 64 } },
  { code: '040125', name: 'Vítor', province: 'AREQUIPA', capital: 'Vítor', lat: -16.46583, lng: -71.93583, alt: 1189, box: [-72.303, -16.82, -71.77, -16.124], geo: { x: 56, y: 69 } },
  { code: '040126', name: 'Yanahuara', province: 'AREQUIPA', capital: 'Yanahuara', lat: -16.38194, lng: -71.53639, alt: 2402, box: [-71.587, -16.427, -71.513, -16.348], geo: { x: 73, y: 62 }, city: true },
  { code: '040127', name: 'Yarabamba', province: 'AREQUIPA', capital: 'Yarabamba', lat: -16.54667, lng: -71.47556, alt: 2467, box: [-71.725, -16.784, -71.382, -16.471], geo: { x: 77, y: 68 } },
  { code: '040128', name: 'Yura', province: 'AREQUIPA', capital: 'Yura', lat: -16.24694, lng: -71.70639, alt: 2495, box: [-71.927, -16.414, -71.268, -15.907], geo: { x: 64, y: 54 } },
  { code: '040129', name: 'José Luis Bustamante y Rivero', province: 'AREQUIPA', capital: 'Ciudad Satélite', lat: -16.42667, lng: -71.52389, alt: 2389, box: [-71.564, -16.475, -71.481, -16.39], geo: { x: 76, y: 65 }, city: true },
  { code: '040201', name: 'Camaná', province: 'CAMANA', capital: 'Camaná', lat: -16.62472, lng: -72.71139, alt: 20, box: [-72.746, -16.673, -72.683, -16.591], geo: { x: 16, y: 82 } },
  { code: '040202', name: 'José María Quimper', province: 'CAMANA', capital: 'El Cardo', lat: -16.60194, lng: -72.72722, alt: 35, box: [-72.771, -16.635, -72.692, -16.556], geo: { x: 18, y: 80 } },
  { code: '040203', name: 'Mariano Nicolás Valcárcel', province: 'CAMANA', capital: 'Urasqui', lat: -16.03139, lng: -73.17444, alt: 362, box: [-73.255, -16.253, -72.965, -15.854], geo: { x: 12, y: 74 } },
  { code: '040204', name: 'Mariscal Cáceres', province: 'CAMANA', capital: 'San José', lat: -16.61972, lng: -72.73611, alt: 18, box: [-73.035, -16.668, -72.686, -16.284], geo: { x: 21, y: 86 } },
  { code: '040205', name: 'Nicolás de Piérola', province: 'CAMANA', capital: 'San Gregorio', lat: -16.57306, lng: -72.71583, alt: 71, box: [-72.792, -16.612, -72.446, -16.359], geo: { x: 19, y: 78 } },
  { code: '040206', name: 'Ocoña', province: 'CAMANA', capital: 'Ocoña', lat: -16.43167, lng: -73.105, alt: 16, box: [-73.312, -16.529, -72.779, -16.003], geo: { x: 4, y: 79 } },
  { code: '040207', name: 'Quilca', province: 'CAMANA', capital: 'Quilca', lat: -16.71694, lng: -72.42556, alt: 82, box: [-72.642, -16.945, -72.112, -16.439], geo: { x: 36, y: 88 } },
  { code: '040208', name: 'Samuel Pastor', province: 'CAMANA', capital: 'La Pampa', lat: -16.61361, lng: -72.69917, alt: 21, box: [-72.735, -16.684, -72.567, -16.517], geo: { x: 17, y: 84 } },
  { code: '040301', name: 'Caravelí', province: 'CARAVELI', capital: 'Caravelí', lat: -15.7725, lng: -73.36583, alt: 1811, box: [-73.521, -16.085, -73.205, -15.644], geo: { x: 4, y: 46 } },
  { code: '040302', name: 'Acarí', province: 'CARAVELI', capital: 'Acarí', lat: -15.43556, lng: -74.61639, alt: 171, box: [-74.672, -15.676, -74.368, -15.141], geo: { x: 4, y: 41 } },
  { code: '040303', name: 'Atico', province: 'CARAVELI', capital: 'Atico', lat: -16.20833, lng: -73.62361, alt: 101, box: [-73.922, -16.425, -73.18, -15.715], geo: { x: 4, y: 73 } },
  { code: '040304', name: 'Atiquipa', province: 'CARAVELI', capital: 'Atiquipa', lat: -15.79611, lng: -74.36361, alt: 330, box: [-74.473, -15.869, -74.174, -15.461], geo: { x: 4, y: 58 } },
  { code: '040305', name: 'Bella Unión', province: 'CARAVELI', capital: 'Bella Unión', lat: -15.45056, lng: -74.65833, alt: 218, box: [-74.928, -15.676, -74.482, -15.078], geo: { x: 4, y: 42 } },
  { code: '040306', name: 'Cahuacho', province: 'CARAVELI', capital: 'Cahuacho', lat: -15.50278, lng: -73.47972, alt: 3423, box: [-73.684, -15.772, -73.185, -15.336], geo: { x: 4, y: 32 } },
  { code: '040307', name: 'Chala', province: 'CARAVELI', capital: 'Chala', lat: -15.86556, lng: -74.2475, alt: 21, box: [-74.317, -15.908, -74.038, -15.641], geo: { x: 4, y: 61 } },
  { code: '040308', name: 'Chaparra', province: 'CARAVELI', capital: 'Achanizo', lat: -15.80528, lng: -73.96694, alt: 611, box: [-74.23, -16.124, -73.692, -15.537], geo: { x: 4, y: 54 } },
  { code: '040309', name: 'Huanuhuanu', province: 'CARAVELI', capital: 'Tocota', lat: -15.65889, lng: -74.09139, alt: 972, box: [-74.255, -15.725, -73.826, -15.372], geo: { x: 4, y: 48 } },
  { code: '040310', name: 'Jaqui', province: 'CARAVELI', capital: 'Jaqui', lat: -15.47917, lng: -74.44361, alt: 271, box: [-74.525, -15.609, -74.221, -15.282], geo: { x: 4, y: 42 } },
  { code: '040311', name: 'Lomas', province: 'CARAVELI', capital: 'Lomas', lat: -15.56972, lng: -74.85139, alt: 26, box: [-75.093, -15.59, -74.808, -15.131], geo: { x: 4, y: 51 } },
  { code: '040312', name: 'Quicacha', province: 'CARAVELI', capital: 'Quicacha', lat: -15.625, lng: -73.79833, alt: 1836, box: [-73.897, -15.818, -73.536, -15.304], geo: { x: 4, y: 43 } },
  { code: '040313', name: 'Yauca', province: 'CARAVELI', capital: 'Yauca', lat: -15.66194, lng: -74.52722, alt: 31, box: [-74.672, -15.786, -74.26, -15.486], geo: { x: 4, y: 53 } },
  { code: '040401', name: 'Aplao', province: 'CASTILLA', capital: 'Aplao', lat: -16.07611, lng: -72.49222, alt: 625, box: [-72.733, -16.268, -72.424, -15.768], geo: { x: 27, y: 53 } },
  { code: '040402', name: 'Andagua', province: 'CASTILLA', capital: 'Andagua', lat: -15.49889, lng: -72.35611, alt: 3594, box: [-72.546, -15.621, -72.213, -15.356], geo: { x: 28, y: 20 } },
  { code: '040403', name: 'Ayo', province: 'CASTILLA', capital: 'Ayo', lat: -15.68278, lng: -72.27194, alt: 2003, box: [-72.411, -15.756, -72.18, -15.51], geo: { x: 33, y: 29 } },
  { code: '040404', name: 'Chachas', province: 'CASTILLA', capital: 'Chachas', lat: -15.50139, lng: -72.27056, alt: 3117, box: [-72.328, -15.563, -71.894, -14.817], geo: { x: 32, y: 19 } },
  { code: '040405', name: 'Chilcaymarca', province: 'CASTILLA', capital: 'Chilcaymarca', lat: -15.28611, lng: -72.37667, alt: 3867, box: [-72.461, -15.455, -72.302, -15.23], geo: { x: 25, y: 9 } },
  { code: '040406', name: 'Choco', province: 'CASTILLA', capital: 'Choco', lat: -15.57667, lng: -72.12889, alt: 2418, box: [-72.253, -15.732, -71.881, -15.116], geo: { x: 39, y: 22 } },
  { code: '040407', name: 'Huancarqui', province: 'CASTILLA', capital: 'Huancarqui', lat: -16.09611, lng: -72.47222, alt: 620, box: [-72.511, -16.22, -72.205, -15.794], geo: { x: 28, y: 54 } },
  { code: '040408', name: 'Machaguay', province: 'CASTILLA', capital: 'Machaguay', lat: -15.65028, lng: -72.50611, alt: 3131, box: [-72.578, -15.752, -72.365, -15.485], geo: { x: 23, y: 30 } },
  { code: '040409', name: 'Orcopampa', province: 'CASTILLA', capital: 'Orcopampa', lat: -15.2625, lng: -72.34194, alt: 3818, box: [-72.397, -15.407, -72.082, -14.861], geo: { x: 26, y: 7 } },
  { code: '040410', name: 'Pampacolca', province: 'CASTILLA', capital: 'Pampacolca', lat: -15.71333, lng: -72.57389, alt: 2922, box: [-72.739, -15.828, -72.492, -15.526], geo: { x: 20, y: 34 } },
  { code: '040411', name: 'Tipán', province: 'CASTILLA', capital: 'Tipán', lat: -15.72306, lng: -72.50194, alt: 1939, box: [-72.554, -15.824, -72.451, -15.662], geo: { x: 23, y: 34 } },
  { code: '040412', name: 'Uñón', province: 'CASTILLA', capital: 'Uñón', lat: -15.72861, lng: -72.43222, alt: 2727, box: [-72.5, -15.878, -72.225, -15.607], geo: { x: 27, y: 34 } },
  { code: '040413', name: 'Uraca', province: 'CASTILLA', capital: 'Corire', lat: -16.22389, lng: -72.46972, alt: 452, box: [-72.675, -16.45, -72.338, -16.073], geo: { x: 30, y: 61 } },
  { code: '040414', name: 'Viraco', province: 'CASTILLA', capital: 'Viraco', lat: -15.65833, lng: -72.525, alt: 3210, box: [-72.649, -15.723, -72.489, -15.522], geo: { x: 22, y: 31 } },
  { code: '040501', name: 'Chivay', province: 'CAYLLOMA', capital: 'Chivay', lat: -15.64028, lng: -71.60361, alt: 3683, box: [-71.642, -15.772, -71.45, -15.501], geo: { x: 60, y: 18 } },
  { code: '040502', name: 'Achoma', province: 'CAYLLOMA', capital: 'Achoma', lat: -15.66, lng: -71.70361, alt: 3524, box: [-71.804, -16.003, -71.573, -15.626], geo: { x: 56, y: 20 } },
  { code: '040503', name: 'Cabanaconde', province: 'CAYLLOMA', capital: 'Cabanaconde', lat: -15.62, lng: -71.98194, alt: 3295, box: [-72.128, -15.819, -71.791, -15.562], geo: { x: 44, y: 22 } },
  { code: '040504', name: 'Callalli', province: 'CAYLLOMA', capital: 'Callalli', lat: -15.50639, lng: -71.44472, alt: 3887, box: [-71.554, -15.753, -70.974, -15.225], geo: { x: 69, y: 11 } },
  { code: '040505', name: 'Caylloma', province: 'CAYLLOMA', capital: 'Caylloma', lat: -15.18889, lng: -71.77333, alt: 4361, box: [-72.002, -15.437, -71.568, -14.77], geo: { x: 51, y: 4 } },
  { code: '040506', name: 'Coporaque', province: 'CAYLLOMA', capital: 'Coporaque', lat: -15.62722, lng: -71.64611, alt: 3600, box: [-71.71, -15.681, -71.559, -15.497], geo: { x: 59, y: 15 } },
  { code: '040507', name: 'Huambo', province: 'CAYLLOMA', capital: 'Huambo', lat: -15.72944, lng: -72.10972, alt: 3309, box: [-72.333, -15.981, -71.967, -15.586], geo: { x: 41, y: 30 } },
  { code: '040508', name: 'Huanca', province: 'CAYLLOMA', capital: 'Huanca', lat: -16.03361, lng: -71.87806, alt: 3073, box: [-72.016, -16.178, -71.684, -15.864], geo: { x: 54, y: 44 } },
  { code: '040509', name: 'Ichupampa', province: 'CAYLLOMA', capital: 'Ichupampa', lat: -15.65, lng: -71.68667, alt: 3422, box: [-71.757, -15.681, -71.658, -15.491], geo: { x: 59, y: 21 } },
  { code: '040510', name: 'Lari', province: 'CAYLLOMA', capital: 'Lari', lat: -15.61833, lng: -71.7725, alt: 3373, box: [-71.888, -15.666, -71.63, -15.341], geo: { x: 55, y: 20 } },
  { code: '040511', name: 'Lluta', province: 'CAYLLOMA', capital: 'Lluta', lat: -16.01556, lng: -72.01389, alt: 3031, box: [-72.291, -16.227, -71.758, -15.706], geo: { x: 48, y: 45 } },
  { code: '040512', name: 'Maca', province: 'CAYLLOMA', capital: 'Maca', lat: -15.64139, lng: -71.76833, alt: 3287, box: [-71.891, -15.874, -71.708, -15.604], geo: { x: 56, y: 22 } },
  { code: '040513', name: 'Madrigal', province: 'CAYLLOMA', capital: 'Madrigal', lat: -15.60833, lng: -71.8075, alt: 3300, box: [-71.937, -15.644, -71.769, -15.435], geo: { x: 53, y: 20 } },
  { code: '040514', name: 'San Antonio de Chuca', province: 'CAYLLOMA', capital: 'San Antonio de Chuca', lat: -15.83889, lng: -71.09056, alt: 4470, box: [-71.45, -16.044, -70.825, -15.556], geo: { x: 88, y: 25 } },
  { code: '040515', name: 'Sibayo', province: 'CAYLLOMA', capital: 'Sibayo', lat: -15.48611, lng: -71.45694, alt: 3836, box: [-71.652, -15.546, -71.395, -15.154], geo: { x: 68, y: 10 } },
  { code: '040516', name: 'Tapay', province: 'CAYLLOMA', capital: 'Tapay', lat: -15.5775, lng: -71.93972, alt: 3011, box: [-72.03, -15.615, -71.843, -15.228], geo: { x: 47, y: 20 } },
  { code: '040517', name: 'Tisco', province: 'CAYLLOMA', capital: 'Tisco', lat: -15.34694, lng: -71.44639, alt: 4195, box: [-71.609, -15.459, -71.124, -14.956], geo: { x: 67, y: 4 } },
  { code: '040518', name: 'Tuti', province: 'CAYLLOMA', capital: 'Tuti', lat: -15.53306, lng: -71.55306, alt: 3831, box: [-71.699, -15.592, -71.49, -15.369], geo: { x: 64, y: 13 } },
  { code: '040519', name: 'Yanque', province: 'CAYLLOMA', capital: 'Yanque', lat: -15.64833, lng: -71.66083, alt: 3468, box: [-71.703, -16.011, -71.181, -15.595], geo: { x: 57, y: 19 } },
  { code: '040520', name: 'Majes', province: 'CAYLLOMA', capital: 'El Pedregal', lat: -16.35333, lng: -72.24722, alt: 1392, box: [-72.625, -16.626, -72.066, -16.029], geo: { x: 40, y: 56 } },
  { code: '040601', name: 'Chuquibamba', province: 'CONDESUYOS', capital: 'Chuquibamba', lat: -15.83944, lng: -72.65167, alt: 2916, box: [-72.916, -16.477, -72.539, -15.592], geo: { x: 18, y: 42 } },
  { code: '040602', name: 'Andaray', province: 'CONDESUYOS', capital: 'Andaray', lat: -15.79722, lng: -72.86083, alt: 3047, box: [-73.033, -16.061, -72.641, -15.526], geo: { x: 8, y: 42 } },
  { code: '040603', name: 'Cayarani', province: 'CONDESUYOS', capital: 'Cayarani', lat: -14.67194, lng: -72.02194, alt: 3951, box: [-72.582, -15.43, -71.874, -14.613], geo: { x: 35, y: 4 } },
  { code: '040604', name: 'Chichas', province: 'CONDESUYOS', capital: 'Chichas', lat: -15.54778, lng: -72.91861, alt: 2174, box: [-73.137, -15.67, -72.786, -15.375], geo: { x: 4, y: 29 } },
  { code: '040605', name: 'Iray', province: 'CONDESUYOS', capital: 'Iray', lat: -15.85361, lng: -72.63, alt: 2469, box: [-72.699, -16.037, -72.499, -15.78], geo: { x: 19, y: 43 } },
  { code: '040606', name: 'Río Grande', province: 'CONDESUYOS', capital: 'Iquipi', lat: -15.94, lng: -73.13111, alt: 484, box: [-73.282, -16.039, -72.94, -15.644], geo: { x: 4, y: 53 } },
  { code: '040607', name: 'Salamanca', province: 'CONDESUYOS', capital: 'Salamanca', lat: -15.50444, lng: -72.83444, alt: 3226, box: [-72.918, -15.646, -72.488, -15.178], geo: { x: 6, y: 26 } },
  { code: '040608', name: 'Yanaquihua', province: 'CONDESUYOS', capital: 'Yanaquihua', lat: -15.77556, lng: -72.87639, alt: 3006, box: [-73.246, -15.891, -72.786, -15.491], geo: { x: 7, y: 41 } },
  { code: '040701', name: 'Mollendo', province: 'ISLAY', capital: 'Mollendo', lat: -17.02917, lng: -72.01639, alt: 73, box: [-72.075, -17.088, -71.647, -16.655], geo: { x: 58, y: 96 } },
  { code: '040702', name: 'Cocachacra', province: 'ISLAY', capital: 'Cocachacra', lat: -17.09111, lng: -71.77389, alt: 114, box: [-71.897, -17.139, -71.306, -16.664], geo: { x: 69, y: 96 } },
  { code: '040703', name: 'Deán Valdivia', province: 'ISLAY', capital: 'La Curva', lat: -17.145, lng: -71.82667, alt: 16, box: [-71.912, -17.19, -71.737, -17.011], geo: { x: 67, y: 96 } },
  { code: '040704', name: 'Islay', province: 'ISLAY', capital: 'Matarani', lat: -17.00083, lng: -72.0975, alt: 110, box: [-72.244, -17.041, -71.977, -16.747], geo: { x: 54, y: 96 } },
  { code: '040705', name: 'Mejía', province: 'ISLAY', capital: 'Mejía', lat: -17.10111, lng: -71.9075, alt: 9, box: [-71.968, -17.144, -71.8, -16.942], geo: { x: 63, y: 96 } },
  { code: '040706', name: 'Punta de Bombón', province: 'ISLAY', capital: 'Punta de Bombón', lat: -17.15611, lng: -71.78472, alt: 138, box: [-71.858, -17.305, -71.282, -17.036], geo: { x: 69, y: 96 } },
  { code: '040801', name: 'Cotahuasi', province: 'LA_UNION', capital: 'Cotahuasi', lat: -15.21278, lng: -72.88944, alt: 2696, box: [-72.962, -15.423, -72.768, -15.161], geo: { x: 4, y: 10 } },
  { code: '040802', name: 'Alca', province: 'LA_UNION', capital: 'Alca', lat: -15.13417, lng: -72.765, alt: 2759, box: [-72.838, -15.263, -72.612, -15.058], geo: { x: 6, y: 4 } },
  { code: '040803', name: 'Charcana', province: 'LA_UNION', capital: 'Charcana', lat: -15.24056, lng: -73.07056, alt: 3432, box: [-73.167, -15.291, -72.93, -15.114], geo: { x: 4, y: 14 } },
  { code: '040804', name: 'Huaynacotas', province: 'LA_UNION', capital: 'Taurisma', lat: -15.17472, lng: -72.84972, alt: 2612, box: [-72.92, -15.224, -72.572, -14.63], geo: { x: 4, y: 8 } },
  { code: '040805', name: 'Pampamarca', province: 'LA_UNION', capital: 'Mungui', lat: -15.1825, lng: -72.90528, alt: 2649, box: [-73.056, -15.252, -72.807, -14.74], geo: { x: 4, y: 9 } },
  { code: '040806', name: 'Puyca', province: 'LA_UNION', capital: 'Puyca', lat: -15.05917, lng: -72.69167, alt: 3675, box: [-72.762, -15.245, -72.282, -14.641], geo: { x: 9, y: 4 } },
  { code: '040807', name: 'Quechualla', province: 'LA_UNION', capital: 'Velinga', lat: -15.27389, lng: -73.02222, alt: 1964, box: [-73.192, -15.361, -72.939, -15.222], geo: { x: 4, y: 15 } },
  { code: '040808', name: 'Sayla', province: 'LA_UNION', capital: 'Sayla', lat: -15.32, lng: -73.22194, alt: 3544, box: [-73.305, -15.4, -73.154, -15.266], geo: { x: 4, y: 20 } },
  { code: '040809', name: 'Tauria', province: 'LA_UNION', capital: 'Tauria', lat: -15.35417, lng: -73.2325, alt: 2850, box: [-73.304, -15.537, -73.048, -15.286], geo: { x: 4, y: 22 } },
  { code: '040810', name: 'Tomepampa', province: 'LA_UNION', capital: 'Tomepampa', lat: -15.17306, lng: -72.83028, alt: 2644, box: [-72.879, -15.272, -72.673, -15.131], geo: { x: 4, y: 7 } },
  { code: '040811', name: 'Toro', province: 'LA_UNION', capital: 'Toro', lat: -15.26444, lng: -72.92833, alt: 2987, box: [-73.216, -15.592, -72.858, -15.203], geo: { x: 4, y: 13 } },
];

export const DISTRICT_BY_CODE: Record<string, District> = Object.fromEntries(DISTRICTS.map(d => [d.code, d]));

export function districtName(code: string | undefined): string {
  if (!code) return '';
  return DISTRICT_BY_CODE[code]?.name ?? code;
}

export function provinceOf(code: string | undefined): ProvinceCode | undefined {
  return code ? DISTRICT_BY_CODE[code]?.province : undefined;
}

export function provinceName(p: string | undefined): string {
  return p && (PROVINCES as any)[p] ? (PROVINCES as any)[p].name : (p ?? '');
}

/** «Yanque, Caylloma»; en la provincia de Arequipa basta el distrito. */
export function placeLabel(code: string | undefined): string {
  const d = code ? DISTRICT_BY_CODE[code] : undefined;
  if (!d) return code ?? '';
  if (d.province === 'AREQUIPA') return d.name;
  return d.name === PROVINCES[d.province].name ? d.name : `${d.name}, ${PROVINCES[d.province].name}`;
}

export const CITY_DISTRICTS = DISTRICTS.filter(d => d.city);

/** Opciones para un selector: «Yanque · Caylloma», ordenadas por provincia y nombre (Arequipa primero). */
export function districtChoices(filter?: (d: District) => boolean): { v: string; l: string }[] {
  return DISTRICTS.filter(d => !filter || filter(d))
    .sort((a, b) => a.province === b.province ? a.name.localeCompare(b.name, 'es') : PROVINCE_CODES.indexOf(a.province) - PROVINCE_CODES.indexOf(b.province))
    .map(d => ({ v: d.code, l: `${d.name} · ${PROVINCES[d.province].name}` }));
}

/* ---------- Distancias y coordenadas ---------- */

/** Rectángulo de la región Arequipa [lng mín, lat mín, lng máx, lat máx]. */
export const AREQUIPA_BOX: [number, number, number, number] = [-75.1, -17.35, -70.6, -14.6];

export function inBox(lat: number, lng: number, b: [number, number, number, number]): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}

export function validLatLng(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Distancia en línea recta (km). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * p / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lng2 - lng1) * p / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Por carretera se recorre más que en línea recta (Camaná–Arequipa: 129 km en línea recta, 176 km por la Panamericana). */
export const ROAD_FACTOR = 1.37;

/** Kilómetros aproximados por carretera entre dos distritos (de capital a capital). */
export function kmBetween(a?: string, b?: string): number {
  const pa = DISTRICT_BY_CODE[a ?? ''], pb = DISTRICT_BY_CODE[b ?? ''];
  if (!pa || !pb) return 0;
  return Math.round(haversineKm(pa.lat, pa.lng, pb.lat, pb.lng) * ROAD_FACTOR);
}

/** Enlace para abrir el punto en Google Maps (sin clave). */
export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Texto sin tildes ni mayúsculas, para buscar («Sabandía» = «sabandia», «Peña» = «pena»). */
export function fold(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
